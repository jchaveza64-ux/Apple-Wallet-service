import { PKPass } from 'passkit-generator';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class PassGenerator {
  constructor() {
    this.certificatesPath = path.join(__dirname, '../../certificates');
  }

  /**
   * Genera un .pkpass para una tarjeta de lealtad
   * @param {Object} userData - Datos del usuario
   * @param {string} userData.userId - ID único del usuario
   * @param {string} userData.name - Nombre del usuario
   * @param {string} userData.email - Email del usuario
   * @param {number} userData.points - Puntos actuales
   * @param {string} userData.cardNumber - Número de tarjeta (opcional)
   * @param {string} userData.tier - Nivel de lealtad (opcional)
   */
  async generateLoyaltyPass(userData) {
    try {
      const {
        userId,
        name,
        email,
        points = 0,
        cardNumber = this.generateCardNumber(),
        tier = 'Básico',
        customData = {}
      } = userData;

      // Crear el pass
      const pass = await PKPass.from(
        {
          model: path.join(__dirname, '../templates/loyalty.pass'),
          certificates: {
            wwdr: path.join(this.certificatesPath, 'wwdr.pem'),
            signerCert: path.join(this.certificatesPath, 'signerCert.pem'),
            signerKey: path.join(this.certificatesPath, 'signerKey.pem'),
            signerKeyPassphrase: process.env.APPLE_PUSH_CERT_PASSWORD
          }
        },
        {
          // Identificadores únicos
          serialNumber: `LOYALTY-${userId}-${Date.now()}`,
          description: 'Tarjeta de Lealtad',
          organizationName: process.env.ORGANIZATION_NAME,
          passTypeIdentifier: process.env.PASS_TYPE_IDENTIFIER,
          teamIdentifier: process.env.TEAM_IDENTIFIER,

          // Web service para actualizaciones push
          webServiceURL: process.env.BASE_URL,
          authenticationToken: this.generateAuthToken(userId),

          // Color de fondo (personalizable)
          backgroundColor: 'rgb(33, 150, 243)',
          foregroundColor: 'rgb(255, 255, 255)',
          labelColor: 'rgb(255, 255, 255)',

          // Campos de la tarjeta
          storeCard: {
            // Campo principal - Puntos
            primaryFields: [
              {
                key: 'points',
                label: 'Puntos Disponibles',
                value: points.toLocaleString('es-ES')
              }
            ],

            // Campos secundarios
            secondaryFields: [
              {
                key: 'name',
                label: 'Titular',
                value: name
              },
              {
                key: 'tier',
                label: 'Nivel',
                value: tier
              }
            ],

            // Campos auxiliares
            auxiliaryFields: [
              {
                key: 'cardNumber',
                label: 'Número de Tarjeta',
                value: cardNumber
              }
            ],

            // Campo en el reverso
            backFields: [
              {
                key: 'email',
                label: 'Email',
                value: email
              },
              {
                key: 'terms',
                label: 'Términos y Condiciones',
                value: 'Visita nuestra app para más detalles sobre el programa de lealtad.'
              }
            ]
          },

          // Código de barras (puede usarse para escanear en punto de venta)
          barcodes: [
            {
              format: 'PKBarcodeFormatQR',
              message: userId,
              messageEncoding: 'iso-8859-1'
            }
          ],

          // Fecha de relevancia (opcional)
          relevantDate: new Date().toISOString(),

          // Datos personalizados para el web service
          ...(customData && { userInfo: customData })
        }
      );

      // Generar el buffer del .pkpass
      const buffer = pass.getAsBuffer();

      return {
        buffer,
        serialNumber: pass.serialNumber,
        authToken: pass.authenticationToken
      };
    } catch (error) {
      console.error('Error generating pass:', error);
      throw new Error(`Failed to generate pass: ${error.message}`);
    }
  }

  /**
   * Actualiza los puntos en un pass existente
   */
  async updatePassPoints(serialNumber, newPoints) {
    // Esta función se usa junto con las notificaciones push
    // Apple Wallet pedirá el pass actualizado al web service
    return {
      points: newPoints,
      lastModified: new Date().toISOString()
    };
  }

  /**
   * Genera un número de tarjeta único
   */
  generateCardNumber() {
    const prefix = '4532'; // Puedes personalizarlo
    const random = Math.floor(Math.random() * 1000000000000).toString().padStart(12, '0');
    return `${prefix}-${random.slice(0, 4)}-${random.slice(4, 8)}-${random.slice(8, 12)}`;
  }

  /**
   * Genera un token de autenticación para el web service
   */
  generateAuthToken(userId) {
    // En producción, usa un método más seguro (JWT, etc.)
    return Buffer.from(`${userId}-${Date.now()}-${Math.random()}`).toString('base64');
  }
}

export default new PassGenerator();
