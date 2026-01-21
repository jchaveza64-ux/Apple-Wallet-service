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

/**
 * Obtiene el href correcto según el tipo de link
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

    console.log('✅ Customer:', customerData.full_name);

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
    // 3. OBTENER CONFIGURACIÓN COMPLETA (DIRECTO DE PASSKIT_CONFIGS)
    // ============================================
    console.log('🔍 Querying passkit config directly with ID:', configId);

    const { data: passkitConfig, error: passkitError } = await supabase
      .from('passkit_configs')
      .select('*')
      .eq('id', configId)
      .single();

    if (passkitError || !passkitConfig) {
      console.error('❌ PassKit config not found:', passkitError);
      return res.status(404).json({ error: 'Config not found' });
    }

    // Validar que el business_id coincida
    if (passkitConfig.business_id !== businessId) {
      console.error('❌ Business ID mismatch');
      return res.status(403).json({ error: 'Business ID mismatch' });
    }

    console.log('✅ PassKit Config:', passkitConfig.config_name);

    // ⭐ NUEVO: Obtener tipo de programa
    const programType = passkitConfig.program_type || 'points_fixed';
    const stampsRequired = passkitConfig.stamps_required || 10;
    const stampRewardText = passkitConfig.stamp_reward_text || 'Premio gratis';
    
    console.log('🎯 Program Type:', programType);
    if (programType === 'stamps') {
      console.log('🎫 Stamps Config:', `${stampsRequired} sellos = ${stampRewardText}`);
    }

    // ============================================
    // 3.5 OBTENER UBICACIONES VINCULADAS
    // ============================================
    console.log('📍 Querying linked locations...');
    const { data: linkedLocations, error: locationsError } = await supabase
      .from('passkit_config_locations')
      .select(`
        location_id,
        locations (
          id,
          name,
          latitude,
          longitude,
          address
        )
      `)
      .eq('passkit_config_id', passkitConfig.id);

    if (locationsError) {
      console.error('⚠️ Error querying locations:', locationsError);
    } else {
      console.log(`✅ Found ${linkedLocations?.length || 0} linked locations`);
    }

    const appleConfig = passkitConfig.apple_config || {};
    const memberFields = passkitConfig.member_fields || [];
    const barcodeConfig = passkitConfig.barcode_config || {};
    const linksFields = passkitConfig.links_fields || [];
    const customFields = passkitConfig.custom_fields || [];

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
      if (appleConfig.strip_url) {
        await downloadImage(appleConfig.strip_url, path.join(templatePath, 'strip.png'));
        await downloadImage(appleConfig.strip_url, path.join(templatePath, 'strip@2x.png'));
        await downloadImage(appleConfig.strip_url, path.join(templatePath, 'strip@3x.png'));
        console.log('✅ Strip downloaded');
      }

    } catch (imageError) {
      console.error('❌ Image download error:', imageError);
      return res.status(500).json({ 
        error: 'Failed to download images from Supabase',
        details: imageError.message 
      });
    }

    // ============================================
    // 4.5 INICIALIZAR CERTIFICADOS (CRÍTICO)
    // ============================================
    await certificateManager.initialize();
    console.log('✅ Certificates initialized');

    // ============================================
    // 5. CREAR EL PASE - CRÍTICO: webServiceURL Y authenticationToken VAN AQUÍ
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
        logoText: appleConfig.logo_text || undefined,
        backgroundColor: hexToRgb(appleConfig.background_color || '#121212'),
        foregroundColor: hexToRgb(appleConfig.foreground_color || '#ef852e'),
        labelColor: hexToRgb(appleConfig.label_color || '#FFFFFF'),
        webServiceURL: process.env.BASE_URL || 'https://apple-wallet-service-wbtw.onrender.com',
        authenticationToken: serialNumber,
        sharingProhibited: appleConfig.sharingProhibited === true
      }
    );

    pass.type = 'storeCard';
    pass.relevantDate = new Date().toISOString();

    // ⭐ AGREGAR UBICACIONES AL PASS ⭐
    if (linkedLocations && linkedLocations.length > 0) {
      const validLocations = linkedLocations
        .filter(loc => loc.locations && loc.locations.latitude && loc.locations.longitude)
        .map(loc => ({
          latitude: Number(loc.locations.latitude),
          longitude: Number(loc.locations.longitude),
          relevantText: `Visita ${loc.locations.name || 'nuestro local'}`
        }));

      if (validLocations.length > 0) {
        pass.locations = validLocations;
        console.log(`📍 Added ${validLocations.length} locations to pass`);
      } else {
        console.log('ℹ️ No valid locations found (missing coordinates)');
      }
    } else {
      console.log('ℹ️ No locations linked to passkit_config');
    }

    console.log('🎨 Colors applied:', {
      background: hexToRgb(appleConfig.background_color || '#121212'),
      foreground: hexToRgb(appleConfig.foreground_color || '#ef852e'),
      label: hexToRgb(appleConfig.label_color || '#FFFFFF')
    });

    console.log('🌐 WebService configured:', process.env.BASE_URL || 'https://apple-wallet-service-wbtw.onrender.com');
    console.log('🔑 Auth token:', serialNumber);

    // ============================================
    // 6. CONFIGURAR CAMPOS SEGÚN TIPO DE PROGRAMA
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

    // ⭐ LÓGICA SEGÚN TIPO DE PROGRAMA ⭐
    if (programType === 'stamps') {
      // SISTEMA DE SELLOS
      const currentStamps = loyaltyCard?.current_stamps || 0;
      
      pass.secondaryFields.push({
        key: 'stamps',
        label: 'Sellos',
        value: `${currentStamps} de ${stampsRequired}`,
        changeMessage: `Ahora tienes %@ sellos`
      });

      pass.secondaryFields.push({
        key: 'reward',
        label: 'Premio',
        value: stampRewardText
      });

      console.log(`✅ Stamps configured: ${currentStamps}/${stampsRequired}`);
      
    } else {
      // SISTEMA DE PUNTOS (points_fixed O points_amount)
      // Visualmente son iguales, la diferencia está en cómo se acumulan (frontend)
      
      memberFields.forEach(field => {
        const value = processTemplate(field.valueTemplate, templateData);
        
        const fieldData = {
          key: field.key,
          label: field.label,
          value: field.key.includes('points') || field.key.includes('stamps') ? Number(value) : value
        };

        // AGREGAR changeMessage para notificaciones automáticas de Apple
        if (field.key.includes('points')) {
          fieldData.changeMessage = '¡Ahora tienes %@ puntos!';
        } else if (field.key.includes('stamps')) {
          fieldData.changeMessage = '¡Ahora tienes %@ sellos!';
        }

        pass.secondaryFields.push(fieldData);
      });

      console.log(`✅ Points configured: ${loyaltyCard?.current_points || 0}`);
    }

    console.log('✅ Fields configured in secondaryFields (below strip) with changeMessage');

    // ============================================
    // 7. CONFIGURAR REVERSO (backFields) - ORDEN: TEXTOS + LINKS
    // ============================================
    
    // 1️⃣ PRIMERO: Textos desde custom_fields (type === "text")
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

    // 2️⃣ DESPUÉS: Links desde links_fields
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