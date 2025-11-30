import express from 'express';
import { supabase } from '../config/supabase.js';
import passGenerator from '../services/passGenerator.js';

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

    // Generar el pase usando el método correcto
    const passData = await passGenerator.generateLoyaltyPass({
      userId: customerId,
      name: customer.name || 'Cliente',
      email: customer.email || '',
      points: customer.points || 0,
      tier: customer.tier || 'Básico',
      customData: {
        businessId: businessId,
        configId: configId,
        businessName: config.business_name
      }
    });

    // Configurar headers para descarga
    res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
    res.setHeader('Content-Disposition', `attachment; filename="loyalty-${customerId}.pkpass"`);
    
    res.send(passData.buffer);

  } catch (error) {
    console.error('Error generating wallet pass:', error);
    res.status(500).json({ 
      error: 'Failed to generate wallet pass',
      details: error.message 
    });
  }
});

export default router;