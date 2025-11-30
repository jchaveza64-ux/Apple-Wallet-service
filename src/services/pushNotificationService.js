import https from 'https';
import crypto from 'crypto';
import { supabase } from '../config/supabase.js';

class PushNotificationService {
  constructor() {
    this.apnsGateway = process.env.NODE_ENV === 'production'
      ? 'api.push.apple.com'
      : 'api.sandbox.push.apple.com';

    // Configuración para autenticación basada en token
    this.apnsKeyId = process.env.APPLE_APNS_KEY_ID;
    this.teamId = process.env.TEAM_IDENTIFIER;
    this.apnsKey = process.env.APPLE_APNS_KEY;
  }

  /**
   * Genera JWT para autenticación con APNs
   * Método basado en tokens (moderno, no expira, más fácil)
   */
  generateAPNsToken() {
    if (!this.apnsKeyId || !this.teamId || !this.apnsKey) {
      throw new Error('Missing APNs token configuration. Check APPLE_APNS_KEY_ID, TEAM_IDENTIFIER, and APPLE_APNS_KEY');
    }

    const header = {
      alg: 'ES256',
      kid: this.apnsKeyId
    };

    const payload = {
      iss: this.teamId,
      iat: Math.floor(Date.now() / 1000)
    };

    // Codificar header y payload en base64
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');

    // Crear signature
    const token = `${encodedHeader}.${encodedPayload}`;

    // El APNS key debe estar en formato PEM
    // Si viene como string, asegurarse que tiene los headers correctos
    let privateKey = this.apnsKey;
    if (!privateKey.includes('BEGIN PRIVATE KEY')) {
      privateKey = `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`;
    }

    const sign = crypto.createSign('SHA256');
    sign.update(token);
    sign.end();

    const signature = sign.sign(privateKey, 'base64url');

    return `${token}.${signature}`;
  }

  /**
   * Envía notificación push a todos los dispositivos registrados para un pass
   * @param {string} serialNumber - Número de serie del pass
   */
  async notifyPassUpdate(serialNumber) {
    try {
      // Obtener todos los dispositivos registrados para este pass
      const { data: devices, error } = await supabase
        .from('wallet_devices')
        .select('push_token, device_library_identifier')
        .eq('serial_number', serialNumber);

      if (error || !devices || devices.length === 0) {
        console.log('No devices registered for pass:', serialNumber);
        return { success: false, message: 'No devices registered' };
      }

      console.log(`Sending push notifications to ${devices.length} devices`);

      // Enviar notificación a cada dispositivo
      const results = await Promise.allSettled(
        devices.map(device => this.sendPushNotification(device.push_token))
      );

      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      console.log(`Push notifications sent: ${successful} successful, ${failed} failed`);

      return {
        success: true,
        sent: successful,
        failed: failed
      };
    } catch (error) {
      console.error('Error sending push notifications:', error);
      throw error;
    }
  }

  /**
   * Envía notificación push a un dispositivo específico usando autenticación basada en token
   * @param {string} pushToken - Token del dispositivo
   */
  async sendPushNotification(pushToken) {
    return new Promise((resolve, reject) => {
      try {
        // Generar JWT token para autenticación
        const authToken = this.generateAPNsToken();

        // El payload para Apple Wallet es vacío (solo notificación de actualización)
        const payload = JSON.stringify({});

        const options = {
          hostname: this.apnsGateway,
          port: 443,
          path: `/3/device/${pushToken}`,
          method: 'POST',
          headers: {
            'authorization': `bearer ${authToken}`,
            'apns-topic': process.env.PASS_TYPE_IDENTIFIER,
            'apns-push-type': 'background',
            'apns-priority': '5',
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          }
        };

        const req = https.request(options, (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            if (res.statusCode === 200) {
              console.log('Push notification sent successfully');
              resolve({ success: true, statusCode: res.statusCode });
            } else {
              console.error('Push notification failed:', res.statusCode, data);
              reject(new Error(`Push failed with status ${res.statusCode}: ${data}`));
            }
          });
        });

        req.on('error', (error) => {
          console.error('Error sending push notification:', error);
          reject(error);
        });

        req.write(payload);
        req.end();
      } catch (error) {
        console.error('Error in sendPushNotification:', error);
        reject(error);
      }
    });
  }

  /**
   * Notifica actualización de puntos a un usuario específico
   * @param {string} userId - ID del usuario
   */
  async notifyUserPointsUpdate(userId) {
    try {
      // Obtener el serial number del pass del usuario
      const { data: passData, error } = await supabase
        .from('wallet_passes')
        .select('serial_number')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error || !passData) {
        console.log('No pass found for user:', userId);
        return { success: false, message: 'No pass found' };
      }

      // Actualizar timestamp del pass
      await supabase
        .from('wallet_passes')
        .update({ updated_at: new Date().toISOString() })
        .eq('serial_number', passData.serial_number);

      // Enviar notificación push
      return await this.notifyPassUpdate(passData.serial_number);
    } catch (error) {
      console.error('Error notifying user points update:', error);
      throw error;
    }
  }
}

export default new PushNotificationService();
