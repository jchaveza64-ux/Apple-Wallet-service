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
 * Convierte HEX a RGB para Apple Wallet
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
    const linksFields = passkitConfig.links_fields || [];
    const additionalFields = passkitConfig.additional_fields || [];

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
    // 5. CREAR EL PASE CON COLORES RGB EN SEGUNDO PARÁMETRO
    // ============================================
    const serialNumber = loyaltyCard?.card_number || `${businessId.slice(0, 8)}-${customerId.slice(0, 8)}`.toUpperCase();

    const pass = await PKPass.from(
      {
        model: templatePath,
        certificates: certificateManager.getAllCertificates()
      },
      {
        serialNumber: serialNumber,
        passTypeIdentifier: process.env.PASS_TYPE_IDENTIFIER || 'pass.com.innobizz.fidelityhub',
        teamIdentifier: appleConfig.team_id || process.env.TEAM_IDENTIFIER,
        organizationName: appleConfig.organization_name || passkitConfig.config_name,
        description: appleConfig.description || 'Tarjeta de Fidelidad',
        logoText: appleConfig.logo_text || '',
        backgroundColor: hexToRgb(appleConfig.background_color || '#121212'),
        foregroundColor: hexToRgb(appleConfig.foreground_color || '#ef852e'),
        labelColor: hexToRgb(appleConfig.label_color || '#FFFFFF')
      }
    );

    pass.type = 'storeCard';
    pass.relevantDate = new Date().toISOString();

    console.log('🎨 Colors applied:', {
      background: hexToRgb(appleConfig.background_color || '#121212'),
      foreground: hexToRgb(appleConfig.foreground_color || '#ef852e'),
      label: hexToRgb(appleConfig.label_color || '#FFFFFF')
    });

    // Web service
    pass.webServiceURL = process.env.BASE_URL || '';
    pass.authenticationToken = Buffer.from(`${customerId}-${businessId}-${Date.now()}`).toString('base64');

    // ============================================
    // 6. TODOS LOS CAMPOS VAN EN secondaryFields (IGNORAR position)
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

    // TODOS los campos van en secondaryFields para aparecer debajo del strip
    memberFields.forEach(field => {
      const value = processTemplate(field.valueTemplate, templateData);
      
      const fieldData = {
        key: field.key,
        label: field.label,
        value: field.key.includes('points') || field.key.includes('stamps') ? Number(value) : value
      };

      pass.secondaryFields.push(fieldData);
    });

    console.log('✅ Fields configured in secondaryFields (below strip)');

    // ============================================
    // 7. CONFIGURAR REVERSO (backFields) - NUEVA LÓGICA LOVABLE
    // ============================================
    
    // 1. Primero agregar textos (additional_fields con position === 'back')
    const backTexts = additionalFields.filter(f => f.enabled && f.position === 'back');
    
    backTexts.forEach((field, index) => {
      pass.backFields.push({
        key: field.id || `backtext_${index}`,
        label: field.label,
        value: field.value || ''
      });
    });

    // 2. Luego agregar links (links_fields)
    const activeLinks = linksFields.filter(link => link.enabled && link.url);
    
    activeLinks.forEach(link => {
      let value = link.url;
      let attributedValue = null;
      
      // Determinar attributedValue según el tipo
      if (link.type === 'phone') {
        attributedValue = `<a href="tel:${link.url}">${link.url}</a>`;
      } else if (link.type === 'email') {
        attributedValue = `<a href="mailto:${link.url}">${link.url}</a>`;
      } else if (['url', 'instagram', 'facebook', 'twitter', 'website'].includes(link.type)) {
        attributedValue = `<a href="${link.url}">${link.url}</a>`;
      }
      
      const fieldObj = {
        key: link.id,
        label: link.label.toUpperCase(),
        value: value
      };
      
      if (attributedValue) {
        fieldObj.attributedValue = attributedValue;
      }
      
      pass.backFields.push(fieldObj);
    });

    console.log(`✅ Back fields configured: ${pass.backFields.length} fields`);

    // ============================================
    // 8. BARCODE DESDE barcode_config
    // ============================================
    
    const barcodeMessage = processTemplate(barcodeConfig.message_template, templateData);
    
    pass.setBarcodes({
      message: barcodeMessage || customerId,
      format: barcodeConfig.format || 'PKBarcodeFormatQR',
      messageEncoding: barcodeConfig.encoding || 'iso-8859-1',
      altText: barcodeConfig.alt_text || ''
    });

    console.log('✅ Barcode configured:', barcodeConfig.alt_text);

    console.log('🔨 Pass configured with Supabase data (storeCard type)');

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