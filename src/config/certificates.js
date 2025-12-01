import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Inicializa certificados desde archivos locales o variables de entorno
 * Útil para deployment en Render donde no podemos subir archivos directamente
 */
class CertificateManager {
  constructor() {
    this.certificatesPath = path.join(__dirname, '../../certificates');
    this.initialized = false;
  }

  /**
   * Inicializa certificados
   * Prioridad: 1) Archivos locales, 2) Variables de entorno (base64)
   */
  async initialize() {
    if (this.initialized) return;

    try {
      // Verificar si existen archivos locales
      const hasLocalCerts = await this.checkLocalCertificates();
      
      if (!hasLocalCerts) {
        console.log('Local certificates not found, checking environment variables...');
        await this.loadCertificatesFromEnv();
      } else {
        console.log('✅ Using local certificate files');
      }

      this.initialized = true;
    } catch (error) {
      console.error('Error initializing certificates:', error);
      throw new Error('Failed to initialize certificates. Check your setup.');
    }
  }

  /**
   * Verifica si existen certificados locales
   */
  async checkLocalCertificates() {
    const requiredFiles = [
      'wwdr.pem',
      'signerCert.pem',
      'signerKey.pem'
    ];

    try {
      for (const file of requiredFiles) {
        await fs.access(path.join(this.certificatesPath, file));
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Carga certificados desde variables de entorno (base64)
   * Útil para Render y otros servicios cloud
   */
  async loadCertificatesFromEnv() {
    const certMapping = {
      'CERT_WWDR': 'wwdr.pem',
      'CERT_SIGNER': 'signerCert.pem',
      'CERT_SIGNER_KEY': 'signerKey.pem',
      'CERT_PUSH': 'pushCert.pem',
      'CERT_PUSH_KEY': 'pushKey.pem'
    };

    let loaded = 0;

    for (const [envVar, fileName] of Object.entries(certMapping)) {
      const base64Cert = process.env[envVar];
      
      if (base64Cert) {
        try {
          // Decodificar de base64
          const certContent = Buffer.from(base64Cert, 'base64').toString('utf8');
          
          // Guardar en el directorio de certificados
          const filePath = path.join(this.certificatesPath, fileName);
          await fs.mkdir(this.certificatesPath, { recursive: true });
          await fs.writeFile(filePath, certContent);
          
          console.log(`✅ Loaded ${fileName} from environment variable`);
          loaded++;
        } catch (error) {
          console.error(`Error loading ${fileName}:`, error.message);
        }
      }
    }

    if (loaded < 3) {
      throw new Error(
        `Only ${loaded}/5 certificates loaded. Required: wwdr.pem, signerCert.pem, signerKey.pem`
      );
    }

    console.log(`✅ ${loaded} certificates loaded from environment variables`);
  }

  /**
   * Obtiene la ruta de un certificado
   */
  getCertificatePath(certName) {
    return path.join(this.certificatesPath, certName);
  }

  /**
   * Verifica que todos los certificados requeridos existen
   */
  async validateCertificates() {
    const required = ['wwdr.pem', 'signerCert.pem', 'signerKey.pem'];
    const missing = [];

    for (const cert of required) {
      try {
        await fs.access(this.getCertificatePath(cert));
      } catch {
        missing.push(cert);
      }
    }

    if (missing.length > 0) {
      throw new Error(`Missing certificates: ${missing.join(', ')}`);
    }

    console.log('✅ All required certificates are present');
    return true;
  }
}

export default new CertificateManager();