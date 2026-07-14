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
      production: true
    };

    apnsProvider = new apn.Provider(apnsOptions);
    console.log('✅ APNs provider initialized (production mode)');
  }
} catch (error) {
  console.error('❌ Failed to initialize APNs:', error.message);
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return hex;
  const r = parseInt(result[1], 16);
  const g = parseInt(result[2], 16);
  const b = parseInt(result[3], 16);
  return `rgb(${r}, ${g}, ${b})`;
}

async function downloadImage(url, destPath) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
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
    }).on('error', (err) => reject(err));
  });
}

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

function processGiftCardTemplate(template, data) {
  if (!template) return '';
  let result = template;
  result = result.replace(/\{\{gift_card\.(\w+)\}\}/g, (match, field) => data.giftCard?.[field] ?? '');
  result = result.replace(/\{\{business\.(\w+)\}\}/g, (match, field) => data.business?.[field] ?? '');
  result = result.replace(/\{\{customers\.(\w+)\}\}/g, (match, field) => {
    const mapping = { full_name: data.giftCard?.claimed_by_name, email: data.giftCard?.claimed_by_email, name: data.giftCard?.claimed_by_name };
    return mapping[field] ?? '';
  });
  result = result.replace(/\{\{loyalty_cards\.(\w+)\}\}/g, (match, field) => {
    const mapping = { current_points: data.giftCard?.points_remaining, card_number: data.serialNumber };
    return mapping[field] ?? '';
  });
  return result;
}

