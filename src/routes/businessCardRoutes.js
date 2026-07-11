import express from 'express';
import { PKPass } from 'passkit-generator';
import certificateManager from '../config/certificates.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import https from 'https';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// ============================================
// HELPERS
// ============================================

/** Convierte hex (#RRGGBB) a formato RGB que Apple Wallet requiere */
function hexToRgb(hex, fallback = 'rgb(255, 255, 255)') {
  if (!hex || typeof hex !== 'string') return fallback;
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return fallback;
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return fallback;
  return `rgb(${r}, ${g}, ${b})`;
}

/** Descarga imagen (soporta redirects) */
async function downloadImage(url, destPath) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        return downloadImage(response.headers.location, destPath).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) {
        return reject(new Error(`HTTP ${response.statusCode} downloading ${url}`));
      }
      const chunks = [];
      response.on('data', (c) => chunks.push(c));
      response.on('end', async () => {
        try {
          await fs.writeFile(destPath, Buffer.concat(chunks));
          resolve(destPath);
        } catch (err) { reject(err); }
      });
    }).on('error', reject);
  });
}

/** PNG 1x1 transparente (fallback cuando no hay logoUrl o la descarga falla) */
const TRANSPARENT_PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

async function writeFallbackImage(destPath) {
  await fs.writeFile(destPath, TRANSPARENT_PNG_1X1);
}

// Sólo añade el field si el valor no está vacío
function pushIfValue(arr, field) {
  if (field.value && String(field.value).trim() !== '') arr.push(field);
}

