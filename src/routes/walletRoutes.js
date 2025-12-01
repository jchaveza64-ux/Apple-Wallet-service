import express from 'express';
import { supabase } from '../config/supabase.js';
import { PKPass } from 'passkit-generator';
import certificateManager from '../config/certificates.js';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

/**
 * Descarga una imagen desde una URL y la guarda localmente
 */
async function downloadImage(url, filepath) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(filepath);
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(filepath);
      });
    }).on('error', (err) => {
      fs.unlink(filepath);
      reject(err);
    });
  });
}

/**
 * Convierte color hex a formato RGB para Apple Wallet
 */
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return 'rgb(0, 0, 0)';
  return `rgb(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)})`;
}

/**
 * Genera un template temporal con imágenes descargadas de Supabase
 */
async function createDynamicTemplate(appleConfig) {
  const tempDir = path.join(__dirname, '../temp', `pass-${Date.now()}`);
  const passDir = path.join(tempDir, 'dynamic.pass');
  
  // Crear directorios
  await fs.mkdir(passDir, { recursive: true });

  console.log('📥 Downloading images from Supabase...');

  // Descargar imágenes desde Supabase
  const downloads = [];

  if (appleConfig.logo_url) {
    downloads.push(
      downloadImage(appleConfig.logo_url, path.join(passDir, 'logo.png')),
      downloadImage(appleConfig.logo_url, path.join(passDir, 'logo@2x.png')),
      downloadImage(appleConfig.logo_url, path.join(passDir, 'logo@3x.png'))
    );
  }

  if (appleConfig.icon_url) {
    downloads.push(
      downloadImage(appleConfig.icon_url, path.join(passDir, 'icon.png')),
      downloadImage(appleConfig.icon_url, path.join(passDir, 'icon@2x.png')),
      downloadImage(appleConfig.icon_url, path.join(passDir, 'icon@3x.png'))
    );
  }

  if (appleConfig.strip_image_url) {
    downloads.push(
      downloadImage(appleConfig.strip_image_url, path.join(passDir, 'strip.png')),
      downloadImage(appleConfig.strip_image_url, path.join(passDir, 'strip@2x.png')),
      downloadImage(appleConfig.strip_image_url, path.join(passDir, 'strip@3x.png'))
    );
  }

  await Promise.all(downloads);
  console.log('✅ Images downloaded successfully');

  // Crear pass.json base
  const passJson = {
    formatVersion: 1,
    passTypeIdentifier: "pass.com.innobizz.fidelityhub",
    serialNumber: "placeholder",
    teamIdentifier: "KSBK2MDDF6",
    organizationName: "Placeholder",
    description: "Tarjeta de Lealtad",
    logoText: "Placeholder",
    backgroundColor: hexToRgb(appleConfig.background_color || '#121212'),
    foregroundColor: hexToRgb(appleConfig.foreground_color || '#ef852e'),
    labelColor: hexToRgb(appleConfig.label_color || '#FFFFFF'),
    generic: {
      headerFields: [],
      primaryFields: [],
      secondaryFields: [],
      auxiliaryFields: [],
      backFields: []
    }
  };

  await fs.writeFile(path.join(passDir, 'pass.json'), JSON.stringify(passJson, null, 2));

  return passDir;
}

/**
 * Limpia el template temporal
 */
async function cleanupTemplate(templatePath) {
  try {
    const tempDir = path.dirname(templatePath);
    await fs.rm(tempDir, { recursive: true, force: true });
    console.log('🧹 Cleaned up temporary template');
  } catch (error) {
    console.error('Warning: Could not clean up template:', error.message);
  }
}

