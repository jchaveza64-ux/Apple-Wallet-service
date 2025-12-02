import express from 'express';
import { PKPass } from 'passkit-generator';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
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

// Función para descargar imagen
async function downloadImage(url) {
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 10000
    });
    return Buffer.from(response.data);
  } catch (error) {
    console.error(`❌ Error downloading image from ${url}:`, error.message);
    throw error;
  }
}

router.post('/wallet', async (req, res) => {
  try {
    const { customerId } = req.body;
    
    if (!customerId) {
      return res.status(400).json({ error: 'customerId es requerido' });
    }

    console.log('\n🔍 Procesando solicitud para customer:', customerId);

    // 1. Obtener datos del customer
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('*')
      .eq('id', customerId)
      .single();

    if (customerError || !customer) {
      console.error('❌ Error obteniendo customer:', customerError);
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    console.log('✅ Customer:', customer.name, '| Points:', customer.points);

    // 2. Obtener passkit_config
    const { data: config, error: configError } = await supabase
      .from('passkit_configs')
      .select('*')
      .eq('id', customer.passkit_config_id)
      .single();

    if (configError || !config) {
      console.error('❌ Error obteniendo config:', configError);
      return res.status(404).json({ error: 'Configuración no encontrada' });
    }

    console.log('✅ Config:', config.logo_text);

    // 3. Convertir colores HEX a RGB
    const rgbColors = {
      background: hexToRgb(config.background_color),
      foreground: hexToRgb(config.foreground_color),
      label: hexToRgb(config.label_color)
    };

    console.log('🎨 Colors:', rgbColors);

    // 4. Preparar buffers de imágenes
    const buffers = {};
    
    try {
      // Logo (requerido)
      if (config.logo_url) {
        buffers['logo.png'] = await downloadImage(config.logo_url);
        buffers['logo@2x.png'] = await downloadImage(config.logo_url);
        console.log('✅ Logo downloaded');
      }

      // Icon (requerido por Apple)
      if (config.icon_url) {
        buffers['icon.png'] = await downloadImage(config.icon_url);
        buffers['icon@2x.png'] = await downloadImage(config.icon_url);
        console.log('✅ Icon downloaded');
      }

      // Strip image (opcional)
      if (config.strip_image_url) {
        buffers['strip.png'] = await downloadImage(config.strip_image_url);
        buffers['strip@2x.png'] = await downloadImage(config.strip_image_url);
        console.log('✅ Strip downloaded');
      }
    } catch (imageError) {
      console.error('❌ Error descargando imágenes:', imageError);
      return res.status(500).json({ error: 'Error descargando assets' });
    }

    // 5. Preparar rutas de certificados
    const certPath = path.resolve(__dirname, '../certs');
    const templatePath = path.resolve(__dirname, '../templates/loyalty.pass');
    const signerCertPath = path.join(certPath, 'signerCert.pem');
    const signerKeyPath = path.join(certPath, 'signerKey.pem');
    const wwdrPath = path.join(certPath, 'wwdr.pem');

    // 6. CLAVE: Pasar los colores y props dinámicos como segundo parámetro
    // Según documentación de passkit-generator, estos props se MERGEAN con pass.json
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
        // PROPS QUE SE MERGEAN CON pass.json
        serialNumber: customer.id,
        description: `${config.logo_text} - Tarjeta de Fidelidad`,
        organizationName: config.organization_name,
        logoText: config.logo_text,
        
        // COLORES EN FORMATO RGB (Apple requiere: rgb(r, g, b))
        backgroundColor: rgbColors.background,
        foregroundColor: rgbColors.foreground,
        labelColor: rgbColors.label,
        
        // BARCODE
        barcodes: [
          {
            message: customer.id,
            format: 'PKBarcodeFormatQR',
            messageEncoding: 'iso-8859-1',
          },
        ],
      }
    );

    // 7. Agregar imágenes descargadas
    for (const [fileName, buffer] of Object.entries(buffers)) {
      pass.addBuffer(fileName, buffer);
    }

    // 8. Configurar campos del pass
    pass.primaryFields.push({
      key: 'points',
      label: 'PUNTOS',
      value: customer.points.toString(),
      textAlignment: 'PKTextAlignmentLeft',
    });

    pass.primaryFields.push({
      key: 'member',
      label: 'AMIG@',
      value: customer.name,
      textAlignment: 'PKTextAlignmentRight',
    });

    // 9. Generar el pass
    const passBuffer = pass.getAsBuffer();
    console.log('📦 Pass size:', passBuffer.length, 'bytes');

    // 10. Enviar respuesta
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
});

export default router;