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
 * Descarga una imagen desde URL y la guarda en el template
 */
async function downloadImage(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = require('fs').createWriteStream(destPath);
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(destPath);
      });
    }).on('error', (err) => {
      require('fs').unlink(destPath, () => {});
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
      // Descargar logo
      if (appleConfig.logo_url) {
        await downloadImage(appleConfig.logo_url, path.join(templatePath, 'logo.png'));
        await downloadImage(appleConfig.logo_url, path.join(templatePath, 'logo@2x.png'));
        await downloadImage(appleConfig.logo_url, path.join(templatePath, 'logo@3x.png'));
      }

      // Descargar icon
      if (appleConfig.icon_url) {
        await downloadImage(appleConfig.icon_url, path.join(templatePath, 'icon.png'));
        await downloadImage(appleConfig.icon_url, path.join(templatePath, 'icon@2x.png'));
        await downloadImage(appleConfig.icon_url, path.join(templatePath, 'icon@3x.png'));
      }

      // Descargar strip
      if (appleConfig.strip_image_url) {
        await downloadImage(appleConfig.strip_image_url, path.join(templatePath, 'strip.png'));
        await downloadImage(appleConfig.strip_image_url, path.join(templatePath, 'strip@2x.png'));
        await downloadImage(appleConfig.strip_image_url, path.join(templatePath, 'strip@3x.png'));
      }

      console.log('✅ Images downloaded successfully');
    } catch (imageError) {
      console.warn('⚠️ Image download failed:', imageError.message);
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
    pass.logoText = appleConfig.logo_text || passkitConfig.card_display_name || '';
    pass.relevantDate = new Date().toISOString();

    // Colores desde Supabase
    pass.backgroundColor = appleConfig.background_color || '#121212';
    pass.foregroundColor = appleConfig.foreground_color || '#ef852e';
    pass.labelColor = appleConfig.label_color || '#FFFFFF';

    // Web service
    pass.webServiceURL = process.env.BASE_URL || '';
    pass.authenticationToken = Buffer.from(`${customerId}-${businessId}-${Date.now()}`).toString('base64');

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

    // ============================================
    // 8. BACK FIELDS
    // ============================================
    
    pass.backFields.push({
      key: 'email',
      label: 'Email',
      value: customerData.email || 'No proporcionado'
    });

    pass.backFields.push({
      key: 'phone',
      label: 'Teléfono',
      value: customerData.phone || 'No proporcionado'
    });

    pass.backFields.push({
      key: 'member_since',
      label: 'Miembro desde',
      value: new Date(customerData.created_at).toLocaleDateString('es-ES', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    });

    pass.backFields.push({
      key: 'card_number',
      label: 'Número de tarjeta',
      value: serialNumber
    });

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

    // Limpiar imágenes temporales
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
      console.log('🧹 Cleaned up temporary template');
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