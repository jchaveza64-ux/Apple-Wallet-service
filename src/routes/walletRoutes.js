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
    // 1. OBTENER DATOS DEL CLIENTE CON PUNTOS
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
      return res.status(404).json({
        error: 'Customer not found',
        customerId
      });
    }

    console.log('✅ Customer found:', customerData.full_name);

    const loyaltyCard = Array.isArray(customerData.loyalty_cards) 
      ? customerData.loyalty_cards[0] 
      : customerData.loyalty_cards;

    console.log('📊 Loyalty card data:', loyaltyCard);

    // ============================================
    // 2. OBTENER DATOS DEL NEGOCIO
    // ============================================
    const { data: businessData, error: businessError } = await supabase
      .from('businesses')
      .select('id, name, description, logo_url')
      .eq('id', businessId)
      .single();

    if (businessError || !businessData) {
      console.error('❌ Business not found:', businessError);
      return res.status(404).json({
        error: 'Business not found',
        businessId
      });
    }

    console.log('✅ Business found:', businessData.name);

    // ============================================
    // 3. OBTENER CONFIGURACIÓN DEL FORMULARIO
    // ============================================
    const { data: formConfig, error: formError } = await supabase
      .from('form_configurations')
      .select('*')
      .eq('id', configId)
      .eq('business_id', businessId)
      .single();

    if (formError || !formConfig) {
      console.error('❌ Form config not found:', formError);
      return res.status(404).json({
        error: 'Form configuration not found',
        configId
      });
    }

    console.log('✅ Form config found:', formConfig.title);

    // ============================================
    // 4. OBTENER CONFIGURACIÓN DE PASSKIT
    // ============================================
    const { data: passkitConfig, error: passkitError } = await supabase
      .from('passkit_configs')
      .select('*')
      .eq('id', formConfig.passkit_config_id)
      .single();

    if (passkitError || !passkitConfig) {
      console.error('❌ PassKit config not found:', passkitError);
      return res.status(404).json({
        error: 'PassKit configuration not found',
        passkitConfigId: formConfig.passkit_config_id
      });
    }

    console.log('✅ PassKit config found:', passkitConfig.card_display_name);

    const appleConfig = passkitConfig.apple_config || {};

    // ============================================
    // 5. PREPARAR DATOS DEL PASE
    // ============================================
    const points = Number(loyaltyCard?.current_points ?? 0);
    const serialNumber = String(loyaltyCard?.card_number || `${businessId.slice(0, 8)}-${customerId.slice(0, 8)}`.toUpperCase());
    const customerName = String(customerData.full_name || 'Cliente');
    const customerEmail = String(customerData.email || 'No proporcionado');
    const customerPhone = String(customerData.phone || 'No proporcionado');
    
    const memberSince = new Date(customerData.created_at).toLocaleDateString('es-ES', {
      year: 'numeric',
      month: 'short'
    });

    const authenticationToken = Buffer.from(
      `${customerId}-${businessId}-${Date.now()}`
    ).toString('base64');

    console.log('🔨 Creating pass with data:', {
      points,
      customerName,
      serialNumber,
      memberSince
    });

    // ============================================
    // 6. GENERAR EL PASE
    // ============================================
    const pass = await PKPass.from(
      {
        model: path.join(__dirname, '../templates/loyalty.pass'),
        certificates: certificateManager.getAllCertificates()
      },
      {
        serialNumber: serialNumber,
        passTypeIdentifier: process.env.PASS_TYPE_IDENTIFIER || appleConfig.pass_type_id,
        teamIdentifier: process.env.TEAM_IDENTIFIER || appleConfig.team_id,
        organizationName: String(appleConfig.organization_name || businessData.name || 'Fidelity Hub'),
        description: String(passkitConfig.card_display_name || formConfig.title || 'Tarjeta de Fidelidad'),
        logoText: String(passkitConfig.card_display_name || formConfig.title),
        backgroundColor: String(appleConfig.background_color || 'rgb(33, 150, 243)'),
        foregroundColor: String(appleConfig.foreground_color || 'rgb(255, 255, 255)'),
        labelColor: String(appleConfig.label_color || 'rgb(255, 255, 255)'),
        webServiceURL: String(process.env.BASE_URL || ''),
        authenticationToken: authenticationToken,
        
        storeCard: {
          primaryFields: [
            {
              key: 'points',
              label: 'PUNTOS',
              value: points,
              textAlignment: 'PKTextAlignmentCenter'
            }
          ],

          secondaryFields: [
            {
              key: 'name',
              label: 'Titular',
              value: customerName,
              textAlignment: 'PKTextAlignmentLeft'
            },
            {
              key: 'member_since',
              label: 'Miembro desde',
              value: memberSince,
              textAlignment: 'PKTextAlignmentRight'
            }
          ],

          auxiliaryFields: [
            {
              key: 'card_number',
              label: 'Tarjeta',
              value: serialNumber,
              textAlignment: 'PKTextAlignmentCenter'
            }
          ],

          backFields: [
            {
              key: 'email',
              label: 'Email',
              value: customerEmail
            },
            {
              key: 'phone',
              label: 'Teléfono',
              value: customerPhone
            },
            {
              key: 'business_info',
              label: 'Acerca de',
              value: `Tarjeta de fidelidad de ${businessData.name}. ${businessData.description || ''}`
            },
            {
              key: 'terms',
              label: 'Términos y Condiciones',
              value: 'Los puntos no caducan. Consulta el catálogo de recompensas.'
            }
          ]
        },

        barcodes: [
          {
            format: 'PKBarcodeFormatQR',
            message: customerId,
            messageEncoding: 'iso-8859-1',
            altText: serialNumber
          }
        ]
      }
    );

    console.log('✅ Pass created successfully');

    const passBuffer = pass.getAsBuffer();
    console.log(`📦 Pass size: ${passBuffer.length} bytes`);

    const filename = `${businessData.name || 'Fidelidad'}-${customerName}.pkpass`
      .replace(/[^a-zA-Z0-9-]/g, '_');

    res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', passBuffer.length);

    res.send(passBuffer);

    console.log('✅ Pass sent successfully');

  } catch (error) {
    console.error('❌ Error generating wallet pass:', error);
    res.status(500).json({
      error: 'Failed to generate wallet pass',
      details: error.message
    });
  }
});

export default router;