import express from 'express';
import { supabase } from '../config/supabase.js';
import { PKPass } from 'passkit-generator';
import certificateManager from '../config/certificates.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import https from 'https';
import apn from 'apn';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// ============================================
// SISTEMA DE LOCKS PARA EVITAR RACE CONDITIONS
// ============================================
const downloadLocks = new Map();

async function acquireLock(key) {
  while (downloadLocks.get(key)) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  downloadLocks.set(key, true);
}

function releaseLock(key) {
  downloadLocks.delete(key);
}

/**
 * Descarga imágenes para una configuración
 * USA LOCK para evitar que múltiples requests sobrescriban imágenes
 */
async function downloadConfigImages(appleConfig, templatePath) {
  const lockKey = 'image-download';
  
  try {
    await acquireLock(lockKey);
    console.log('📥 Downloading images for this config (LOCKED)...');

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

    console.log('✅ Images downloaded successfully');
  } finally {
    releaseLock(lockKey);
  }
}

/**
 * Configurar APNs provider
 */
let apnsProvider = null;
try {
  const apnsKey = process.env.APPLE_APNS_KEY
    ? process.env.APPLE_APNS_KEY.replace(/\\n/g, '\n')
    : null;

  if (!apnsKey || !process.env.APPLE_APNS_KEY_ID || !process.env.TEAM_IDENTIFIER) {
    console.log('⚠️ APNs credentials not configured - push notifications disabled');
  } else {
    const apnsOptions = {
      token: {
        key: apnsKey,
        keyId: process.env.APPLE_APNS_KEY_ID,
        teamId: process.env.TEAM_IDENTIFIER
      },
      production: process.env.NODE_ENV === 'production'
    };

    apnsProvider = new apn.Provider(apnsOptions);
    console.log('✅ APNs provider initialized');
  }
} catch (error) {
  console.error('❌ Failed to initialize APNs:', error.message);
}

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
    }).on('error', (err) => reject(err));
  });
}

/**
 * Procesa template
 */
