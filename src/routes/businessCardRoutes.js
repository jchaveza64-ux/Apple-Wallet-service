import express from 'express';
import { PKPass } from 'passkit-generator';
import certificateManager from '../config/certificates.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import os from 'os';
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
  // Carpeta temporal ÚNICA por petición, con extensión .pass (convención
  // requerida por passkit-generator para reconocer la carpeta modelo).
  const templatePath = path.join(os.tmpdir(), `businesscard-${crypto.randomUUID()}.pass`);
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
    // 1. TEMPLATE FOLDER (única, nueva) + pass.json mínimo
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
    // ============================================
    pushIfValue(pass.secondaryFields, { key: 'name',  label: 'NOMBRE', value: fullName });
    pushIfValue(pass.secondaryFields, { key: 'title', label: 'CARGO',  value: jobTitle });

    pass.backFields.push({
      key: 'cardUrl',
      label: '🔗 Ver tarjeta completa',
      value: cardUrl,
      attributedValue: `<a href="${cardUrl}">${cardUrl}</a>`
    });

    pushIfValue(pass.backFields, { key: 'phone', label: 'Teléfono', value: phone });
    pushIfValue(pass.backFields, { key: 'email', label: 'Email',    value: email });

    // ============================================
    // 6. BARCODE (QR con cardUrl)
    // ============================================
    const barcodeConfig = {
      message: cardUrl,
      format: 'PKBarcodeFormatQR',
      messageEncoding: 'iso-8859-1'
    };

    if (walletQrText && walletQrText.trim() !== '') {
