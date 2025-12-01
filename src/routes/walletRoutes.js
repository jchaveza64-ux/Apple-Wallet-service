import express from 'express';
import { supabase } from '../config/supabase.js';
import { PKPass } from 'passkit-generator';
import certificateManager from '../config/certificates.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

router.get('/wallet', async (req, res) => {
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
      return res.status(404).json({ error: 'Customer not found', customerId });
    }

    const loyaltyCard = Array.isArray(customerData.loyalty_cards) 
      ? customerData.loyalty_cards[0] 
      : customerData.loyalty_cards;

    console.log('✅ Customer:', customerData.full_name);
    console.log('📊 Points:', loyaltyCard?.current_points);

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
      return res.status(404).json({ error: 'Business not found', businessId });
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
      return res.status(404).json({ error: 'Config not found', configId });
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
    // 4. CREAR EL PASE BASE
    // ============================================
    const pass = await PKPass.from(
      {
        model: path.join(__dirname, '../templates/loyalty.pass'),
        certificates: certificateManager.getAllCertificates()
      }
    );

    // ============================================
    // 5. CONFIGURAR DATOS BÁSICOS
    // ============================================
    
    const serialNumber = loyaltyCard?.card_number || `${businessId.slice(0, 8)}-${customerId.slice(0, 8)}`.toUpperCase();
    
    pass.serialNumber = serialNumber;
    pass.passTypeIdentifier = process.env.PASS_TYPE_IDENTIFIER || appleConfig.pass_type_id;
    pass.teamIdentifier = process.env.TEAM_IDENTIFIER || appleConfig.team_id;
    pass.organizationName = appleConfig.organization_name || businessData.name;
    pass.description = passkitConfig.card_display_name || formConfig.title;
    pass.logoText = passkitConfig.card_display_name || formConfig.title;

    // Colores
    pass.backgroundColor = appleConfig.background_color || 'rgb(33, 150, 243)';
    pass.foregroundColor = appleConfig.foreground_color || 'rgb(255, 255, 255)';
    pass.labelColor = appleConfig.label_color || 'rgb(255, 255, 255)';

    // Web service
    pass.webServiceURL = process.env.BASE_URL || '';
    pass.authenticationToken = Buffer.from(`${customerId}-${businessId}-${Date.now()}`).toString('base64');

    // ============================================
    // 6. ESTRUCTURA DE CAMPOS (estilo ORIGEN)
    // ============================================
    
    // Header fields - Nombre y Puntos en una fila horizontal debajo del strip
    pass.headerFields.push({
      key: 'name',
      label: 'NOMBRE',
      value: customerData.full_name || 'Cliente',
      textAlignment: 'PKTextAlignmentLeft'
    });

    pass.headerFields.push({
      key: 'points',
      label: 'PUNTOS',
      value: Number(loyaltyCard?.current_points ?? 0),
      textAlignment: 'PKTextAlignmentRight'
    });

    // Back fields - Información del reverso
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

    pass.backFields.push({
      key: 'business_info',
      label: 'Acerca de',
      value: `Tarjeta de fidelidad de ${businessData.name}. ${businessData.description || ''}`
    });

    pass.backFields.push({
      key: 'terms',
      label: 'Términos y Condiciones',
      value: 'Los puntos no caducan. Consulta el catálogo de recompensas.'
    });

    // Barcode - QR grande
    pass.barcodes = [{
      format: 'PKBarcodeFormatQR',
      message: customerId,
      messageEncoding: 'iso-8859-1',
      altText: serialNumber
    }];

    console.log('🔨 Pass configured with ORIGEN-style layout');

    // ============================================
    // 7. GENERAR Y ENVIAR
    // ============================================
    const passBuffer = pass.getAsBuffer();
    console.log(`📦 Pass size: ${passBuffer.length} bytes`);

    const filename = `${businessData.name}-${customerData.full_name}.pkpass`
      .replace(/[^a-zA-Z0-9-]/g, '_');

    res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', passBuffer.length);

    res.send(passBuffer);

    console.log('✅ Pass sent:', {
      customer: customerData.full_name,
      points: loyaltyCard?.current_points,
      business: businessData.name,
      serial: serialNumber
    });

  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({
      error: 'Failed to generate pass',
      details: error.message
    });
  }
});

export default router;