function processTemplate(template, data) {
  if (!template) return '';
  let result = template;
  result = result.replace(/\{\{loyalty_cards\.(\w+)\}\}/g, (match, field) => {
    return data.loyaltyCard?.[field] || '';
  });
  result = result.replace(/\{\{customers\.(\w+)\}\}/g, (match, field) => {
    return data.customer?.[field] || '';
  });
  result = result.replace(/\{\{(\w+)\}\}/g, (match, field) => {
    return data.loyaltyCard?.[field] || data.customer?.[field] || '';
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

/**
 * Genera un pass actualizado
 */
async function generateUpdatedPass(serialNumber) {
  try {
    console.log('🔄 Starting generateUpdatedPass for:', serialNumber);

    console.log('📜 Initializing certificates...');
    await certificateManager.initialize();
    console.log('✅ Certificates initialized');

    console.log('🔍 Querying Supabase for loyalty card...');
    const { data: loyaltyCard, error: cardError } = await supabase
      .from('loyalty_cards')
      .select(`
        *,
        customers (
          id,
          full_name,
          email,
          phone,
          business_id
        )
      `)
      .eq('card_number', serialNumber)
      .single();

    if (cardError) {
      console.error('❌ Supabase error:', cardError);
      throw new Error(`Supabase error: ${cardError.message}`);
    }

    if (!loyaltyCard) {
      console.error('❌ Loyalty card not found');
      throw new Error('Loyalty card not found');
    }

    console.log('🔍 DEBUG - Points from Supabase:', loyaltyCard.current_points);
    console.log('✅ Loyalty card found');

    const customer = Array.isArray(loyaltyCard.customers)
      ? loyaltyCard.customers[0]
      : loyaltyCard.customers;

    // ============================================
    // 🔥 FIX CRÍTICO: Usar passkit_config_id de loyalty_card
    // ============================================
    console.log('🔍 Querying passkit_configs using loyalty card config_id...');
    console.log('Using passkit_config_id:', loyaltyCard.passkit_config_id);
    
    const { data: passkitConfig, error: configError } = await supabase
      .from('passkit_configs')
      .select('*')
      .eq('id', loyaltyCard.passkit_config_id)
      .single();

    if (configError) {
      console.error('❌ Config error:', configError);
      throw new Error(`Config error: ${configError.message}`);
    }

    if (!passkitConfig) {
      console.error('❌ Config not found');
      throw new Error('Config not found');
    }

    console.log('✅ Config found:', passkitConfig.config_name);
    console.log('✅ Using correct config_id:', passkitConfig.id);

    const appleConfig = passkitConfig.apple_config || {};
    const memberFields = passkitConfig.member_fields || [];
    const barcodeConfig = passkitConfig.barcode_config || {};
    const linksFields = passkitConfig.links_fields || [];
    const customFields = passkitConfig.custom_fields || [];

    // ⭐ CONSULTAR UBICACIONES VINCULADAS ⭐
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
    }

    // ✅ USAR TEMPLATE BASE COMPARTIDO
    const templatePath = path.join(__dirname, '../templates/loyalty.pass');

    await downloadConfigImages(appleConfig, templatePath);

    // ⭐ PREPARAR LOCATIONS (RELEVANCIA LOCK SCREEN) ⭐
    // Apple Wallet usa "locations" + "maxDistance" para sugerir en Lock Screen.
    let passLocations = undefined;

    if (linkedLocations && linkedLocations.length > 0) {
      const validLocations = linkedLocations
        .filter(loc => loc.locations && loc.locations.latitude != null && loc.locations.longitude != null)
        .map(loc => {
          const lat = Number(loc.locations.latitude);
          const lng = Number(loc.locations.longitude);

          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

          return {
            latitude: lat,
            longitude: lng,
            relevantText: loc.locations.name
              ? `Cerca de ${loc.locations.name}`
              : 'Local cercano'
          };
        })
        .filter(Boolean);

      if (validLocations.length > 0) {
        passLocations = validLocations.slice(0, 10);
        console.log(`📍 Will add ${passLocations.length} locations to pass (lock screen relevance)`);
      } else {
        console.log('ℹ️ No valid locations found (missing/invalid coordinates)');
      }
    } else {
      console.log('ℹ️ No locations linked to passkit_config');
    }

    const maxDistance = Number(appleConfig.max_distance || 200);
    const safeMaxDistance = Number.isFinite(maxDistance) && maxDistance > 0 ? maxDistance : 200;

    console.log('🎨 Creating pass...');
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
        labelColor: hexToRgb(appleConfig.label_color || '#FFFFFF'),
        webServiceURL: process.env.BASE_URL || 'https://apple-wallet-service-wbtw.onrender.com',
        authenticationToken: serialNumber,

        // (Opcional) Puedes dejar el spread, pero la parte CANÓNICA va debajo.
        ...(passLocations && { locations: passLocations }),
        ...(passLocations && { maxDistance: safeMaxDistance })
      }
    );

    pass.type = 'storeCard';

    // ==================================================
    // ✅ RELEVANCIA CANÓNICA (lo más confiable con la lib)
    // ==================================================
    if (passLocations && passLocations.length > 0) {
      pass.setLocations(...passLocations);
      pass.props.maxDistance = safeMaxDistance;
      console.log(`✅ Canonical relevance set: ${passLocations.length} locations, maxDistance=${safeMaxDistance}m`);
    }

    // RelevantDate (forma canónica)
    pass.setRelevantDate(new Date());

    const templateData = {
      customer: {
        full_name: customer.full_name,
        email: customer.email,
        phone: customer.phone
      },
      loyaltyCard: {
        current_points: loyaltyCard.current_points || 0,
        current_stamps: loyaltyCard.current_stamps || 0,
        card_number: serialNumber
      }
    };

    console.log('📝 Adding fields with points:', loyaltyCard.current_points);

    memberFields.forEach(field => {
      const value = processTemplate(field.valueTemplate, templateData);
      pass.secondaryFields.push({
        key: field.key,
        label: field.label,
        value: field.key.includes('points') || field.key.includes('stamps') ? Number(value) : value
      });
    });

    // ⭐ MENSAJES APPLE WALLET - PRIMERO (APARECEN ARRIBA) ⭐
    console.log('💬 Querying apple_wallet_messages...');
    const { data: messages, error: messagesError } = await supabase
      .from('apple_wallet_messages')
      .select('message_text, created_at')
      .eq('card_number', serialNumber)
      .order('created_at', { ascending: false })
      .limit(3);

    if (messagesError) {
      console.error('⚠️ Error querying messages:', messagesError);
    } else if (messages && messages.length > 0) {
      console.log(`📬 Adding ${messages.length} messages to pass (AT TOP)`);
      
      messages.forEach((msg, index) => {
        const dateLabel = new Date(msg.created_at).toLocaleDateString('es-ES', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'America/Lima'
        });
        
        pass.backFields.push({
          key: `apple_message_${index}`,
          label: dateLabel,
          value: msg.message_text
        });
      });
      
      console.log('✅ Messages added to top of backFields');
    } else {
      console.log('ℹ️ No messages found for this pass');
    }
    // ⭐ FIN MENSAJES ⭐

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

    const barcodeMessage = processTemplate(barcodeConfig.message_template, templateData);
    pass.setBarcodes({
      message: barcodeMessage || customer.id,
      format: barcodeConfig.format || 'PKBarcodeFormatQR',
      messageEncoding: barcodeConfig.encoding || 'iso-8859-1',
      altText: barcodeConfig.alt_text || ''
    });

    console.log('📦 Generating buffer...');
    const buffer = pass.getAsBuffer();
    console.log('✅ Pass generation completed successfully');

    return buffer;
  } catch (error) {
    console.error('💥 CRITICAL ERROR in generateUpdatedPass:', error);
    console.error('Stack trace:', error.stack);
    throw error;
  }
}

