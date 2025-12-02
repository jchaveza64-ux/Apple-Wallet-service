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
  
  hex = hex.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Descarga una imagen desde URL y la guarda
 */
async function downloadImage(url, destPath) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', async () => {
        try {
          await fs.writeFile(destPath, Buffer.concat(chunks));
          resolve(destPath);
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

/**
 * Procesa template de valores dinámicos
 */
function processTemplate(template, data) {
  if (!template) return '';
  let result = template;
  result = result.replace(/\{\{customers\.(\w+)\}\}/g, (match, field) => data.customer?.[field] || '');
  result = result.replace(/\{\{loyalty_cards\.(\w+)\}\}/g, (match, field) => data.loyaltyCard?.[field] || '');
  return result;
}

router.get('/wallet', async (req, res) => {
  const tempDir = path.join(__dirname, '../templates/temp_' + Date.now() + '.pass');
  
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
    // 1-3. OBTENER TODOS LOS DATOS
    // ============================================
    const { data: customerData, error: customerError } = await supabase
      .from('customers')
      .select(`
        id, full_name, email, phone, business_id, created_at,
        loyalty_cards (current_points, current_stamps, card_number, status)
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
    // 4. CREAR TEMPLATE TEMPORAL CON VALORES CORRECTOS
    // ============================================
    
    // Crear directorio temporal
    await fs.mkdir(tempDir, { recursive: true });
    console.log('📁 Temporary directory created:', tempDir);

    const serialNumber = loyaltyCard?.card_number || `${businessId.slice(0, 8)}-${customerId.slice(0, 8)}`.toUpperCase();
    
    // Convertir colores
    const bgColor = hexToRgb(appleConfig.background_color) || 'rgb(18, 18, 18)';
    const fgColor = hexToRgb(appleConfig.foreground_color) || 'rgb(239, 133, 46)';
    const lblColor = hexToRgb(appleConfig.label_color) || 'rgb(255, 255, 255)';

    // Crear pass.json con valores de Supabase
    const passJsonContent = {
      formatVersion: 1,
      passTypeIdentifier: appleConfig.pass_type_id || process.env.PASS_TYPE_IDENTIFIER,
      serialNumber: serialNumber,
      teamIdentifier: appleConfig.team_id || process.env.TEAM_IDENTIFIER,
      organizationName: appleConfig.organization_name || passkitConfig.config_name,
      description: appleConfig.description || passkitConfig.card_display_name || 'Tarjeta de Fidelidad',
      logoText: appleConfig.logo_text || passkitConfig.config_name || '',
      backgroundColor: bgColor,
      foregroundColor: fgColor,
      labelColor: lblColor,
      webServiceURL: process.env.BASE_URL || '',
      authenticationToken: Buffer.from(`${customerId}-${businessId}-${Date.now()}`).toString('base64'),
      relevantDate: new Date().toISOString(),
      generic: {
        headerFields: [],
        primaryFields: [],
        secondaryFields: [],
        auxiliaryFields: []
      }
    };

    await fs.writeFile(
      path.join(tempDir, 'pass.json'),
      JSON.stringify(passJsonContent, null, 2)
    );
    
    // LÍNEA DE DEBUG AGREGADA:
    console.log('🔍 Generated pass.json:', JSON.stringify(passJsonContent, null, 2));
    
    console.log('✅ pass.json created with Supabase data');
    console.log('🎨 Colors:', { background: bgColor, foreground: fgColor, label: lblColor });

    // ============================================
    // 5. DESCARGAR IMÁGENES AL TEMPLATE TEMPORAL
    // ============================================
    console.log('📥 Downloading images from Supabase...');

    try {
      if (appleConfig.logo_url) {
        await downloadImage(appleConfig.logo_url, path.join(tempDir, 'logo.png'));
        await downloadImage(appleConfig.logo_url, path.join(tempDir, 'logo@2x.png'));
        await downloadImage(appleConfig.logo_url, path.join(tempDir, 'logo@3x.png'));
        console.log('✅ Logo downloaded');
      }

      if (appleConfig.icon_url) {
        await downloadImage(appleConfig.icon_url, path.join(tempDir, 'icon.png'));
        await downloadImage(appleConfig.icon_url, path.join(tempDir, 'icon@2x.png'));
        await downloadImage(appleConfig.icon_url, path.join(tempDir, 'icon@3x.png'));
        console.log('✅ Icon downloaded');
      }

      if (appleConfig.strip_image_url) {
        await downloadImage(appleConfig.strip_image_url, path.join(tempDir, 'strip.png'));
        await downloadImage(appleConfig.strip_image_url, path.join(tempDir, 'strip@2x.png'));
        await downloadImage(appleConfig.strip_image_url, path.join(tempDir, 'strip@3x.png'));
        console.log('✅ Strip downloaded');
      }

      console.log('✅ All images downloaded successfully');
    } catch (imageError) {
      console.error('❌ Image download failed:', imageError.message);
      await fs.rm(tempDir, { recursive: true, force: true });
      return res.status(500).json({ 
        error: 'Failed to download images from Supabase',
        details: imageError.message 
      });
    }

    // ============================================
    // 6. CREAR EL PASE DESDE EL TEMPLATE TEMPORAL
    // ============================================
    const pass = await PKPass.from({
      model: tempDir,
      certificates: certificateManager.getAllCertificates()
    });

    pass.type = 'generic';

    // ============================================
    // 7. CAMPOS DINÁMICOS
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

    memberFields.forEach(field => {
      const value = processTemplate(field.valueTemplate, templateData);
      const fieldData = {
        key: field.key,
        label: field.label,
        value: field.key.includes('points') ? Number(value) : value
      };

      switch (field.position) {
        case 'primary': pass.primaryFields.push(fieldData); break;
        case 'secondary': pass.secondaryFields.push(fieldData); break;
        case 'auxiliary': pass.auxiliaryFields.push(fieldData); break;
        case 'header': pass.headerFields.push(fieldData); break;
      }
    });

    console.log('✅ Fields configured from member_fields');

    // ============================================
    // 8. BARCODE
    // ============================================
    const barcodeMessage = processTemplate(barcodeConfig.message_template, templateData);
    
    pass.setBarcodes({
      message: barcodeMessage || customerId,
      format: barcodeConfig.format || 'PKBarcodeFormatQR',
      messageEncoding: barcodeConfig.encoding || 'iso-8859-1',
      altText: barcodeConfig.alt_text || serialNumber
    });

    console.log('✅ Barcode configured');
    console.log('🔨 Pass configured with Supabase data');

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
    // 10. LIMPIAR DIRECTORIO TEMPORAL
    // ============================================
    await fs.rm(tempDir, { recursive: true, force: true });
    console.log('🧹 Cleaned up temporary directory');

  } catch (error) {
    console.error('❌ Error:', error);
    
    // Limpiar directorio temporal en caso de error
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {}
    
    res.status(500).json({
      error: 'Failed to generate pass',
      details: error.message
    });
  }
});

export default router;