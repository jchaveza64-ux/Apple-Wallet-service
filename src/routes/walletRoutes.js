import express from 'express';
import { supabase } from '../config/supabase.js';
import { PKPass } from 'passkit-generator';
import certificateManager from '../config/certificates.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Endpoint para generar y descargar el pase
router.get('/wallet', async (req, res) => {
  try {
    const { customerId, businessId, configId } = req.query;

    // Validar parámetros requeridos
    if (!customerId || !businessId || !configId) {
      return res.status(400).json({
        error: 'Missing required parameters: customerId, businessId, and configId are required'
      });
    }

    console.log('Generating wallet pass for:', { customerId, businessId, configId });

    // Obtener datos del cliente desde Supabase
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('*')
      .eq('id', customerId)
      .single();

    if (customerError || !customer) {
      console.error('Customer error:', customerError);
      return res.status(404).json({ error: 'Customer not found' });
    }

    // Obtener configuración del wallet
    const { data: config, error: configError } = await supabase
      .from('form_configurations')
      .select('*')
      .eq('id', configId)
      .eq('business_id', businessId)
      .single();

    if (configError || !config) {
      console.error('Config error:', configError);
      return res.status(404).json({ error: 'Wallet configuration not found' });
    }

    console.log('Customer:', { name: customer.name, points: customer.points });
    console.log('Config:', { businessName: config.business_name });

    // Crear el pase usando las rutas de los certificados
    const pass = await PKPass.from(
      {
        model: path.join(__dirname, '../templates/loyalty.pass'),
        certificates: {
          wwdr: certificateManager.getCertificatePath('wwdr.pem'),
          signerCert: certificateManager.getCertificatePath('signerCert.pem'),
          signerKey: certificateManager.getCertificatePath('signerKey.pem'),
        }
      },
      {
        // Datos requeridos
        serialNumber: `${businessId}-${customerId}`,
        description: config.card_description || 'Tarjeta de Fidelidad',
        organizationName: config.business_name || process.env.ORGANIZATION_NAME || 'Mi Negocio',
        passTypeIdentifier: process.env.PASS_TYPE_IDENTIFIER,
        teamIdentifier: process.env.TEAM_IDENTIFIER,

        // Colores
        backgroundColor: config.background_color || 'rgb(33, 150, 243)',
        foregroundColor: config.foreground_color || 'rgb(255, 255, 255)',
        labelColor: config.label_color || 'rgb(255, 255, 255)',
        
        // Logo text
        logoText: config.logo_text || config.business_name || 'Lealtad',

        // Configuración de tarjeta
        storeCard: {
          primaryFields: [
            {
              key: 'points',
              label: 'Puntos',
              value: customer.points || 0
            }
          ],
          secondaryFields: [
            {
              key: 'name',
              label: 'Titular',
              value: customer.name || 'Cliente'
            }
          ],
          auxiliaryFields: [
            {
              key: 'member',
              label: 'Miembro desde',
              value: new Date(customer.created_at).toLocaleDateString('es-ES')
            }
          ],
          backFields: [
            {
              key: 'email',
              label: 'Email',
              value: customer.email || ''
            },
            {
              key: 'terms',
              label: 'Términos',
              value: 'Válido para canjear recompensas.'
            }
          ]
        },

        // QR Code
        barcodes: [
          {
            format: 'PKBarcodeFormatQR',
            message: customerId,
            messageEncoding: 'iso-8859-1'
          }
        ],

        // Web service
        webServiceURL: process.env.BASE_URL,
        authenticationToken: Buffer.from(`${customerId}-${Date.now()}`).toString('base64')
      }
    );

    const passBuffer = pass.getAsBuffer();
    console.log('✅ Pass generated, size:', passBuffer.length, 'bytes');

    res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
    res.setHeader('Content-Disposition', `attachment; filename="loyalty-${customer.name || customerId}.pkpass"`);
    
    res.send(passBuffer);

  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ 
      error: 'Failed to generate wallet pass',
      details: error.message
    });
  }
});

export default router;