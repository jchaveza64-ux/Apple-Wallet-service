import express from 'express';
import { supabase } from '../config/supabase.js';
import { PKPass } from 'passkit-generator';
import certificateManager from '../config/certificates.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

/**
 * Endpoint: GET /wallet
 * Genera y descarga un pase de Apple Wallet
 */
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
    // 1. OBTENER DATOS COMPLETOS DEL CLIENTE CON PUNTOS
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
    console.log('📊 Customer points:', customerData.loyalty_cards?.[0]?.current_points || 0);

    // ============================================
    // 2. OBTENER CONFIGURACIÓN COMPLETA
    // ============================================
    const { data: configData, error: configError } = await supabase
      .from('form_configurations')
      .select(`
        id,
        title,
        business_id,
        businesses (
          name,
          description
        ),
        passkit_configs (
          card_display_name,
          apple_config,
          member_fields,
          barcode_config,
          custom_fields
        )
      `)
      .eq('id', configId)
      .eq('business_id', businessId)
      .single();

    if (configError || !configData) {
      console.error('❌ Config not found:', configError);
      return res.status(404).json({
        error: 'Wallet configuration not found',
        configId
      });
    }

    console.log('✅ Config found for business:', configData.businesses?.name);

    // Extraer datos
    const business = configData.businesses;
    const passkitConfig = configData.passkit_configs;
    const appleConfig = passkitConfig?.apple_config || {};
    const loyaltyCard = customerData.loyalty_cards?.[0] || {};

    // ============================================
    // 3. GENERAR EL PASE CON PASSKIT-GENERATOR
    // ============================================

    const serialNumber = loyaltyCard.card_number || `${businessId}-${customerId}`;
    const authenticationToken = Buffer.from(
      `${customerId}-${businessId}-${Date.now()}`
    ).toString('base64');

    console.log('🔨 Creating pass with passkit-generator...');

    const pass = await PKPass.from(
      {
        model: path.join(__dirname, '../templates/loyalty.pass'),
        certificates: certificateManager.getAllCertificates()
      },
      {
        // ============================================
        // DATOS OBLIGATORIOS
        // ============================================
        serialNumber: serialNumber,
        passTypeIdentifier: process.env.PASS_TYPE_IDENTIFIER || appleConfig.pass_type_id,
        teamIdentifier: process.env.TEAM_IDENTIFIER || appleConfig.team_id,

        organizationName: appleConfig.organization_name || business?.name || 'Fidelity Hub',
        description: passkitConfig?.card_display_name || configData.title || 'Tarjeta de Fidelidad',
        logoText: passkitConfig?.card_display_name || configData.title,

        // ============================================
        // COLORES DESDE apple_config
        // ============================================
        backgroundColor: appleConfig.background_color || 'rgb(33, 150, 243)',
        foregroundColor: appleConfig.foreground_color || 'rgb(255, 255, 255)',
        labelColor: appleConfig.label_color || 'rgb(255, 255, 255)',

        // ============================================
        // WEB SERVICE
        // ============================================
        webServiceURL: process.env.BASE_URL,
        authenticationToken: authenticationToken,

        // ============================================
        // ESTRUCTURA DE LA TARJETA
        // ============================================
        storeCard: {
          primaryFields: [
            {
              key: 'points',
              label: 'PUNTOS',
              value: loyaltyCard.current_points || 0,
              changeMessage: 'Tus puntos cambiaron a %@'
            }
          ],

          secondaryFields: [
            {
              key: 'name',
              label: 'Titular',
              value: customerData.full_name || 'Cliente'
            },
            {
              key: 'member_since',
              label: 'Miembro desde',
              value: new Date(customerData.created_at).toLocaleDateString('es-ES', {
                year: 'numeric',
                month: 'short'
              })
            }
          ],

          auxiliaryFields: [
            {
              key: 'card_number',
              label: 'Número de tarjeta',
              value: serialNumber.slice(0, 16).toUpperCase()
            }
          ],

          backFields: [
            {
              key: 'email',
              label: 'Email',
              value: customerData.email || ''
            },
            {
              key: 'phone',
              label: 'Teléfono',
              value: customerData.phone || 'No proporcionado'
            },
            {
              key: 'business_info',
              label: 'Acerca de',
              value: `Tarjeta de fidelidad de ${business?.name || 'nuestro negocio'}. ${business?.description || ''}`
            },
            {
              key: 'terms',
              label: 'Términos y Condiciones',
              value: 'Los puntos no caducan. Consulta el catálogo de recompensas en nuestra app.'
            }
          ]
        },

        // ============================================
        // CÓDIGO QR
        // ============================================
        barcodes: [
          {
            format: 'PKBarcodeFormatQR',
            message: customerId,
            messageEncoding: 'iso-8859-1',
            altText: serialNumber.slice(0, 8).toUpperCase()
          }
        ],

        // ============================================
        // INFORMACIÓN ADICIONAL
        // ============================================
        userInfo: {
          customerId: customerId,
          businessId: businessId,
          configId: configId,
          cardNumber: serialNumber
        }
      }
    );

    console.log('✅ Pass created successfully');

    // ============================================
    // 4. GENERAR Y ENVIAR EL ARCHIVO
    // ============================================
    const passBuffer = pass.getAsBuffer();
    console.log(`📦 Pass size: ${passBuffer.length} bytes`);

    const filename = `${business?.name || 'Fidelidad'}-${customerData.full_name || 'Card'}.pkpass`
      .replace(/[^a-zA-Z0-9-]/g, '_');

    res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', passBuffer.length);

    res.send(passBuffer);

    console.log('✅ Pass sent to client');
    console.log('📋 Pass details:', {
      customer: customerData.full_name,
      points: loyaltyCard.current_points,
      business: business?.name,
      cardNumber: serialNumber
    });

  } catch (error) {
    console.error('❌ Error generating wallet pass:', error);

    if (error.message) console.error('Error message:', error.message);
    if (error.stack && process.env.NODE_ENV !== 'production') {
      console.error('Stack trace:', error.stack);
    }

    res.status(500).json({
      error: 'Failed to generate wallet pass',
      details: error.message,
      ...(process.env.NODE_ENV !== 'production' && { stack: error.stack })
    });
  }
});

export default router;