router.get('/wallet', async (req, res) => {
  let dynamicTemplate = null;

  try {
    const { customerId, businessId, configId } = req.query;

    if (!customerId || !businessId || !configId) {
      return res.status(400).json({
        error: 'Missing required parameters',
        required: ['customerId', 'businessId', 'configId']
      });
    }

    console.log('📱 Generating Apple Wallet pass:', { customerId, businessId, configId });

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

    console.log('✅ Customer:', customerData.full_name, '| Points:', loyaltyCard?.current_points);

    // ============================================
    // 2. OBTENER NEGOCIO
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
    // 3. OBTENER CONFIGURACIÓN
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
    console.log('✅ Config:', passkitConfig.card_display_name);

    // ============================================
    // 4. CREAR TEMPLATE DINÁMICO CON IMÁGENES DE SUPABASE
    // ============================================
    dynamicTemplate = await createDynamicTemplate(appleConfig);

    // ============================================
    // 5. CREAR PASE
    // ============================================
    const pass = await PKPass.from({
      model: dynamicTemplate,
      certificates: certificateManager.getAllCertificates()
    });

    // Configurar datos básicos
    const serialNumber = loyaltyCard?.card_number || `${businessId.slice(0, 8)}-${customerId.slice(0, 8)}`.toUpperCase();
    
    pass.type = 'generic'; // ✅ Cambiado a generic para layout tipo ORIGEN
    pass.serialNumber = serialNumber;
    pass.passTypeIdentifier = process.env.PASS_TYPE_IDENTIFIER || appleConfig.pass_type_id;
    pass.teamIdentifier = process.env.TEAM_IDENTIFIER || appleConfig.team_id;
    pass.organizationName = appleConfig.organization_name || businessData.name;
    pass.description = passkitConfig.card_display_name || formConfig.title;
    pass.logoText = passkitConfig.card_display_name || formConfig.title;

    // Colores desde Supabase
    pass.backgroundColor = hexToRgb(appleConfig.background_color);
    pass.foregroundColor = hexToRgb(appleConfig.foreground_color);
    pass.labelColor = hexToRgb(appleConfig.label_color);

    // Web service
    pass.webServiceURL = process.env.BASE_URL || '';
    pass.authenticationToken = Buffer.from(`${customerId}-${businessId}-${Date.now()}`).toString('base64');

    // ============================================
    // 6. CAMPOS - Layout estilo ORIGEN
    // ============================================
    
    // Primary fields - Nombre y Puntos (debajo del strip)
    pass.primaryFields.push({
      key: 'name',
      label: 'NOMBRE',
      value: customerData.full_name || 'Cliente',
      textAlignment: 'PKTextAlignmentLeft'
    });

    pass.primaryFields.push({
      key: 'points',
      label: 'PUNTOS',
      value: Number(loyaltyCard?.current_points ?? 0),
      textAlignment: 'PKTextAlignmentRight'
    });

    // Back fields
    pass.backFields.push({ key: 'email', label: 'Email', value: customerData.email || 'No proporcionado' });
    pass.backFields.push({ key: 'phone', label: 'Teléfono', value: customerData.phone || 'No proporcionado' });
    pass.backFields.push({
      key: 'member_since',
      label: 'Miembro desde',
      value: new Date(customerData.created_at).toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' })
    });
    pass.backFields.push({ key: 'card_number', label: 'Número de tarjeta', value: serialNumber });
    pass.backFields.push({
      key: 'business_info',
      label: 'Acerca de',
      value: `Tarjeta de fidelidad de ${businessData.name}. ${businessData.description || ''}`
    });
    pass.backFields.push({ key: 'terms', label: 'Términos', value: 'Los puntos no caducan.' });

    // QR
    pass.barcodes = [{
      format: 'PKBarcodeFormatQR',
      message: customerId,
      messageEncoding: 'iso-8859-1',
      altText: serialNumber
    }];

    console.log('🔨 Pass configured with Supabase data (generic type)');

    // ============================================
    // 7. GENERAR Y ENVIAR
    // ============================================
    const passBuffer = pass.getAsBuffer();
    console.log(`📦 Pass size: ${passBuffer.length} bytes`);

    const filename = `${businessData.name}-${customerData.full_name}.pkpass`.replace(/[^a-zA-Z0-9-]/g, '_');

    res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', passBuffer.length);

    res.send(passBuffer);

    console.log('✅ Pass sent successfully');

    // Limpiar template temporal
    await cleanupTemplate(dynamicTemplate);

  } catch (error) {
    console.error('❌ Error:', error);
    
    if (dynamicTemplate) {
      await cleanupTemplate(dynamicTemplate);
    }

    res.status(500).json({
      error: 'Failed to generate pass',
      details: error.message
    });
  }
});

export default router;