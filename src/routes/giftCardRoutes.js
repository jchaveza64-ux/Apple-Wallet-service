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
        error: 'No wallet configuration found for Gift Cards in this business. Please create one in Configuración de Wallet Pass → Gift Card.'
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
    const linksFields = passkitConfig.links_fields || [];
    const customFields = passkitConfig.custom_fields || [];
    const barcodeConfig = passkitConfig.barcode_config || {};

    // ============================================
    // 4. PREPARAR TEMPLATE (carpeta separada de loyalty)
    // ============================================
    const templatePath = path.join(__dirname, '../templates/giftcard.pass');

    // Asegurar que la carpeta existe
    await fs.mkdir(templatePath, { recursive: true });

    // Escribir pass.json mínimo (los campos se configuran vía PKPass.from)
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
        description: appleConfig.description || 'Tarjeta de Regalo',
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
    // 6. CONFIGURAR CAMPOS — GIFT CARD
    // ============================================

    // Header: etiqueta Gift Card
    pass.headerFields.push({
      key: 'gift_label',
      label: 'GIFT CARD',
      value: '🎁'
    });

    // Secondary: puntos disponibles + beneficiario
    pass.secondaryFields.push({
      key: 'points',
      label: 'Puntos disponibles',
      value: giftCard.points_remaining,
      changeMessage: 'Tienes %@ puntos disponibles en tu Gift Card'
    });

    pass.secondaryFields.push({
      key: 'beneficiary',
      label: 'Beneficiario',
      value: giftCard.claimed_by_name || 'Portador'
    });

    // Auxiliary: negocio
    pass.auxiliaryFields.push({
      key: 'business',
      label: 'Negocio',
      value: businessData.name
    });

    console.log('✅ Gift Card fields configured');

    // ============================================
    // 7. REVERSO (backFields)
    // ============================================

    // Info de la gift card
    pass.backFields.push({
      key: 'gc_info',
      label: 'Información de tu Gift Card',
      value: `Esta es una Tarjeta de Regalo de ${businessData.name} con ${giftCard.points_loaded} puntos cargados. Preséntala en cualquier local para canjear tus puntos.`
    });

    pass.backFields.push({
      key: 'gc_points',
      label: 'Puntos originales',
      value: `${giftCard.points_loaded} puntos`
    });

    if (giftCard.claimed_by_email) {
      pass.backFields.push({
        key: 'gc_email',
        label: 'Email registrado',
        value: giftCard.claimed_by_email
      });
    }

    // Textos personalizados desde config
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

    // Links desde config
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

    console.log(`✅ Back fields: ${pass.backFields.length} fields`);

    // ============================================
    // 8. BARCODE — QR con token de la Gift Card
    // ============================================
    pass.setBarcodes({
      message: `GIFTCARD:${giftCard.token}`,
      format: barcodeConfig.format || 'PKBarcodeFormatQR',
      messageEncoding: barcodeConfig.encoding || 'iso-8859-1',
      altText: `Gift Card · ${giftCard.points_remaining} pts`
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
      // No falla la respuesta — el pass ya se envió.
      // El status se puede corregir manualmente si es necesario.
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
