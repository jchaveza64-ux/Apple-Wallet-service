import express from 'express';
import { supabase } from '../config/supabase.js';
import passGenerator from '../services/passGenerator.js';
import pushNotificationService from '../services/pushNotificationService.js';

const router = express.Router();

/**
 * Web Service Endpoints requeridos por Apple Wallet
 * Documentación: https://developer.apple.com/documentation/walletpasses/adding_a_web_service_to_update_passes
 */

/**
 * POST /v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber
 * Registra un dispositivo para recibir notificaciones push
 */
router.post(
  '/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber',
  async (req, res) => {
    try {
      const { deviceLibraryIdentifier, passTypeIdentifier, serialNumber } = req.params;
      const { pushToken } = req.body;
      const authToken = req.headers.authorization?.replace('ApplePass ', '');

      if (!authToken) {
        return res.status(401).json({ error: 'Missing authorization token' });
      }

      // Verificar el auth token
      const { data: passData, error: passError } = await supabase
        .from('wallet_passes')
        .select('*')
        .eq('serial_number', serialNumber)
        .eq('auth_token', authToken)
        .single();

      if (passError || !passData) {
        return res.status(401).json({ error: 'Invalid authentication token' });
      }

      // Registrar o actualizar el dispositivo
      const { error: upsertError } = await supabase
        .from('wallet_devices')
        .upsert({
          device_library_identifier: deviceLibraryIdentifier,
          push_token: pushToken,
          pass_type_identifier: passTypeIdentifier,
          serial_number: serialNumber,
          user_id: passData.user_id,
          last_updated: new Date().toISOString()
        }, {
          onConflict: 'device_library_identifier,serial_number'
        });

      if (upsertError) {
        console.error('Error registering device:', upsertError);
        return res.status(500).json({ error: 'Failed to register device' });
      }

      res.status(201).json({ status: 'registered' });
    } catch (error) {
      console.error('Error in device registration:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * GET /v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier
 * Obtiene los serial numbers de los passes asociados a un dispositivo
 */
router.get(
  '/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier',
  async (req, res) => {
    try {
      const { deviceLibraryIdentifier, passTypeIdentifier } = req.params;
      const passesUpdatedSince = req.query.passesUpdatedSince;

      let query = supabase
        .from('wallet_devices')
        .select('serial_number, last_updated')
        .eq('device_library_identifier', deviceLibraryIdentifier)
        .eq('pass_type_identifier', passTypeIdentifier);

      if (passesUpdatedSince) {
        query = query.gt('last_updated', passesUpdatedSince);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching registrations:', error);
        return res.status(500).json({ error: 'Failed to fetch registrations' });
      }

      if (!data || data.length === 0) {
        return res.status(204).send(); // No updates
      }

      const lastUpdated = Math.max(...data.map(d => new Date(d.last_updated).getTime()));

      res.json({
        serialNumbers: data.map(d => d.serial_number),
        lastUpdated: new Date(lastUpdated).toISOString()
      });
    } catch (error) {
      console.error('Error in get registrations:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * GET /v1/passes/:passTypeIdentifier/:serialNumber
 * Obtiene la versión actualizada de un pass
 */
router.get(
  '/passes/:passTypeIdentifier/:serialNumber',
  async (req, res) => {
    try {
      const { passTypeIdentifier, serialNumber } = req.params;
      const authToken = req.headers.authorization?.replace('ApplePass ', '');
      const modifiedSince = req.headers['if-modified-since'];

      if (!authToken) {
        return res.status(401).json({ error: 'Missing authorization token' });
      }

      // Obtener información del pass
      const { data: passData, error: passError } = await supabase
        .from('wallet_passes')
        .select('*, loyalty_points(*)')
        .eq('serial_number', serialNumber)
        .eq('auth_token', authToken)
        .single();

      if (passError || !passData) {
        return res.status(401).json({ error: 'Invalid authentication token' });
      }

      // Verificar si el pass ha sido modificado
      const lastModified = new Date(passData.updated_at || passData.created_at);
      if (modifiedSince && lastModified <= new Date(modifiedSince)) {
        return res.status(304).send(); // Not modified
      }

      // Obtener datos actualizados del usuario desde Supabase
      const { data: userData, error: userError } = await supabase
        .from('loyalty_points')
        .select('*')
        .eq('user_id', passData.user_id)
        .single();

      if (userError) {
        console.error('Error fetching user data:', userError);
        return res.status(500).json({ error: 'Failed to fetch user data' });
      }

      // Generar pass actualizado
      const updatedPass = await passGenerator.generateLoyaltyPass({
        userId: passData.user_id,
        name: userData.name || passData.user_id,
        email: userData.email || '',
        points: userData.points || 0,
        tier: userData.tier || 'Básico'
      });

      // Enviar el pass actualizado
      res.set({
        'Content-Type': 'application/vnd.apple.pkpass',
        'Last-Modified': lastModified.toUTCString()
      });

      res.send(updatedPass.buffer);
    } catch (error) {
      console.error('Error in get pass:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * DELETE /v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber
 * Elimina el registro de un dispositivo
 */
router.delete(
  '/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber',
  async (req, res) => {
    try {
      const { deviceLibraryIdentifier, passTypeIdentifier, serialNumber } = req.params;
      const authToken = req.headers.authorization?.replace('ApplePass ', '');

      if (!authToken) {
        return res.status(401).json({ error: 'Missing authorization token' });
      }

      // Verificar el auth token
      const { data: passData, error: passError } = await supabase
        .from('wallet_passes')
        .select('auth_token')
        .eq('serial_number', serialNumber)
        .single();

      if (passError || !passData || passData.auth_token !== authToken) {
        return res.status(401).json({ error: 'Invalid authentication token' });
      }

      // Eliminar el registro
      const { error: deleteError } = await supabase
        .from('wallet_devices')
        .delete()
        .eq('device_library_identifier', deviceLibraryIdentifier)
        .eq('serial_number', serialNumber);

      if (deleteError) {
        console.error('Error deleting device:', deleteError);
        return res.status(500).json({ error: 'Failed to delete device registration' });
      }

      res.status(200).json({ status: 'unregistered' });
    } catch (error) {
      console.error('Error in delete registration:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * POST /v1/log
 * Endpoint para logs de errores desde dispositivos (opcional pero recomendado)
 */
router.post('/log', express.json(), (req, res) => {
  console.log('Apple Wallet Log:', req.body);
  res.status(200).send();
});

export default router;
