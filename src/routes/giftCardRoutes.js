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

// ============================================
// HELPERS (independientes de walletRoutes.js)
// ============================================

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
 * Descarga una imagen desde URL y la guarda localmente
 */
async function downloadImage(url, destPath) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      // Seguir redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        return downloadImage(response.headers.location, destPath).then(resolve).catch(reject);
      }
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
 * Obtiene el href según el tipo de link
 */
function getLinkHref(type, url) {
  switch (type) {
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

/**
 * Procesa templates de valores dinámicos para Gift Cards
 * Soporta: {{gift_card.field}}, {{business.field}}, {{customers.field}}
 */
function processTemplate(template, data) {
  if (!template) return '';
  
  let result = template;
  
  // Reemplazar {{gift_card.field}}
  result = result.replace(/\{\{gift_card\.(\w+)\}\}/g, (match, field) => {
    return data.giftCard?.[field] ?? '';
  });
  
  // Reemplazar {{business.field}}
  result = result.replace(/\{\{business\.(\w+)\}\}/g, (match, field) => {
    return data.business?.[field] ?? '';
  });

  // Compatibilidad: {{customers.field}} → mapea a datos del beneficiario
  result = result.replace(/\{\{customers\.(\w+)\}\}/g, (match, field) => {
    const mapping = {
      full_name: data.giftCard?.claimed_by_name,
      email: data.giftCard?.claimed_by_email,
      name: data.giftCard?.claimed_by_name
    };
    return mapping[field] ?? '';
  });

  // Compatibilidad: {{loyalty_cards.field}} → mapea a datos de gift card
  result = result.replace(/\{\{loyalty_cards\.(\w+)\}\}/g, (match, field) => {
    const mapping = {
      current_points: data.giftCard?.points_remaining,
      card_number: data.serialNumber
    };
    return mapping[field] ?? '';
  });
  
  return result;
}

// ============================================
// RUTA: GET /gift-card/wallet?token=xxx
// Genera un .pkpass de Apple Wallet para una Gift Card
// ============================================
router.get('/gift-card/wallet', async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({
        error: 'Missing required parameter',
        required: ['token']
      });
    }

    console.log('🎁 Generating Gift Card pass for token:', token);

    // ============================================
    // 1. BUSCAR GIFT CARD POR TOKEN
    // ============================================
    const { data: giftCard, error: giftCardError } = await supabase
      .from('gift_cards')
      .select('*')
      .eq('token', token)
      .single();

    if (giftCardError || !giftCard) {
      console.error('❌ Gift card not found:', giftCardError);
      return res.status(404).json({ error: 'Gift card not found' });
    }

    // Solo se puede generar wallet para gift cards registradas
    if (giftCard.status !== 'registered') {
      console.error('❌ Gift card status invalid:', giftCard.status);
      return res.status(400).json({
        error: `Gift card is not available for wallet download (status: ${giftCard.status})`,
        status: giftCard.status
      });
    }

    console.log('✅ Gift Card found:', {
      id: giftCard.id,
      points: giftCard.points_loaded,
      beneficiary: giftCard.claimed_by_name
    });

    // ============================================
    // 2. OBTENER DATOS DEL NEGOCIO
    // ============================================
    const { data: businessData, error: businessError } = await supabase
      .from('businesses')
      .select('id, name, description')
      .eq('id', giftCard.business_id)
      .single();

    if (businessError || !businessData) {
      console.error('❌ Business not found:', businessError);
      return res.status(404).json({ error: 'Business not found' });
    }

    console.log('✅ Business:', businessData.name);

    // ============================================
    // 3. OBTENER CONFIGURACIÓN DE WALLET PARA GIFT CARDS
    // ============================================
    const { data: passkitConfig, error: passkitError } = await supabase
      .from('passkit_configs')
      .select('*')
      .eq('business_id', giftCard.business_id)
      .eq('program_type', 'gift_card')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (passkitError || !passkitConfig) {
      console.error('❌ Gift Card wallet config not found:', passkitError);
      return res.status(404).json({
        error: 'No wallet configuration found for Gift Cards in this business.'
      });
    }

    console.log('✅ PassKit Config:', passkitConfig.config_name);

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
    const linksFields = passkitConfig.links_fields || [];
    const customFields = passkitConfig.custom_fields || [];
    const barcodeConfig = passkitConfig.barcode_config || {};

    // ============================================
    // 4. PREPARAR TEMPLATE (carpeta separada de loyalty)
    // ============================================
    const templatePath = path.join(__dirname, '../templates/giftcard.pass');

    // Asegurar que la carpeta existe
    await fs.mkdir(templatePath, { recursive: true });

    // Escribir pass.json mínimo
    const passJsonContent = {
      formatVersion: 1,
      passTypeIdentifier: '',
      serialNumber: '',
      teamIdentifier: '',
      organizationName: '',
      description: 'Tarjeta de Regalo',
      storeCard: {}
    };
    await fs.writeFile(
      path.join(templatePath, 'pass.json'),
      JSON.stringify(passJsonContent)
    );

    // Limpiar imágenes viejas
    const imageFiles = [
      'logo.png', 'logo@2x.png', 'logo@3x.png',
      'icon.png', 'icon@2x.png', 'icon@3x.png',
      'strip.png', 'strip@2x.png', 'strip@3x.png'
    ];
    for (const file of imageFiles) {
      await fs.unlink(path.join(templatePath, file)).catch(() => {});
    }

    // ============================================
    // 4.1 DESCARGAR IMÁGENES DESDE CONFIG
    // ============================================
    console.log('📥 Downloading gift card images...');

    try {
      if (appleConfig.logo_url) {
        await downloadImage(appleConfig.logo_url, path.join(templatePath, 'logo.png'));
        await downloadImage(appleConfig.logo_url, path.join(templatePath, 'logo@2x.png'));
        await downloadImage(appleConfig.logo_url, path.join(templatePath, 'logo@3x.png'));
        console.log('✅ Logo downloaded');
      }

      if (appleConfig.icon_url) {
        await downloadImage(appleConfig.icon_url, path.join(templatePath, 'icon.png'));
        await downloadImage(appleConfig.icon_url, path.join(templatePath, 'icon@2x.png'));
        await downloadImage(appleConfig.icon_url, path.join(templatePath, 'icon@3x.png'));
        console.log('✅ Icon downloaded');
      }

      if (appleConfig.strip_image_url) {
        await downloadImage(appleConfig.strip_image_url, path.join(templatePath, 'strip.png'));
        await downloadImage(appleConfig.strip_image_url, path.join(templatePath, 'strip@2x.png'));
        await downloadImage(appleConfig.strip_image_url, path.join(templatePath, 'strip@3x.png'));
        console.log('✅ Strip downloaded');
      }
    } catch (imageError) {
      console.error('❌ Image download error:', imageError);
      return res.status(500).json({
        error: 'Failed to download images',
        details: imageError.message
      });
    }

    // ============================================
    // 4.2 INICIALIZAR CERTIFICADOS
    // ============================================
    await certificateManager.initialize();
    console.log('✅ Certificates initialized');

    // ============================================
    // 4.3 PREPARAR UBICACIONES
    // ============================================
    let passLocations = null;
    if (linkedLocations && linkedLocations.length > 0) {
      const validLocations = linkedLocations
        .filter(loc => {
          const lat = loc.locations?.latitude;
          const lng = loc.locations?.longitude;
          return lat && lng && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
        })
        .map(loc => ({
          latitude: Number(loc.locations.latitude),
          longitude: Number(loc.locations.longitude),
          relevantText: loc.locations.name
            ? `Cerca de ${loc.locations.name}`
            : 'Local cercano'
        }))
        .filter(Boolean);

      if (validLocations.length > 0) {
        passLocations = validLocations.slice(0, 10);
        console.log(`📍 Will add ${passLocations.length} locations to gift card pass`);
      }
    }

    const maxDistance = Number(appleConfig.max_distance || 200);
    const safeMaxDistance = Number.isFinite(maxDistance) && maxDistance > 0 ? maxDistance : 200;

    // ============================================
    // 5. CREAR EL PASE - GIFT CARD
    // ============================================
    const serialNumber = `GC-${giftCard.id.slice(0, 8)}-${Date.now()}`.toUpperCase();

    const pass = await PKPass.from(
      {
        model: templatePath,
        certificates: certificateManager.getAllCertificates()
      },
      {
        // CRÍTICO: Colores van aquí como segundo parámetro en formato RGB
        serialNumber: serialNumber,
        passTypeIdentifier: process.env.PASS_TYPE_IDENTIFIER || 'pass.com.innobizz.fidelityhub',
        teamIdentifier: appleConfig.team_id || process.env.TEAM_IDENTIFIER,
        organizationName: appleConfig.organization_name || passkitConfig.config_name || businessData.name,
        description: 'Tarjeta de Regalo',
        logoText: appleConfig.logo_text || 'Gift Card',
        backgroundColor: hexToRgb(appleConfig.background_color || '#6B21A8'),
        foregroundColor: hexToRgb(appleConfig.foreground_color || '#FFFFFF'),
        labelColor: hexToRgb(appleConfig.label_color || '#E9D5FF'),
        webServiceURL: process.env.BASE_URL || 'https://apple-wallet-service-wbtw.onrender.com',
        authenticationToken: serialNumber,
        sharingProhibited: false
      }
    );

    pass.type = 'storeCard';

    // Relevancia por ubicación
    if (passLocations && passLocations.length > 0) {
      pass.setLocations(...passLocations);
      pass.props.maxDistance = safeMaxDistance;
      console.log(`✅ Locations set: ${passLocations.length}, maxDistance=${safeMaxDistance}m`);
    }

    console.log('🎨 Gift Card colors:', {
      background: hexToRgb(appleConfig.background_color || '#6B21A8'),
      foreground: hexToRgb(appleConfig.foreground_color || '#FFFFFF'),
      label: hexToRgb(appleConfig.label_color || '#E9D5FF')
    });

    // ============================================
    // 6. CONFIGURAR CAMPOS — DESDE LA PLATAFORMA
    // ============================================

    // Datos disponibles para templates
    const templateData = {
      giftCard: {
        points_remaining: giftCard.points_remaining,
        points_loaded: giftCard.points_loaded,
        claimed_by_name: giftCard.claimed_by_name || 'Portador',
        claimed_by_email: giftCard.claimed_by_email || '',
        token: giftCard.token
      },
      business: {
        name: businessData.name,
        description: businessData.description || ''
      },
      serialNumber: serialNumber
    };

    // Header: GIFT CARD 🎁 (siempre visible arriba a la derecha)
    pass.headerFields.push({
      key: 'gift_label',
      label: '',
      value: 'GIFT CARD 🎁'
    });

    // Si hay member_fields configurados en la plataforma, usarlos
    // (igual que loyalty cards — el usuario define labels y valores)
    if (memberFields.length > 0) {
      memberFields.forEach(field => {
        const value = processTemplate(field.valueTemplate, templateData);
        
        const fieldData = {
          key: field.key,
          label: field.label,
          value: field.key.includes('points') ? Number(value) || value : value
        };

        // changeMessage para notificaciones automáticas de Apple
        if (field.key.includes('points')) {
          fieldData.changeMessage = '¡Ahora tienes %@ puntos en tu Gift Card!';
        }

        pass.secondaryFields.push(fieldData);
      });

      console.log(`✅ Fields from platform config: ${memberFields.length} fields`);

    } else {
      // DEFAULTS si no se han configurado member_fields en la plataforma
      pass.secondaryFields.push({
        key: 'points',
        label: 'Puntos disponibles',
        value: giftCard.points_remaining,
        changeMessage: '¡Ahora tienes %@ puntos en tu Gift Card!'
      });

      pass.secondaryFields.push({
        key: 'beneficiary',
        label: 'Beneficiario',
        value: giftCard.claimed_by_name || 'Portador'
      });

      console.log('✅ Using default gift card fields (no member_fields configured)');
    }

    // ============================================
    // 7. REVERSO (backFields) — DESDE LA PLATAFORMA
    // ============================================

    // 1️⃣ Textos personalizados desde custom_fields (configurados en la plataforma)
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

    // 2️⃣ Links desde links_fields (configurados en la plataforma)
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

    // Si no hay ningún backField configurado, poner un default mínimo
    if (pass.backFields.length === 0) {
      pass.backFields.push({
        key: 'gc_info',
        label: 'Gift Card',
        value: `Tarjeta de Regalo de ${businessData.name} con ${giftCard.points_loaded} puntos.`
      });
    }

    console.log(`✅ Back fields: ${pass.backFields.length} fields`);

    // ============================================
    // 8. BARCODE — QR con token de la Gift Card
    // ============================================
    const barcodeMessage = processTemplate(
      barcodeConfig.message_template, 
      templateData
    );

    pass.setBarcodes({
      message: barcodeMessage || `https://loyalty.innobizz.biz/meseros/gift-card/${giftCard.token}`,
      format: barcodeConfig.format || 'PKBarcodeFormatQR',
      messageEncoding: barcodeConfig.encoding || 'iso-8859-1',
      altText: barcodeConfig.alt_text || `Gift Card · ${giftCard.points_remaining} pts`
    });

    console.log('✅ Barcode configured');

    // ============================================
    // 9. GENERAR Y ENVIAR
    // ============================================
    const passBuffer = pass.getAsBuffer();
    console.log(`📦 Gift Card pass size: ${passBuffer.length} bytes`);

    const filename = `GiftCard-${businessData.name}-${giftCard.points_loaded}pts.pkpass`
      .replace(/[^a-zA-Z0-9\-_.]/g, '_');

    res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', passBuffer.length);
    res.send(passBuffer);

    console.log('✅ Gift Card pass sent successfully');

    // ============================================
    // 10. ACTUALIZAR STATUS → claimed
    // ============================================
    const { error: updateError } = await supabase
      .from('gift_cards')
      .update({ status: 'claimed' })
      .eq('id', giftCard.id)
      .eq('status', 'registered'); // Safety: solo actualiza si sigue en registered

    if (updateError) {
      console.error('⚠️ Failed to update gift card status:', updateError);
    } else {
      console.log('✅ Gift card status updated to claimed');
    }

    // ============================================
    // 11. LIMPIAR IMÁGENES TEMPORALES
    // ============================================
    try {
      for (const file of imageFiles) {
        await fs.unlink(path.join(templatePath, file)).catch(() => {});
      }
      console.log('🧹 Cleaned up temporary images');
    } catch (cleanupError) {
      // Ignorar errores de limpieza
    }

  } catch (error) {
    console.error('❌ Gift Card Error:', error);
    res.status(500).json({
      error: 'Failed to generate gift card pass',
      details: error.message
    });
  }
});

export default router;