function formatDateES(dateStr) {
  const date = new Date(dateStr);
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

function getLinkHref(type, url) {
  switch(type) {
    case 'phone': return `tel:${url.replace(/[^0-9+]/g, '')}`;
    case 'email': return `mailto:${url}`;
    case 'address': return `maps://?q=${encodeURIComponent(url)}`;
    default: return url.startsWith('http') ? url : `https://${url}`;
  }
}

// ============================================
// DETECTAR SI UN SERIAL ES GIFT CARD O LOYALTY
// ============================================
async function detectPassType(serialNumber) {
  // Intentar buscar en loyalty_cards primero
  const { data: loyaltyCard } = await supabase
    .from('loyalty_cards')
    .select('*, customers(*)')
    .eq('card_number', serialNumber)
    .single();
  
  if (loyaltyCard) {
    return { type: 'loyalty', data: loyaltyCard };
  }

  // Si no es loyalty, buscar en gift_cards por token
  const { data: giftCard } = await supabase
    .from('gift_cards')
    .select('*')
    .eq('token', serialNumber)
    .single();

  if (giftCard) {
    return { type: 'gift_card', data: giftCard };
  }

  return { type: null, data: null };
}

// ============================================
// GENERAR PASS ACTUALIZADO DE LOYALTY
// ============================================
async function generateUpdatedPass(serialNumber) {
  try {
    console.log('🔄 Starting generateUpdatedPass for:', serialNumber);

    await certificateManager.initialize();

    const { data: loyaltyCard, error: cardError } = await supabase
      .from('loyalty_cards')
      .select(`*, customers (id, full_name, email, phone, business_id)`)
      .eq('card_number', serialNumber)
      .single();

    if (cardError || !loyaltyCard) {
      throw new Error(`Loyalty card not found: ${cardError?.message}`);
    }

    const customer = Array.isArray(loyaltyCard.customers)
      ? loyaltyCard.customers[0]
      : loyaltyCard.customers;

    const { data: passkitConfig, error: configError } = await supabase
      .from('passkit_configs')
      .select('*')
      .eq('id', loyaltyCard.passkit_config_id)
      .single();

    if (configError || !passkitConfig) {
      throw new Error(`Config not found: ${configError?.message}`);
    }

    const programType = passkitConfig.program_type || 'points_fixed';
    const stampsRequired = passkitConfig.stamps_required || 10;
    const stampRewardText = passkitConfig.stamp_reward_text || 'Premio gratis';

    const appleConfig = passkitConfig.apple_config || {};
    const memberFields = passkitConfig.member_fields || [];
    const barcodeConfig = passkitConfig.barcode_config || {};
    const linksFields = passkitConfig.links_fields || [];
    const customFields = passkitConfig.custom_fields || [];

    const { data: linkedLocations } = await supabase
      .from('passkit_config_locations')
      .select(`location_id, locations (id, name, latitude, longitude, address)`)
      .eq('passkit_config_id', passkitConfig.id);

    const templatePath = path.join(__dirname, '../templates/loyalty.pass');
    await downloadConfigImages(appleConfig, templatePath);

    let passLocations = undefined;
    if (linkedLocations && linkedLocations.length > 0) {
      const validLocations = linkedLocations
        .filter(loc => loc.locations && loc.locations.latitude != null && loc.locations.longitude != null)
        .map(loc => {
          const lat = Number(loc.locations.latitude);
          const lng = Number(loc.locations.longitude);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
          return { latitude: lat, longitude: lng, relevantText: loc.locations.name ? `Cerca de ${loc.locations.name}` : 'Local cercano' };
        })
        .filter(Boolean);
      if (validLocations.length > 0) passLocations = validLocations.slice(0, 10);
    }

    const maxDistance = Number(appleConfig.max_distance || 200);
    const safeMaxDistance = Number.isFinite(maxDistance) && maxDistance > 0 ? maxDistance : 200;

    const pass = await PKPass.from(
      { model: templatePath, certificates: certificateManager.getAllCertificates() },
      {
        serialNumber, passTypeIdentifier: process.env.PASS_TYPE_IDENTIFIER || 'pass.com.innobizz.fidelityhub',
        teamIdentifier: appleConfig.team_id || process.env.TEAM_IDENTIFIER,
        organizationName: appleConfig.organization_name || passkitConfig.config_name,
        description: appleConfig.description || 'Tarjeta de Fidelidad',
        logoText: appleConfig.logo_text || '',
        backgroundColor: hexToRgb(appleConfig.background_color || '#121212'),
        foregroundColor: hexToRgb(appleConfig.foreground_color || '#ef852e'),
        labelColor: hexToRgb(appleConfig.label_color || '#FFFFFF'),
        webServiceURL: process.env.BASE_URL || 'https://apple-wallet-service-wbtw.onrender.com',
        authenticationToken: serialNumber,
        sharingProhibited: appleConfig.sharingProhibited === true,
        ...(passLocations && { locations: passLocations }),
        ...(passLocations && { maxDistance: safeMaxDistance })
      }
    );

    pass.type = 'storeCard';

    if (passLocations && passLocations.length > 0) {
      pass.setLocations(...passLocations);
      pass.props.maxDistance = safeMaxDistance;
    }

    const templateData = {
      customer: { full_name: customer.full_name, email: customer.email, phone: customer.phone },
      loyaltyCard: { current_points: loyaltyCard.current_points || 0, current_stamps: loyaltyCard.current_stamps || 0, card_number: serialNumber }
    };

    if (programType === 'stamps') {
      const currentStamps = loyaltyCard.current_stamps || 0;
      pass.secondaryFields.push({ key: 'stamps', label: 'Sellos', value: `${currentStamps} de ${stampsRequired}`, changeMessage: 'Ahora tienes %@ sellos' });
      pass.secondaryFields.push({ key: 'reward', label: 'Premio', value: stampRewardText });
    } else {
      memberFields.forEach(field => {
        const value = processTemplate(field.valueTemplate, templateData);
        pass.secondaryFields.push({
          key: field.key, label: field.label,
          value: field.key.includes('points') || field.key.includes('stamps') ? Number(value) : value,
          changeMessage: '¡Ahora tienes %@ puntos!'
        });
      });
    }

    // Mensajes Apple Wallet con changeMessage para lock screen
    const { data: messages } = await supabase
      .from('apple_wallet_messages')
      .select('message_text, created_at')
      .eq('card_number', serialNumber)
      .order('created_at', { ascending: false })
      .limit(3);

    if (messages && messages.length > 0) {
      pass.backFields.push({
        key: 'latest_notification',
        label: '📢 Última notificación',
        value: messages[0].message_text,
        changeMessage: '%@'
      });
      
      messages.forEach((msg, index) => {
        const dateLabel = new Date(msg.created_at).toLocaleDateString('es-ES', {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Lima'
        });
        pass.backFields.push({ key: `apple_message_${index}`, label: dateLabel, value: msg.message_text });
      });
    }

    if (customFields && Array.isArray(customFields)) {
      customFields.filter(item => item.type === 'text').forEach(item => {
        if (item.content?.text) pass.backFields.push({ key: item.content.id, label: '', value: item.content.text });
      });
    }

    if (linksFields && Array.isArray(linksFields)) {
      linksFields.filter(link => link.enabled).forEach(link => {
        const href = getLinkHref(link.type, link.url);
        pass.backFields.push({ key: link.id, label: link.name, value: link.url, attributedValue: `<a href="${href}">${link.url}</a>`, textAlignment: 'PKTextAlignmentLeft' });
      });
    }

    const barcodeMessage = processTemplate(barcodeConfig.message_template, templateData);
    pass.setBarcodes({ message: barcodeMessage || customer.id, format: barcodeConfig.format || 'PKBarcodeFormatQR', messageEncoding: barcodeConfig.encoding || 'iso-8859-1', altText: barcodeConfig.alt_text || '' });

    return pass.getAsBuffer();
  } catch (error) {
    console.error('💥 CRITICAL ERROR in generateUpdatedPass:', error);
    throw error;
  }
}

// ============================================
// GENERAR PASS ACTUALIZADO DE GIFT CARD
// ============================================
async function generateUpdatedGiftCardPass(serialNumber) {
  try {
    console.log('🔄 Starting generateUpdatedGiftCardPass for token:', serialNumber);

    await certificateManager.initialize();

    const { data: giftCard, error: gcError } = await supabase
      .from('gift_cards')
      .select('*')
      .eq('token', serialNumber)
      .single();

    if (gcError || !giftCard) {
      throw new Error(`Gift card not found: ${gcError?.message}`);
    }

    const { data: businessData } = await supabase
      .from('businesses')
      .select('id, name, description, published_domain')
      .eq('id', giftCard.business_id)
      .single();

    if (!businessData) throw new Error('Business not found');

    const resolvedDomain = businessData.published_domain || 'loyalty.innobizz.biz';

    const { data: passkitConfig } = await supabase
      .from('passkit_configs')
      .select('*')
      .eq('business_id', giftCard.business_id)
      .eq('program_type', 'gift_card')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!passkitConfig) throw new Error('Gift Card wallet config not found');

    const appleConfig = passkitConfig.apple_config || {};
    const memberFields = passkitConfig.member_fields || [];
    const linksFields = passkitConfig.links_fields || [];
    const customFields = passkitConfig.custom_fields || [];
    const barcodeConfig = passkitConfig.barcode_config || {};

    const { data: linkedLocations } = await supabase
      .from('passkit_config_locations')
      .select(`location_id, locations (id, name, latitude, longitude, address)`)
      .eq('passkit_config_id', passkitConfig.id);

    const templatePath = path.join(__dirname, '../templates/giftcard.pass');
    await fs.mkdir(templatePath, { recursive: true });

    await fs.writeFile(path.join(templatePath, 'pass.json'), JSON.stringify({
      formatVersion: 1, passTypeIdentifier: '', serialNumber: '', teamIdentifier: '',
      organizationName: '', description: 'Tarjeta de Regalo', storeCard: {}
    }));

    const imageFiles = ['logo.png','logo@2x.png','logo@3x.png','icon.png','icon@2x.png','icon@3x.png','strip.png','strip@2x.png','strip@3x.png'];
    for (const f of imageFiles) await fs.unlink(path.join(templatePath, f)).catch(() => {});

    await downloadConfigImages(appleConfig, templatePath);

    let passLocations = null;
    if (linkedLocations && linkedLocations.length > 0) {
      const valid = linkedLocations
        .filter(l => l.locations?.latitude && l.locations?.longitude && Number.isFinite(Number(l.locations.latitude)) && Number.isFinite(Number(l.locations.longitude)))
        .map(l => ({ latitude: Number(l.locations.latitude), longitude: Number(l.locations.longitude), relevantText: l.locations.name ? `Cerca de ${l.locations.name}` : 'Local cercano' }));
      if (valid.length > 0) passLocations = valid.slice(0, 10);
    }

    const maxDistance = Number(appleConfig.max_distance || 200);
    const safeMaxDistance = Number.isFinite(maxDistance) && maxDistance > 0 ? maxDistance : 200;

    const pass = await PKPass.from(
      { model: templatePath, certificates: certificateManager.getAllCertificates() },
      {
        serialNumber, passTypeIdentifier: process.env.PASS_TYPE_IDENTIFIER || 'pass.com.innobizz.fidelityhub',
        teamIdentifier: appleConfig.team_id || process.env.TEAM_IDENTIFIER,
        organizationName: appleConfig.organization_name || passkitConfig.config_name || businessData.name,
        description: 'Tarjeta de Regalo',
        logoText: appleConfig.logo_text || 'Gift Card',
        backgroundColor: hexToRgb(appleConfig.background_color || '#6B21A8'),
        foregroundColor: hexToRgb(appleConfig.foreground_color || '#FFFFFF'),
        labelColor: hexToRgb(appleConfig.label_color || '#E9D5FF'),
        webServiceURL: process.env.BASE_URL || 'https://apple-wallet-service-wbtw.onrender.com',
        authenticationToken: serialNumber,
        sharingProhibited: passkitConfig?.secure_fields?.sharing_prohibited === true
      }
    );

    pass.type = 'storeCard';

    if (giftCard.expires_at) {
      pass.setExpirationDate(new Date(giftCard.expires_at));
    }

    if (passLocations && passLocations.length > 0) {
      pass.setLocations(...passLocations);
      pass.props.maxDistance = safeMaxDistance;
    }

    const templateData = {
      giftCard: { points_remaining: giftCard.points_remaining, points_loaded: giftCard.points_loaded, claimed_by_name: giftCard.claimed_by_name || 'Portador', claimed_by_email: giftCard.claimed_by_email || '', token: giftCard.token },
      business: { name: businessData.name, description: businessData.description || '' },
      serialNumber
    };

    pass.headerFields.push({ key: 'gift_label', label: '', value: 'GIFT CARD 🎁' });

    if (memberFields.length > 0) {
      memberFields.forEach(field => {
        const value = processGiftCardTemplate(field.valueTemplate, templateData);
        const fd = { key: field.key, label: field.label, value: field.key.includes('points') ? Number(value) || value : value };
        if (field.key.includes('points')) fd.changeMessage = '¡Ahora tienes %@ puntos en tu Gift Card!';
        pass.secondaryFields.push(fd);
      });
    } else {
      pass.secondaryFields.push({ key: 'points', label: 'Puntos disponibles', value: giftCard.points_remaining, changeMessage: '¡Ahora tienes %@ puntos en tu Gift Card!' });
      pass.secondaryFields.push({ key: 'beneficiary', label: 'Beneficiario', value: giftCard.claimed_by_name || 'Portador' });
    }

    if (giftCard.expires_at) {
      pass.auxiliaryFields.push({ key: 'expiration', label: 'Vence', value: formatDateES(giftCard.expires_at), changeMessage: 'Tu Gift Card vence el %@' });
    }

    // Mensajes con changeMessage para lock screen
    const { data: messages } = await supabase
      .from('apple_wallet_messages')
      .select('message_text, created_at')
      .eq('card_number', serialNumber)
      .order('created_at', { ascending: false })
      .limit(3);

    if (messages && messages.length > 0) {
      pass.backFields.push({ key: 'latest_notification', label: '📢 Última notificación', value: messages[0].message_text, changeMessage: '%@' });
      messages.forEach((msg, i) => {
        const dateLabel = new Date(msg.created_at).toLocaleDateString('es-ES', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Lima' });
        pass.backFields.push({ key: `gc_message_${i}`, label: dateLabel, value: msg.message_text });
      });
    }

    if (giftCard.expires_at) {
      pass.backFields.push({ key: 'expiration_detail', label: '📅 Vigencia', value: `Esta Gift Card vence el ${formatDateES(giftCard.expires_at)}. Después de esta fecha no podrá ser utilizada.` });
    }

    if (customFields && Array.isArray(customFields)) {
      customFields.filter(item => item.type === 'text').forEach(item => {
        if (item.content?.text) pass.backFields.push({ key: item.content.id, label: '', value: item.content.text });
      });
    }

    if (linksFields && Array.isArray(linksFields)) {
      linksFields.filter(link => link.enabled).forEach(link => {
        const href = getLinkHref(link.type, link.url);
        pass.backFields.push({ key: link.id, label: link.name, value: link.url, attributedValue: `<a href="${href}">${link.url}</a>`, textAlignment: 'PKTextAlignmentLeft' });
      });
    }

    if (pass.backFields.length === 0) {
      pass.backFields.push({ key: 'gc_info', label: 'Gift Card', value: `Tarjeta de Regalo de ${businessData.name} con ${giftCard.points_loaded} puntos.` });
    }

    const barcodeMessage = processGiftCardTemplate(barcodeConfig.message_template, templateData);
    pass.setBarcodes({
      message: barcodeMessage || `https://${resolvedDomain}/meseros/gift-card/${giftCard.token}`,
      format: barcodeConfig.format || 'PKBarcodeFormatQR',
      messageEncoding: barcodeConfig.encoding || 'iso-8859-1',
      altText: barcodeConfig.alt_text || `Gift Card · ${giftCard.points_remaining} pts`
    });

    const buffer = pass.getAsBuffer();
    console.log('✅ Gift Card pass regenerated:', buffer.length, 'bytes');

    // Limpiar imágenes temporales
    for (const f of imageFiles) await fs.unlink(path.join(templatePath, f)).catch(() => {});

    return buffer;
  } catch (error) {
    console.error('💥 CRITICAL ERROR in generateUpdatedGiftCardPass:', error);
    throw error;
  }
}

// ============================================
// 1. REGISTRAR DISPOSITIVO (Loyalty + Gift Card)
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

    // Detectar si es Loyalty o Gift Card
    const passInfo = await detectPassType(serialNumber);

    if (!passInfo.data) {
      console.error('❌ Pass not found for serial:', serialNumber);
      return res.status(404).json({ error: 'Pass not found' });
    }

    let customerId, businessId;

    if (passInfo.type === 'loyalty') {
      const customer = Array.isArray(passInfo.data.customers)
        ? passInfo.data.customers[0]
        : passInfo.data.customers;
      customerId = customer.id;
      businessId = customer.business_id;
      console.log('✅ Loyalty pass detected for:', customer.full_name);
    } else {
      // Gift Card: usar datos directos de la gift card
      customerId = passInfo.data.id;
      businessId = passInfo.data.business_id;
      console.log('✅ Gift Card pass detected, business:', businessId);
    }

    const { error } = await supabase
      .from('device_registrations')
      .upsert({
        device_library_identifier: deviceLibraryIdentifier,
        push_token: pushToken,
        pass_type_identifier: passTypeIdentifier,
        serial_number: serialNumber,
        customer_id: customerId,
        business_id: businessId,
        authentication_token: authToken || '',
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'device_library_identifier,pass_type_identifier,serial_number'
      });

    if (error) {
      console.error('❌ Registration error:', error);
      return res.status(500).json({ error: error.message });
    }

    console.log('✅ Device registered successfully for', passInfo.type);
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

    let query = supabase
      .from('device_registrations')
      .select('serial_number, updated_at')
      .eq('device_library_identifier', deviceLibraryIdentifier)
      .eq('pass_type_identifier', passTypeIdentifier);

    if (passesUpdatedSince) {
      query = query.gt('updated_at', new Date(passesUpdatedSince).toISOString());
    }

    const { data, error } = await query;

    if (error) return res.status(500).json({ error: error.message });
    if (!data || data.length === 0) return res.status(204).send();

    const serialNumbers = data.map(d => d.serial_number);
    const lastUpdated = new Date(Math.max(...data.map(d => new Date(d.updated_at)))).toISOString();

    res.json({ lastUpdated, serialNumbers });

  } catch (error) {
    console.error('❌ Failed to get passes:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// 3. OBTENER PASS ACTUALIZADO (Loyalty + Gift Card)
// ============================================
router.get('/v1/passes/:passTypeIdentifier/:serialNumber', async (req, res) => {
  try {
    const { serialNumber, passTypeIdentifier } = req.params;
    const authToken = req.headers['authorization']?.replace('ApplePass ', '');

    console.log('📦 Getting updated pass:', { serialNumber });

    // Auto-registro si no existe
    const { data: existingRegistration } = await supabase
      .from('device_registrations')
      .select('*')
      .eq('serial_number', serialNumber)
      .single();

    if (!existingRegistration) {
      console.log('⚠️ Device not registered, attempting auto-registration...');
      
      const passInfo = await detectPassType(serialNumber);

      if (passInfo.data) {
        let customerId, businessId;
        
        if (passInfo.type === 'loyalty') {
          const customer = Array.isArray(passInfo.data.customers) ? passInfo.data.customers[0] : passInfo.data.customers;
          customerId = customer.id;
          businessId = customer.business_id;
        } else {
          customerId = passInfo.data.id;
          businessId = passInfo.data.business_id;
        }

        await supabase.from('device_registrations').insert({
          device_library_identifier: `auto-${Date.now()}-${serialNumber.slice(-8)}`,
          push_token: 'auto-registered',
          pass_type_identifier: passTypeIdentifier,
          serial_number: serialNumber,
          customer_id: customerId,
          business_id: businessId,
          authentication_token: authToken || serialNumber,
          updated_at: new Date().toISOString()
        });

        console.log('✅ Device auto-registered for', passInfo.type);

        if (passInfo.type === 'loyalty') {
          await supabase
            .from('loyalty_cards')
            .update({ wallet_type_override: 'apple', wallet_status: 'active' })
            .eq('card_number', serialNumber);
        }
      }
    }

    // Detectar tipo y generar pass correspondiente
    const passInfo = await detectPassType(serialNumber);
    
    let passBuffer;
    if (passInfo.type === 'gift_card') {
      console.log('🎁 Generating updated Gift Card pass');
      passBuffer = await generateUpdatedGiftCardPass(serialNumber);
    } else {
      console.log('🎫 Generating updated Loyalty pass');
      passBuffer = await generateUpdatedPass(serialNumber);
    }

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
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// 4. DESREGISTRAR DISPOSITIVO
// ============================================
router.delete('/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber', async (req, res) => {
  try {
    const { deviceLibraryIdentifier, passTypeIdentifier, serialNumber } = req.params;

    const { error } = await supabase
      .from('device_registrations')
      .delete()
      .eq('device_library_identifier', deviceLibraryIdentifier)
      .eq('pass_type_identifier', passTypeIdentifier)
      .eq('serial_number', serialNumber);

    if (error) return res.status(500).json({ error: error.message });

    console.log('✅ Device unregistered');
    res.status(200).send();

  } catch (error) {
    console.error('❌ Unregister failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// 5. ENVIAR PUSH NOTIFICATION
// ============================================
router.post('/notify-update', async (req, res) => {
  try {
    const { serialNumber } = req.body;

    if (!serialNumber) {
      return res.status(400).json({ error: 'serialNumber required' });
    }

    console.log('🔔 Sending EMPTY push notification for:', serialNumber);

    const { data: registrations, error } = await supabase
      .from('device_registrations')
      .select('push_token')
      .eq('serial_number', serialNumber)
      .neq('push_token', 'auto-registered');

    if (error || !registrations || registrations.length === 0) {
      console.log('⚠️ No registered devices found with valid push tokens for:', serialNumber);
      return res.status(200).json({ message: 'No devices to notify', serialNumber });
    }

    if (!apnsProvider) {
      console.error('❌ APNs provider not initialized');
      return res.status(500).json({ error: 'APNs not configured' });
    }

    let successCount = 0;
    let failCount = 0;

    const promises = registrations.map(async (registration) => {
      const notification = new apn.Notification();
      notification.topic = process.env.PASS_TYPE_IDENTIFIER || 'pass.com.innobizz.fidelityhub';
      notification.payload = {};
      notification.pushType = 'background';
      notification.priority = 5;

      try {
        const result = await apnsProvider.send(notification, registration.push_token);
        if (result.failed && result.failed.length > 0) {
          console.error('❌ Push failed for token:', result.failed[0].response);
          failCount++;
        } else {
          successCount++;
        }
        return result;
      } catch (err) {
        console.error('❌ Push error:', err.message);
        failCount++;
        return null;
      }
    });

    await Promise.all(promises);

    console.log(`✅ Push results: ${successCount} sent, ${failCount} failed out of ${registrations.length} devices`);
    res.json({ message: `Notified ${successCount} devices`, sent: successCount, failed: failCount, total: registrations.length });

  } catch (error) {
    console.error('❌ Notification failed:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
