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
 * 
 * Query params:
 * - customerId: ID del cliente en Supabase
 * - businessId: ID del negocio
 * - configId: ID de la configuración del wallet
 */
router.get('/wallet', async (req, res) => {
  try {
    const { customerId, businessId, configId } = req.query;

    // ============================================
    // 1. VALIDACIÓN DE PARÁMETROS
    // ============================================
    if (!customerId || !businessId || !configId) {
      return res.status(400).json({
        error: 'Missing required parameters',
        required: ['customerId', 'businessId', 'configId']
      });
    }

    console.log('📱 Generating Apple Wallet pass:', { customerId, businessId, configId });

    // ============================================
    // 2. OBTENER DATOS DEL CLIENTE
    // ============================================
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('*')
      .eq('id', customerId)
      .single();

    if (customerError || !customer) {
      console.error('❌ Customer not found:', customerError);
      return res.status(404).json({ 
        error: 'Customer not found',
        customerId 
      });
    }

    console.log('✅ Customer found:', customer.name);

    // ============================================
    // 3. OBTENER CONFIGURACIÓN DEL NEGOCIO
    // ============================================
    const { data: config, error: configError } = await supabase
      .from('form_configurations')
      .select('*')
      .eq('id', configId)
      .eq('business_id', businessId)
      .single();

    if (configError || !config) {
      console.error('❌ Config not found:', configError);
      return res.status(404).json({ 
        error: 'Wallet configuration not found',
        configId 
      });
    }

    console.log('✅ Config found for business:', config.business_name);

    // ============================================
    // 4. GENERAR EL PASE CON PASSKIT-GENERATOR
    // ============================================
    
    // Generar serialNumber único
    const serialNumber = `${businessId}-${customerId}`;
    
    // Generar authenticationToken para web service
    const authenticationToken = Buffer.from(
      `${customerId}-${businessId}-${Date.now()}`
    ).toString('base64');

    console.log('🔨 Creating pass with passkit-generator...');

    const pass = await PKPass.from(
      {
        // Path al template con las imágenes
        model: path.join(__dirname, '../templates/loyalty.pass'),
        
        // Certificados para firmar el pase
        certificates: {
          wwdr: certificateManager.getCertificatePath('wwdr.pem'),
          signerCert: certificateManager.getCertificatePath('signerCert.pem'),
          signerKey: certificateManager.getCertificatePath('signerKey.pem'),
        }
      },
      {
        // ============================================
        // DATOS OBLIGATORIOS DEL PASE
        // ============================================
        
        // Identificadores únicos
        serialNumber: serialNumber,
        passTypeIdentifier: process.env.PASS_TYPE_IDENTIFIER,
        teamIdentifier: process.env.TEAM_IDENTIFIER,
        
        // Información básica
        organizationName: config.business_name || process.env.ORGANIZATION_NAME,
        description: config.card_description || 'Tarjeta de Fidelidad',
        
        // Texto del logo (aparece junto al logo)
        logoText: config.logo_text || config.business_name,

        // ============================================
        // COLORES PERSONALIZADOS
        // ============================================
        backgroundColor: config.background_color || 'rgb(33, 150, 243)',
        foregroundColor: config.foreground_color || 'rgb(255, 255, 255)',
        labelColor: config.label_color || 'rgb(255, 255, 255)',

        // ============================================
        // WEB SERVICE (para actualizaciones automáticas)
        // ============================================
        webServiceURL: process.env.BASE_URL,
        authenticationToken: authenticationToken,

        // ============================================
        // ESTRUCTURA DE LA TARJETA (storeCard)
        // ============================================
        storeCard: {
          // Campo principal - MUY VISIBLE
          primaryFields: [
            {
              key: 'points',
              label: 'PUNTOS',
              value: customer.points || 0,
              changeMessage: 'Tus puntos cambiaron a %@'
            }
          ],

          // Campos secundarios - Debajo del principal
          secondaryFields: [
            {
              key: 'name',
              label: 'Titular',
              value: customer.name || 'Cliente'
            },
            {
              key: 'member_since',
              label: 'Miembro desde',
              value: new Date(customer.created_at).toLocaleDateString('es-ES', {
                year: 'numeric',
                month: 'short'
              })
            }
          ],

          // Campos auxiliares - Más pequeños
          auxiliaryFields: [
            {
              key: 'card_number',
              label: 'Número de tarjeta',
              value: customerId.slice(0, 8).toUpperCase()
            }
          ],

          // Campos del reverso - Solo visibles al voltear
          backFields: [
            {
              key: 'email',
              label: 'Email',
              value: customer.email || ''
            },
            {
              key: 'business_info',
              label: 'Acerca de',
              value: `Tarjeta de fidelidad de ${config.business_name || 'nuestro negocio'}.`
            },
            {
              key: 'terms',
              label: 'Términos y Condiciones',
              value: 'Los puntos no caducan. Consulta el catálogo de recompensas en nuestra app.'
            },
            {
              key: 'support',
              label: 'Soporte',
              value: config.support_email || 'soporte@ejemplo.com'
            }
          ]
        },

        // ============================================
        // CÓDIGO DE BARRAS / QR
        // ============================================
        barcodes: [
          {
            format: 'PKBarcodeFormatQR',
            message: customerId,
            messageEncoding: 'iso-8859-1',
            altText: customerId.slice(0, 8).toUpperCase()
          }
        ],

        // ============================================
        // INFORMACIÓN ADICIONAL (opcional)
        // ============================================
        userInfo: {
          customerId: customerId,
          businessId: businessId,
          configId: configId
        }
      }
    );

    console.log('✅ Pass created successfully');

    // ============================================
    // 5. GENERAR EL BUFFER DEL ARCHIVO .pkpass
    // ============================================
    const passBuffer = pass.getAsBuffer();
    
    console.log(`📦 Pass size: ${passBuffer.length} bytes`);

    // ============================================
    // 6. ENVIAR EL ARCHIVO AL CLIENTE
    // ============================================
    const filename = `${config.business_name || 'Fidelidad'}-${customer.name || 'Card'}.pkpass`
      .replace(/[^a-zA-Z0-9-]/g, '_');

    res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', passBuffer.length);
    
    res.send(passBuffer);

    console.log('✅ Pass sent to client');

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