import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Inicializa certificados desde archivos locales o variables de entorno
 */
class CertificateManager {
  constructor() {
    this.certificatesPath = path.join(__dirname, '../../certificates');
    this.initialized = false;
    this.certificates = {};
  }

  /**
   * Inicializa certificados
   */
  async initialize() {
    if (this.initialized) return;

    try {
      const hasLocalCerts = await this.checkLocalCertificates();

      if (!hasLocalCerts) {
        console.log('📂 Local certificates not found, checking environment variables...');
        await this.loadCertificatesFromEnv();
      } else {
        console.log('✅ Using local certificate files');
        await this.loadLocalCertificates();
      }

      this.initialized = true;
      console.log('✅ Certificate Manager initialized successfully');
    } catch (error) {
      console.error('❌ Error initializing certificates:', error);
      throw new Error('Failed to initialize certificates. Check your setup.');
    }
  }

  /**
   * Verifica si existen certificados locales
   */
  async checkLocalCertificates() {
    const requiredFiles = ['wwdr.pem', 'signerCert.pem', 'signerKey.pem'];

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
   * Carga el contenido de certificados locales en memoria
   */
  async loadLocalCertificates() {
    const certFiles = {
      wwdr: 'wwdr.pem',
      signerCert: 'signerCert.pem',
      signerKey: 'signerKey.pem'
    };

    for (const [key, fileName] of Object.entries(certFiles)) {
      const filePath = path.join(this.certificatesPath, fileName);
      this.certificates[key] = await fs.readFile(filePath, 'utf8');
      console.log(`✅ Loaded ${fileName} into memory`);
    }
  }

  /**
   * Carga certificados desde variables de entorno (base64)
   */
  async loadCertificatesFromEnv() {
    // CORREGIDO: Usar los nombres correctos de las variables de entorno
    const certMapping = {
      'APPLE_WWDR_CERT': 'wwdr',
      'APPLE_SIGNER_CERT': 'signerCert',
      'APPLE_SIGNER_KEY': 'signerKey'
    };

    let loaded = 0;

    for (const [envVar, key] of Object.entries(certMapping)) {
      const base64Cert = process.env[envVar];

      if (base64Cert) {
        try {
          this.certificates[key] = Buffer.from(base64Cert, 'base64').toString('utf8');
          console.log(`✅ Loaded ${key} from ${envVar}`);
          loaded++;
        } catch (error) {
          console.error(`❌ Error loading ${key} from ${envVar}:`, error.message);
        }
      } else {
        console.error(`❌ Environment variable ${envVar} not found`);
      }
    }

    if (loaded < 3) {
      throw new Error(
        `Only ${loaded}/3 certificates loaded. Required: APPLE_WWDR_CERT, APPLE_SIGNER_CERT, APPLE_SIGNER_KEY`
      );
    }

    console.log(`✅ All ${loaded} certificates loaded from environment variables`);
  }

  /**
   * Obtiene el contenido de un certificado
   */
  getCertificate(certName) {
    if (!this.certificates[certName]) {
      throw new Error(`Certificate ${certName} not loaded`);
    }
    return this.certificates[certName];
  }

  /**
   * Obtiene todos los certificados en el formato que passkit-generator espera
   */
  getAllCertificates() {
    return {
      wwdr: this.certificates.wwdr,
      signerCert: this.certificates.signerCert,
      signerKey: this.certificates.signerKey
    };
  }

  /**
   * Verifica que todos los certificados requeridos están cargados
   */
  validateCertificates() {
    const required = ['wwdr', 'signerCert', 'signerKey'];
    const missing = required.filter(cert => !this.certificates[cert]);

    if (missing.length > 0) {
      throw new Error(`Missing certificates: ${missing.join(', ')}`);
    }

    console.log('✅ All required certificates are loaded');
    return true;
  }
}

export default new CertificateManager();