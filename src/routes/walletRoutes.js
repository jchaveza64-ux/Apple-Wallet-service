import express from 'express';
import { supabase } from '../config/supabase.js';
import { PKPass } from 'passkit-generator';
import certificateManager from '../config/certificates.js'; //
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

/**
 * Convierte HEX a RGB
 */
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return hex;
  const r = parseInt(result[1], 16);
  const g = parseInt(result[2], 16);
  const b = parseInt(result[3], 16);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Descarga imagen desde URL
 */
async function downloadImage(url, destPath) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', async () => {
        try {
          const buffer = Buffer.concat(chunks);
          await fs.writeFile(destPath, buffer);
          resolve(destPath);
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

/**
 * Procesa template
 */
function processTemplate(template, data) {
  if (!template) return '';
  let result = template;
  result = result.replace(/\{\{customers\.(\w+)\}\}/g, (match, field) => {
    return data.customer?.[field] || '';
  });
  result = result.replace(/\{\{loyalty_cards\.(\w+)\}\}/g, (match, field) => {
    return data.loyaltyCard?.[field] || '';
  });
  return result;
}

/**
 * Obtiene href según tipo de link
 */
function getLinkHref(type, url) {
  switch(type) {
    case 'phone':
      return `tel:${url.replace(/[^0-9+]/g, '')}`;
    case 'email':
      return `mailto:${url}`;
    case 'address':
      return `maps://?q=${encodeURIComponent(url)}`;
    default:
      return url.startsWith('http') ? url : `https://${url}`;
  }
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
        created_at
      `)
      .eq('id', customerId)
      .single();

    if (customerError || !customerData) {
      console.error('❌ Customer not found:', customerError);
      return res.status(404).json({ error: 'Customer not found' });
    }

    console.log('✅ Customer:', customerData.full_name);

    // ============================================
    // 2. OBTENER LOYALTY CARD CON PUNTOS
    // ============================================
    const { data: loyaltyCard, error: cardError } = await supabase
      .from('loyalty_cards')
      .select('*')
      .eq('customer_id', customerId)
      .eq('passkit_config_id', configId)
      .single();

    if (cardError || !loyaltyCard) {
      console.error('❌ Loyalty card not found:', cardError);
      return res.status(404).json({ error: 'Loyalty card not found' });
    }

    console.log('✅ Loyalty card found | Points:', loyaltyCard.current_points);

    // ============================================
    // 3. OBTENER DATOS DEL NEGOCIO
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
    // 4. OBTENER CONFIGURACIÓN POR configId (FIX)
    // ============================================
    const { data: passkitConfig, error: configError } = await supabase
      .from('passkit_configs')
      .select('*')
      .eq('id', configId)
      .single();

    if (configError || !passkitConfig) {
      console.error('❌ Config not found:', configError);
      return res.status(404).json({ error: 'Config not found' });
    }

    console.log('✅ Config:', passkitConfig.config_name);

    const appleConfig = passkitConfig.apple_config || {};
    const memberFields = passkitConfig.member_fields || [];
    const barcodeConfig = passkitConfig.barcode_config || {};
    const linksFields = passkitConfig.links_fields || [];
    const customFields = passkitConfig.custom_fields || [];

    // ✅ FIX: Usar directorio único por configuración para evitar sobrescritura de imágenes
    const templatePath = path.join(__dirname, `../templates/${configId}`);

    // ============================================
    // 5. DESCARGAR IMÁGENES
    // ============================================
    console.log('📥 Downloading images...');
    if (appleConfig.logo_url) {
      await downloadImage(appleConfig.logo_url, path.join(templatePath, 'logo.png'));
      await downloadImage(appleConfig.logo_url, path.join(templatePath, 'logo@2x.png'));
      await downloadImage(appleConfig.logo_url, path.join(templatePath, 'logo@3x.png'));
    }

    if (appleConfig.icon_url) {
      await downloadImage(appleConfig.icon_url, path.join(templatePath, 'icon.png'));
      await downloadImage(appleConfig.icon_url, path.join(templatePath, 'icon@2x.png'));
      await downloadImage(appleConfig.icon_url, path.join(templatePath, 'icon@3x.png'));
    }

    if (appleConfig.strip_image_url) {
      await downloadImage(appleConfig.strip_image_url, path.join(templatePath, 'strip.png'));
      await downloadImage(appleConfig.strip_image_url, path.join(templatePath, 'strip@2x.png'));
      await downloadImage(appleConfig.strip_image_url, path.join(templatePath, 'strip@3x.png'));
    }
    console.log('✅ Images downloaded');

    // ============================================
    // 6. CREAR PASS
    // ============================================
    console.log('🎨 Creating pass...');
    const pass = await PKPass.from(
      {
        model: templatePath,
        certificates: certificateManager.getAllCertificates()
      },
      {
        serialNumber: loyaltyCard.card_number,
        passTypeIdentifier: process.env.PASS_TYPE_IDENTIFIER || 'pass.com.innobizz.fidelityhub',
        teamIdentifier: appleConfig.team_id || process.env.TEAM_IDENTIFIER,
        organizationName: appleConfig.organization_name || passkitConfig.config_name,
        description: appleConfig.description || 'Tarjeta de Fidelidad',
        logoText: appleConfig.logo_text || '',
        backgroundColor: hexToRgb(appleConfig.background_color || '#121212'),
        foregroundColor: hexToRgb(appleConfig.foreground_color || '#ef852e'),
        labelColor: hexToRgb(appleConfig.label_color || '#FFFFFF'),
        webServiceURL: process.env.BASE_URL || 'https://apple-wallet-service-wbtw.onrender.com',
        authenticationToken: loyaltyCard.card_number
      }
    );

    pass.type = 'storeCard';
    pass.relevantDate = new Date().toISOString();

    const templateData = {
      customer: {
        full_name: customerData.full_name,
        email: customerData.email,
        phone: customerData.phone
      },
      loyaltyCard: {
        current_points: loyaltyCard.current_points || 0,
        current_stamps: loyaltyCard.current_stamps || 0,
        card_number: loyaltyCard.card_number
      }
    };

    // Agregar campos
    memberFields.forEach(field => {
      const value = processTemplate(field.valueTemplate, templateData);
      pass.secondaryFields.push({
        key: field.key,
        label: field.label,
        value: field.key.includes('points') || field.key.includes('stamps') ? Number(value) : value
      });
    });

    // Agregar backFields
    if (customFields && Array.isArray(customFields)) {
      const backsideTexts = customFields.filter(item => item.type === 'text');
      backsideTexts.forEach(item => {
        if (item.content && item.content.text) {
          pass.backFields.push({
            key: item.content.id,
            label: '',
            value: item.content.text
          });
        }
      });
    }

    if (linksFields && Array.isArray(linksFields)) {
      const activeLinks = linksFields.filter(link => link.enabled);
      activeLinks.forEach(link => {
        const href = getLinkHref(link.type, link.url);
        pass.backFields.push({
          key: link.id,
          label: link.name,
          value: link.url,
          attributedValue: `<a href="${href}">${link.url}</a>`,
          textAlignment: 'PKTextAlignmentLeft'
        });
      });
    }

    // Agregar barcode
    const barcodeMessage = processTemplate(barcodeConfig.message_template, templateData);
    pass.setBarcodes({
      message: barcodeMessage || customerData.id,
      format: barcodeConfig.format || 'PKBarcodeFormatQR',
      messageEncoding: barcodeConfig.encoding || 'iso-8859-1',
      altText: barcodeConfig.alt_text || ''
    });

    console.log('🗑️ Cleaning up images...');
    // Limpiar imágenes
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
    } catch (cleanupError) {
      // Ignorar errores
    }

    console.log('📦 Generating buffer...');
    const buffer = pass.getAsBuffer();
    console.log('✅ Pass generation completed successfully');

    res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
    res.setHeader('Content-Disposition', `attachment; filename="loyalty-${loyaltyCard.card_number}.pkpass"`);
    res.send(buffer);

  } catch (error) {
    console.error('❌ Failed to generate pass:', error);
    console.error('Error details:', error.message);
    console.error('Stack:', error.stack);
    res.status(500).json({ error: error.message });
  }
});

export default router;