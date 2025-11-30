import express from 'express';
import { body, validationResult } from 'express-validator';
import passGenerator from '../services/passGenerator.js';
import { supabase } from '../config/supabase.js';

const router = express.Router();

/**
 * POST /api/passes/generate
 * Genera un nuevo pase de Apple Wallet para un usuario
 */
router.post(
  '/generate',
  [
    body('userId').notEmpty().withMessage('userId is required'),
    body('name').notEmpty().withMessage('name is required'),
    body('email').isEmail().withMessage('valid email is required')
  ],
  async (req, res) => {
    try {
      // Validar entrada
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { userId, name, email, points, cardNumber, tier } = req.body;

      // Obtener datos del usuario desde Supabase (opcional)
      let userData = { userId, name, email, points, cardNumber, tier };

      if (!points && userId) {
        // Intentar obtener puntos desde Supabase
        const { data, error } = await supabase
          .from('loyalty_points') // Ajusta el nombre de tu tabla
          .select('points, tier')
          .eq('user_id', userId)
          .single();

        if (!error && data) {
          userData.points = data.points;
          userData.tier = data.tier;
        }
      }

      // Generar el pass
      const passData = await passGenerator.generateLoyaltyPass(userData);

      // Guardar registro del pass en Supabase
      await supabase.from('wallet_passes').insert({
        user_id: userId,
        serial_number: passData.serialNumber,
        auth_token: passData.authToken,
        created_at: new Date().toISOString()
      });

      // Enviar el .pkpass
      res.set({
        'Content-Type': 'application/vnd.apple.pkpass',
        'Content-Disposition': `attachment; filename="loyalty-${userId}.pkpass"`
      });

      res.send(passData.buffer);
    } catch (error) {
      console.error('Error in /generate:', error);
      res.status(500).json({
        error: 'Failed to generate pass',
        message: error.message
      });
    }
  }
);

/**
 * GET /api/passes/:userId
 * Obtiene información del pase de un usuario
 */
router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const { data, error } = await supabase
      .from('wallet_passes')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Pass not found' });
    }

    res.json(data);
  } catch (error) {
    console.error('Error in GET /:userId:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