// ============================================
// 1. REGISTRAR DISPOSITIVO
// ============================================
router.post('/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber', async (req, res) => {
  try {
    const { deviceLibraryIdentifier, passTypeIdentifier, serialNumber } = req.params;
    const { pushToken } = req.body;
    const authToken = req.headers['authorization']?.replace('ApplePass ', '');

    if (!pushToken) {
      return res.status(400).json({ error: 'pushToken required' });
    }

    console.log('📱 Registering device:', { deviceLibraryIdentifier, serialNumber, pushToken });

    const { data: loyaltyCard } = await supabase
      .from('loyalty_cards')
      .select('*, customers(*)')
      .eq('card_number', serialNumber)
      .single();

    if (!loyaltyCard) {
      return res.status(404).json({ error: 'Pass not found' });
    }

    const customer = Array.isArray(loyaltyCard.customers)
      ? loyaltyCard.customers[0]
      : loyaltyCard.customers;

    const { error } = await supabase
      .from('device_registrations')
      .upsert({
        device_library_identifier: deviceLibraryIdentifier,
        push_token: pushToken,
        pass_type_identifier: passTypeIdentifier,
        serial_number: serialNumber,
        customer_id: customer.id,
        business_id: customer.business_id,
        authentication_token: authToken || '',
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'device_library_identifier,pass_type_identifier,serial_number'
      });

    if (error) {
      console.error('❌ Registration error:', error);
      return res.status(500).json({ error: error.message });
    }

    console.log('✅ Device registered successfully');
    res.status(201).send();

  } catch (error) {
    console.error('❌ Registration failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// 2. OBTENER PASSES ACTUALIZABLES
// ============================================
router.get('/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier', async (req, res) => {
  try {
    const { deviceLibraryIdentifier, passTypeIdentifier } = req.params;
    const { passesUpdatedSince } = req.query;

    console.log('🔍 Getting updatable passes:', { deviceLibraryIdentifier, passesUpdatedSince });

    let query = supabase
      .from('device_registrations')
      .select('serial_number, updated_at')
      .eq('device_library_identifier', deviceLibraryIdentifier)
      .eq('pass_type_identifier', passTypeIdentifier);

    if (passesUpdatedSince) {
      query = query.gt('updated_at', new Date(passesUpdatedSince).toISOString());
    }

    const { data, error } = await query;

    if (error) {
      console.error('❌ Query error:', error);
      return res.status(500).json({ error: error.message });
    }

    if (!data || data.length === 0) {
      return res.status(204).send();
    }

    const serialNumbers = data.map(d => d.serial_number);
    const lastUpdated = new Date(Math.max(...data.map(d => new Date(d.updated_at)))).toISOString();

    console.log(`✅ Found ${serialNumbers.length} updatable passes`);

    res.json({
      lastUpdated,
      serialNumbers
    });

  } catch (error) {
    console.error('❌ Failed to get passes:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// 3. OBTENER PASS ACTUALIZADO
// ============================================
router.get('/v1/passes/:passTypeIdentifier/:serialNumber', async (req, res) => {
  try {
    const { serialNumber } = req.params;
    const authToken = req.headers['authorization']?.replace('ApplePass ', '');

    console.log('📦 Getting updated pass:', { serialNumber });

    console.log('ℹ️ Auth token validation skipped');

    console.log('⏳ Calling generateUpdatedPass...');
    const passBuffer = await generateUpdatedPass(serialNumber);
    console.log('✅ generateUpdatedPass completed');

    console.log(`✅ Pass generated: ${passBuffer.length} bytes`);

    await supabase
      .from('device_registrations')
      .update({ updated_at: new Date().toISOString() })
      .eq('serial_number', serialNumber);

    res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
    res.setHeader('Last-Modified', new Date().toUTCString());
    res.send(passBuffer);

  } catch (error) {
    console.error('❌ Failed to generate pass:', error);
    console.error('Error details:', error.message);
    console.error('Stack:', error.stack);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// 4. DESREGISTRAR DISPOSITIVO
// ============================================
router.delete('/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber', async (req, res) => {
  try {
    const { deviceLibraryIdentifier, passTypeIdentifier, serialNumber } = req.params;

    console.log('🗑️ Unregistering device:', { deviceLibraryIdentifier, serialNumber });

    const { error } = await supabase
      .from('device_registrations')
      .delete()
      .eq('device_library_identifier', deviceLibraryIdentifier)
      .eq('pass_type_identifier', passTypeIdentifier)
      .eq('serial_number', serialNumber);

    if (error) {
      console.error('❌ Unregister error:', error);
      return res.status(500).json({ error: error.message });
    }

    console.log('✅ Device unregistered');
    res.status(200).send();

  } catch (error) {
    console.error('❌ Unregister failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// 5. ENVIAR PUSH NOTIFICATION (llamado por webhook)
// ============================================
router.post('/notify-update', async (req, res) => {
  try {
    const { serialNumber } = req.body;

    if (!serialNumber) {
      return res.status(400).json({ error: 'serialNumber required' });
    }

    console.log('🔔 Sending EMPTY push notification for:', serialNumber);

    // Buscar todos los dispositivos registrados para este pass
    const { data: registrations, error } = await supabase
      .from('device_registrations')
      .select('push_token')
      .eq('serial_number', serialNumber);

    if (error || !registrations || registrations.length === 0) {
      console.log('⚠️ No registered devices found');
      return res.status(200).json({ message: 'No devices to notify' });
    }

    if (!apnsProvider) {
      console.error('❌ APNs provider not initialized');
      return res.status(500).json({ error: 'APNs not configured' });
    }

    // ⭐ ENVIAR PUSH VACÍO - Apple Wallet maneja la notificación automáticamente
    const promises = registrations.map(async (registration) => {
      const notification = new apn.Notification();
      notification.topic = process.env.PASS_TYPE_IDENTIFIER || 'pass.com.innobizz.fidelityhub';
      
      // 🎯 PAYLOAD VACÍO - SIN alert, SIN sound, SIN contentAvailable
      // Apple Wallet detecta automáticamente el cambio y muestra la notificación
      notification.payload = {};

      try {
        const result = await apnsProvider.send(notification, registration.push_token);
        console.log('📤 Empty push sent:', result);
        return result;
      } catch (err) {
        console.error('❌ Push failed:', err);
        return null;
      }
    });

    await Promise.all(promises);

    console.log(`✅ Sent ${promises.length} EMPTY push notifications`);
    res.json({ message: `Notified ${promises.length} devices` });

  } catch (error) {
    console.error('❌ Notification failed:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
