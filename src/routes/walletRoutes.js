import express from 'express';
import { PKPass } from 'passkit-generator';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Función para convertir HEX a RGB según formato Apple: rgb(r, g, b)
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return null;
  
  const r = parseInt(result[1], 16);
  const g = parseInt(result[2], 16);
  const b = parseInt(result[3], 16);
  
  return `rgb(${r}, ${g}, ${b})`;
}

// Función para descargar imagen usando fetch nativo
async function downloadImage(url) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10000)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error(`❌ Error downloading image from ${url}:`, error.message);
    throw error;
  }
}

router.get('/wallet', async (req, res) => {
  try {
    const { customerId } = req.query;
    
    if (!customerId) {
      return res.status(400).json({ error: 'customerId es requerido' });
    }

    console.log('\n🔍 Procesando solicitud para customer:', customerId);

    // 1. Obtener datos del customer con JOIN a loyalty_cards y passkit_configs
    const { data: customerData, error: customerError } = await supabase
      .rpc('get_customer_wallet_data', { customer_id: customerId });

    if (customerError) {
      // Si el RPC no existe, usamos query manual
      console.log('⚠️ RPC no disponible, usando query manual');
      
      const { data: customer, error: custError } = await supabase
        .from('customers')
        .select(`
          id,
          full_name,
          email,
          business_id
        `)
        .eq('id', customerId)
        .single();

      if (custError || !customer) {
        console.error('❌ Error obteniendo customer:', custError);
        return res.status(404).json({ error: 'Cliente no encontrado' });
      }

      // Obtener puntos
      const { data: loyaltyCard } = await supabase
        .from('loyalty_cards')
        .select('current_points')
        .eq('customer_id', customerId)
        .single();

      // Obtener passkit config
      const { data: config, error: configError } = await supabase
        .from('passkit_configs')
        .select('id, apple_config')
        .eq('business_id', customer.business_id)
        .eq('is_active', true)
        .single();

      if (configError || !config) {
        console.error('❌ Error obteniendo config:', configError);
        return res.status(404).json({ error: 'Configuración no encontrada' });
      }

      // Extraer datos del JSONB
      const appleConfig = config.apple_config;

      console.log('✅ Customer:', customer.full_name, '| Points:', loyaltyCard?.current_points || 0);
      console.log('✅ Config:', appleConfig.logo_text);

      // Convertir colores HEX a RGB
      const rgbColors = {
        background: hexToRgb(appleConfig.background_color),
        foreground: hexToRgb(appleConfig.foreground_color),
        label: hexToRgb(appleConfig.label_color)
      };

      console.log('🎨 Colors:', rgbColors);

      // Preparar buffers de imágenes
      const buffers = {};
      
      try {
        // Logo (requerido)
        if (appleConfig.logo_url) {
          buffers['logo.png'] = await downloadImage(appleConfig.logo_url);
          buffers['logo@2x.png'] = await downloadImage(appleConfig.logo_url);
          console.log('✅ Logo downloaded');
        }

        // Icon (requerido por Apple)
        if (appleConfig.icon_url) {
          buffers['icon.png'] = await downloadImage(appleConfig.icon_url);
          buffers['icon@2x.png'] = await downloadImage(appleConfig.icon_url);
          console.log('✅ Icon downloaded');
        }

        // Strip image (opcional)
        if (appleConfig.strip_image_url) {
          buffers['strip.png'] = await downloadImage(appleConfig.strip_image_url);
          buffers['strip@2x.png'] = await downloadImage(appleConfig.strip_image_url);
          console.log('✅ Strip downloaded');
        }
      } catch (imageError) {
        console.error('❌ Error descargando imágenes:', imageError);
        return res.status(500).json({ error: 'Error descargando assets' });
      }

      // Preparar rutas de certificados
      const certPath = path.resolve(__dirname, '../certs');
      const templatePath = path.resolve(__dirname, '../templates/loyalty.pass');
      const signerCertPath = path.join(certPath, 'signerCert.pem');
      const signerKeyPath = path.join(certPath, 'signerKey.pem');
      const wwdrPath = path.join(certPath, 'wwdr.pem');

      // Crear pass con colores en segundo parámetro
      const pass = await PKPass.from(
        {
          model: templatePath,
          certificates: {
            wwdr: fs.readFileSync(wwdrPath),
            signerCert: fs.readFileSync(signerCertPath),
            signerKey: {
              keyFile: fs.readFileSync(signerKeyPath),
              passphrase: process.env.PASS_KEY_PASSPHRASE,
            },
          },
        },
        {
          serialNumber: customer.id,
          description: `${appleConfig.logo_text} - Tarjeta de Fidelidad`,
          organizationName: appleConfig.organization_name,
          logoText: appleConfig.logo_text,
          backgroundColor: rgbColors.background,
          foregroundColor: rgbColors.foreground,
          labelColor: rgbColors.label,
          barcodes: [
            {
              message: customer.id,
              format: 'PKBarcodeFormatQR',
              messageEncoding: 'iso-8859-1',
            },
          ],
        }
      );

      // Agregar imágenes descargadas
      for (const [fileName, buffer] of Object.entries(buffers)) {
        pass.addBuffer(fileName, buffer);
      }

      // Configurar campos del pass
      pass.primaryFields.push({
        key: 'points',
        label: 'PUNTOS',
        value: (loyaltyCard?.current_points || 0).toString(),
        textAlignment: 'PKTextAlignmentLeft',
      });

      pass.primaryFields.push({
        key: 'member',
        label: 'AMIG@',
        value: customer.full_name,
        textAlignment: 'PKTextAlignmentRight',
      });

      // Generar el pass
      const passBuffer = pass.getAsBuffer();
      console.log('📦 Pass size:', passBuffer.length, 'bytes');

      // Enviar respuesta
      res.set({
        'Content-Type': 'application/vnd.apple.pkpass',
        'Content-Disposition': `attachment; filename=${customer.id}.pkpass`,
        'Content-Length': passBuffer.length,
      });

      res.send(passBuffer);
      console.log('✅ Pass sent successfully\n');

    } catch (error) {
      console.error('❌ Error general:', error);
      res.status(500).json({ 
        error: 'Error generando el pass',
        details: error.message 
      });
    }

  } catch (error) {
    console.error('❌ Error general:', error);
    res.status(500).json({ 
      error: 'Error generando el pass',
      details: error.message 
    });
  }
});

export default router;