// ============================================
// POST /business-card/generate
// ============================================
router.post('/business-card/generate', async (req, res) => {
  const templatePath = path.join(__dirname, '../templates/businesscard.pass');
  const imageFiles = [
    'logo.png', 'logo@2x.png', 'logo@3x.png',
    'icon.png', 'icon@2x.png', 'icon@3x.png',
  ];
  const stripFiles = [
    'strip.png', 'strip@2x.png', 'strip@3x.png',
  ];

  try {
    const {
      fullName,
      jobTitle = '',
      company = '',
      phone = '',
      email = '',
      cardUrl,
      logoUrl = '',
      walletBgColor = '#1a1a1a',
      walletTextColor = '#ffffff',
      walletLabelColor = '#c8c8c8',
      walletHeroImage = '',
      walletQrText = ''
    } = req.body || {};

    if (!fullName || !cardUrl) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['fullName', 'cardUrl']
      });
    }

    console.log('💼 Generating Business Card pass for:', fullName);

    // ============================================
    // 1. TEMPLATE FOLDER + pass.json mínimo
    // ============================================
    await fs.mkdir(templatePath, { recursive: true });
    const passJsonContent = {
      formatVersion: 1,
      passTypeIdentifier: '',
      serialNumber: '',
      teamIdentifier: '',
      organizationName: '',
      description: 'Business Card',
      generic: {}
    };
    await fs.writeFile(
      path.join(templatePath, 'pass.json'),
      JSON.stringify(passJsonContent)
    );

    // Limpiar imágenes viejas
    for (const f of [...imageFiles, ...stripFiles]) {
      await fs.unlink(path.join(templatePath, f)).catch(() => {});
    }

    // ============================================
    // 2. IMÁGENES (logo + icon) con fallback
    // ============================================
    let usedFallback = false;
    const writeAllVariants = async (files, source) => {
      for (const name of files) {
        await source(path.join(templatePath, name));
      }
    };

    if (logoUrl) {
      try {
        await writeAllVariants(imageFiles, async (dest) => { await downloadImage(logoUrl, dest); });
        console.log('✅ Logo/Icon downloaded from logoUrl');
      } catch (imgErr) {
        console.warn('⚠️ logoUrl download failed, using transparent fallback:', imgErr.message);
        usedFallback = true;
        await writeAllVariants(imageFiles, writeFallbackImage);
      }
    } else {
      console.log('ℹ️ No logoUrl provided, using transparent fallback');
      usedFallback = true;
      await writeAllVariants(imageFiles, writeFallbackImage);
    }

    // ============================================
    // 2b. HERO/STRIP IMAGE (si viene walletHeroImage)
    // ============================================
    let hasStrip = false;
    if (walletHeroImage) {
      try {
        await writeAllVariants(stripFiles, async (dest) => { await downloadImage(walletHeroImage, dest); });
        hasStrip = true;
        console.log('✅ Hero/Strip image downloaded');
      } catch (stripErr) {
        console.warn('⚠️ walletHeroImage download failed, skipping strip:', stripErr.message);
      }
    }

    // ============================================
    // 3. CERTIFICADOS
    // ============================================
    await certificateManager.initialize();

    // ============================================
    // 4. CREAR PASE - STORECARD
    // ============================================
    const serialNumber = `BC-${crypto.randomUUID().slice(0, 8)}-${Date.now()}`.toUpperCase();

    const pass = await PKPass.from(
      {
        model: templatePath,
        certificates: certificateManager.getAllCertificates()
      },
      {
        serialNumber,
        passTypeIdentifier: process.env.PASS_TYPE_IDENTIFIER || 'pass.com.innobizz.fidelityhub',
        teamIdentifier: process.env.TEAM_IDENTIFIER,
        organizationName: company || 'Innobizz Cards',
        description: `Tarjeta de presentación de ${fullName}`,
        logoText: company || 'Innobizz Cards',
        backgroundColor: hexToRgb(walletBgColor, 'rgb(26, 26, 26)'),
        foregroundColor: hexToRgb(walletTextColor, 'rgb(255, 255, 255)'),
        labelColor: hexToRgb(walletLabelColor, 'rgb(200, 200, 200)'),
        webServiceURL: process.env.BASE_URL || 'https://apple-wallet-service-wbtw.onrender.com',
        authenticationToken: serialNumber,
        sharingProhibited: false
      }
    );

    pass.type = 'storeCard';

    // ============================================
    // 5. CAMPOS
    // FRENTE: solo NOMBRE, CARGO, EMPRESA (menos campos = letras más grandes,
    // Apple reparte el ancho entre menos elementos por fila).
    // TELÉFONO y EMAIL se movieron al reverso (backFields), junto con el 
    // link a la tarjeta digital completa.
    // ============================================
    pushIfValue(pass.secondaryFields, { key: 'name',    label: 'NOMBRE',  value: fullName });
    pushIfValue(pass.secondaryFields, { key: 'title',   label: 'CARGO',   value: jobTitle });
    pushIfValue(pass.auxiliaryFields, { key: 'company', label: 'EMPRESA', value: company });

    // ============================================
    // REVERSO (backFields): teléfono, email y link a la tarjeta completa
    // ============================================
    pushIfValue(pass.backFields, { key: 'phone', label: 'Teléfono', value: phone });
    pushIfValue(pass.backFields, { key: 'email', label: 'Email',    value: email });

    pass.backFields.push({
      key: 'cardUrl',
      label: 'Tarjeta digital completa',
      value: cardUrl,
      attributedValue: `<a href="${cardUrl}">${cardUrl}</a>`
    });

    // ============================================
    // 6. BARCODE (QR con cardUrl)
    // ============================================
    const barcodeConfig = {
      message: cardUrl,
      format: 'PKBarcodeFormatQR',
      messageEncoding: 'iso-8859-1'
    };

    if (walletQrText && walletQrText.trim() !== '') {
      barcodeConfig.altText = walletQrText.trim();
    }

    pass.setBarcodes(barcodeConfig);

    // ============================================
    // 7. RESPUESTA
    // ============================================
    const passBuffer = pass.getAsBuffer();
    console.log(`📦 Business Card pass size: ${passBuffer.length} bytes (fallback icon: ${usedFallback}, strip: ${hasStrip})`);

    const safeName = fullName.replace(/[^a-zA-Z0-9\-_.]/g, '_');
    const filename = `BusinessCard-${safeName}.pkpass`;

    res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', passBuffer.length);
    res.send(passBuffer);

    console.log('✅ Business Card pass sent:', serialNumber);
  } catch (error) {
    console.error('❌ Business Card Error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Failed to generate business card pass',
        details: error.message
      });
    }
  } finally {
    // Cleanup imágenes temporales
    for (const f of [...imageFiles, ...stripFiles]) {
      await fs.unlink(path.join(templatePath, f)).catch(() => {});
    }
  }
});

export default router;
