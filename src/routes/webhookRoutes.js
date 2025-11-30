import express from 'express';
import { body, validationResult } from 'express-validator';
import pushNotificationService from '../services/pushNotificationService.js';
import { supabase } from '../config/supabase.js';

const router = express.Router();

/**
 * POST /api/webhook/points-updated
 * Webhook para cuando se actualizan los puntos de un usuario
 * Puedes llamar esto desde Lovable cuando cambien los puntos
 */
router.post(
  '/points-updated',
  [
    body('userId').notEmpty().withMessage('userId is required'),
    body('points').isNumeric().withMessage('points must be a number')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { userId, points, tier } = req.body;

      console.log(`Points updated for user ${userId}: ${points} points`);

      // Actualizar puntos en la tabla de Supabase
      const { error: updateError } = await supabase
        .from('loyalty_points')
        .upsert({
          user_id: userId,
          points: points,
          tier: tier || 'Básico',
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id'
        });

      if (updateError) {
        console.error('Error updating points:', updateError);
        return res.status(500).json({ error: 'Failed to update points' });
      }

      // Enviar notificación push para actualizar el wallet
      const notificationResult = await pushNotificationService.notifyUserPointsUpdate(userId);

      res.json({
        success: true,
        message: 'Points updated and notification sent',
        notification: notificationResult
      });
    } catch (error) {
      console.error('Error in points-updated webhook:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * POST /api/webhook/supabase
 * Webhook genérico para recibir eventos de Supabase
 * Configurar en Supabase: Database Webhooks
 */
router.post('/supabase', async (req, res) => {
  try {
    const { type, table, record, old_record } = req.body;

    console.log('Supabase webhook received:', { type, table });

    // Manejar diferentes tipos de eventos
    if (table === 'loyalty_points' && (type === 'INSERT' || type === 'UPDATE')) {
      const userId = record.user_id;
      const newPoints = record.points;

      // Enviar notificación push
      await pushNotificationService.notifyUserPointsUpdate(userId);

      return res.json({
        success: true,
        message: 'Wallet notification triggered'
      });
    }

    res.json({ success: true, message: 'Event received' });
  } catch (error) {
    console.error('Error in supabase webhook:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/webhook/test
 * Endpoint de prueba para verificar que las notificaciones push funcionan
 */
router.post('/test', async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const result = await pushNotificationService.notifyUserPointsUpdate(userId);

    res.json({
      success: true,
      message: 'Test notification sent',
      result
    });
  } catch (error) {
    console.error('Error in test webhook:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
