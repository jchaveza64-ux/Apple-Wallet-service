import express from 'express';
import { supabase } from '../config/supabase.js';
import { PKPass } from 'passkit-generator';
import certificateManager from '../config/certificates.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

/**
 * Convierte color HEX a formato RGB para Apple Wallet
 */
function hexToRgb(hex) {
  if (!hex) return null;
  
  // Remover # si existe
  hex = hex.replace('#', '');
  
  // Convertir a RGB
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Descarga una imagen desde URL y la guarda en el template
 */
async function downloadImage(url, destPath) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      const chunks = [];
      
      response.on('data', (chunk) => {
        chunks.push(chunk);
      });
      
      response.on('end', async () => {
        try {
          const buffer = Buffer.concat(chunks);
          await fs.writeFile(destPath, buffer);
          resolve(destPath);
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Procesa template de valores dinámicos
 */
function processTemplate(template, data) {
  if (!template) return '';
  
  let result = template;
  
  // Reemplazar {{customers.field}}
  result = result.replace(/\{\{customers\.(\w+)\}\}/g, (match, field) => {
    return data.customer?.[field] || '';
  });
  
  // Reemplazar {{loyalty_cards.field}}
  result = result.replace(/\{\{loyalty_cards\.(\w+)\}\}/g, (match, field) => {
    return data.loyaltyCard?.[field] || '';
  });
  
  return result;
}

router.get('/wallet', async (req, res) => {
  try {
    const { customerId, businessId, configId } = req.query;

    if (!customerId || !businessId || !configId) {
      return res.status(400).json({
        error: 'Missing required parameters',
        required: ['customerId', 'businessId', 'configId']
      });
    }

    console.log('📱 Generating pass:', { customerId, businessId, configId });

    // ============================================
    // 1. OBTENER DATOS DEL CLIENTE
    // ============================================
    const { data: customerData, error: customerError } = await supabase
      .from('customers')
      .select(`
        id,
        full_name,
        email,
        phone,
        business_id,
        created_at,
        loyalty_cards (
          current_points,
          current_stamps,
          card_number,
          status
        )
      `)
      .eq('id', customerId)
      .single();

    if (customerError || !customerData) {
      console.error('❌ Customer not found:', customerError);
      return res.status(404).json({ error: 'Customer not found' });
    }

    const loyaltyCard = Array.isArray(customerData.loyalty_cards) 
      ? customerData.loyalty_cards[0] 
      : customerData.loyalty_cards;

    console.log('✅ Customer:', customerData.full_name, '| Points:', loyaltyCard?.current_points || 0);

    // ============================================
    // 2. OBTENER DATOS DEL NEGOCIO
    // ============================================
    const { data: businessData, error: businessError } = await supabase
      .from('businesses')
      .select('id, name, description')
      .eq('id', businessId)
      .single();

    if (businessError || !businessData) {
      console.error('❌ Business not found:', businessError);
      return res.status(404).json({ error: 'Business not found' });
    }

    console.log('✅ Business:', businessData.name);

    // ============================================
    // 3. OBTENER CONFIGURACIÓN COMPLETA
    // ============================================
    const { data: formConfig, error: formError } = await supabase
      .from('form_configurations')
      .select('*')
      .eq('id', configId)
      .eq('business_id', businessId)
      .single();

    if (formError || !formConfig) {
      console.error('❌ Config not found:', formError);
      return res.status(404).json({ error: 'Config not found' });
    }

    const { data: passkitConfig, error: passkitError } = await supabase
      .from('passkit_configs')
      .select('*')
      .eq('id', formConfig.passkit_config_id)
      .single();

    if (passkitError || !passkitConfig) {
      console.error('❌ PassKit config not found:', passkitError);
      return res.status(404).json({ error: 'PassKit config not found' });
    }

    const appleConfig = passkitConfig.apple_config || {};
    const memberFields = passkitConfig.member_fields || [];
    const barcodeConfig = passkitConfig.barcode_config || {};

    console.log('✅ Config:', passkitConfig.config_name);

    // ============================================
    // 4. DESCARGAR IMÁGENES DESDE SUPABASE
    // ============================================
    const templatePath = path.join(__dirname, '../templates/loyalty.pass');
    
    console.log('📥 Downloading images from Supabase...');

    try {
      // Descargar logo (requerido por Apple Wallet)
      if (appleConfig.logo_url) {
        await downloadImage(appleConfig.logo_url, path.join(templatePath, 'logo.png'));
        await downloadImage(appleConfig.logo_url, path.join(templatePath, 'logo@2x.png'));
        await downloadImage(appleConfig.logo_url, path.join(templatePath, 'logo@3x.png'));
        console.log('✅ Logo downloaded');
      }

      // Descargar icon (REQUERIDO por Apple Wallet)
      if (appleConfig.icon_url) {
        await downloadImage(appleConfig.icon_url, path.join(templatePath, 'icon.png'));
        await downloadImage(appleConfig.icon_url, path.join(templatePath, 'icon@2x.png'));
        await downloadImage(appleConfig.icon_url, path.join(templatePath, 'icon@3x.png'));
        console.log('✅ Icon downloaded');
      }

      // Descargar strip (opcional pero recomendado)
      if (appleConfig.strip_image_url) {
        await downloadImage(appleConfig.strip_image_url, path.join(templatePath, 'strip.png'));
        await downloadImage(appleConfig.strip_image_url, path.join(templatePath, 'strip@2x.png'));
        await downloadImage(appleConfig.strip_image_url, path.join(templatePath, 'strip@3x.png'));
        console.log('✅ Strip downloaded');
      }

      console.log('✅ All images downloaded successfully');
    } catch (imageError) {
      console.error('❌ Image download failed:', imageError.message);
      return res.status(500).json({ 
        error: 'Failed to download images from Supabase',
        details: imageError.message 
      });
    }

    // ============================================
    // 5. CREAR EL PASE
    // ============================================
    const pass = await PKPass.from({
      model: templatePath,
      certificates: certificateManager.getAllCertificates()
    });

    // Datos básicos
    const serialNumber = loyaltyCard?.card_number || `${businessId.slice(0, 8)}-${customerId.slice(0, 8)}`.toUpperCase();
    
    pass.type = 'generic';
    pass.serialNumber = serialNumber;
    pass.passTypeIdentifier = appleConfig.pass_type_id || process.env.PASS_TYPE_IDENTIFIER;
    pass.teamIdentifier = appleConfig.team_id || process.env.TEAM_IDENTIFIER;
    pass.organizationName = appleConfig.organization_name || passkitConfig.config_name;
    pass.description = appleConfig.description || passkitConfig.card_display_name || 'Tarjeta de Fidelidad';
    pass.logoText = appleConfig.logo_text || passkitConfig.config_name || '';
    pass.relevantDate = new Date().toISOString();

    // CONVERTIR COLORES HEX A RGB Y APLICAR
    const bgColor = hexToRgb(appleConfig.background_color) || 'rgb(18, 18, 18)';
    const fgColor = hexToRgb(appleConfig.foreground_color) || 'rgb(239, 133, 46)';
    const lblColor = hexToRgb(appleConfig.label_color) || 'rgb(255, 255, 255)';
    
    pass.backgroundColor = bgColor;
    pass.foregroundColor = fgColor;
    pass.labelColor = lblColor;

    // Web service
    pass.webServiceURL = process.env.BASE_URL || '';
    pass.authenticationToken = Buffer.from(`${customerId}-${businessId}-${Date.now()}`).toString('base64');

    console.log('🎨 Colors applied (converted to RGB):', {
      background: bgColor,
      foreground: fgColor,
      label: lblColor
    });

    // ============================================
    // 6. CAMPOS DINÁMICOS DESDE member_fields
    // ============================================
    
    const templateData = {
      customer: {
        full_name: customerData.full_name,
        email: customerData.email,
        phone: customerData.phone
      },
      loyaltyCard: {
        current_points: loyaltyCard?.current_points || 0,
        current_stamps: loyaltyCard?.current_stamps || 0,
        card_number: serialNumber
      }
    };

    // Procesar member_fields
    memberFields.forEach(field => {
      const value = processTemplate(field.valueTemplate, templateData);
      
      const fieldData = {
        key: field.key,
        label: field.label,
        value: field.key.includes('points') ? Number(value) : value
      };

      switch (field.position) {
        case 'primary':
          pass.primaryFields.push(fieldData);
          break;
        case 'secondary':
          pass.secondaryFields.push(fieldData);
          break;
        case 'auxiliary':
          pass.auxiliaryFields.push(fieldData);
          break;
        case 'header':
          pass.headerFields.push(fieldData);
          break;
      }
    });

    console.log('✅ Fields configured from member_fields');

    // ============================================
    // 7. BARCODE DESDE barcode_config
    // ============================================
    
    const barcodeMessage = processTemplate(barcodeConfig.message_template, templateData);
    
    pass.setBarcodes({
      message: barcodeMessage || customerId,
      format: barcodeConfig.format || 'PKBarcodeFormatQR',
      messageEncoding: barcodeConfig.encoding || 'iso-8859-1',
      altText: barcodeConfig.alt_text || serialNumber
    });

    console.log('✅ Barcode configured');

    // ============================================
    // 8. NO AGREGAR BACK FIELDS
    // ============================================
    // Los backFields se eliminan intencionalmente para mantener el reverso limpio

    console.log('🔨 Pass configured with Supabase data (generic type)');

    // ============================================
    // 9. GENERAR Y ENVIAR
    // ============================================
    const passBuffer = pass.getAsBuffer();
    console.log(`📦 Pass size: ${passBuffer.length} bytes`);

    const filename = `${passkitConfig.config_name}-${customerData.full_name}.pkpass`
      .replace(/[^a-zA-Z0-9-]/g, '_');

    res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', passBuffer.length);

    res.send(passBuffer);

    console.log('✅ Pass sent successfully');

    // ============================================
    // 10. LIMPIAR IMÁGENES TEMPORALES
    // ============================================
    try {
      await fs.unlink(path.join(templatePath, 'logo.png')).catch(() => {});
      await fs.unlink(path.join(templatePath, 'logo@2x.png')).catch(() => {});
      await fs.unlink(path.join(templatePath, 'logo@3x.png')).catch(() => {});
      await fs.unlink(path.join(templatePath, 'icon.png')).catch(() => {});
      await fs.unlink(path.join(templatePath, 'icon@2x.png')).catch(() => {});
      await fs.unlink(path.join(templatePath, 'icon@3x.png')).catch(() => {});
      await fs.unlink(path.join(templatePath, 'strip.png')).catch(() => {});
      await fs.unlink(path.join(templatePath, 'strip@2x.png')).catch(() => {});
      await fs.unlink(path.join(templatePath, 'strip@3x.png')).catch(() => {});
      console.log('🧹 Cleaned up temporary images');
    } catch (cleanupError) {
      // Ignorar errores de limpieza
    }

  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({
      error: 'Failed to generate pass',
      details: error.message
    });
  }
});

export default router;