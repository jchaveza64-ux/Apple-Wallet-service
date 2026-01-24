import express from 'express';
import { supabase } from '../config/supabase.js';
import { PKPass } from 'passkit-generator';
import certificateManager from '../config/certificates.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

/**
 * Convierte HEX a RGB para Apple Wallet
 */
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return hex;
  const r = parseInt(result[1], 16);
  const g = parseInt(result[2], 16);
  const b = parseInt(result[3], 16);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Descarga una imagen desde URL y la guarda en el template
 */
async function downloadImage(url, destPath) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      const chunks = [];
      
      response.on('data', (chunk) => {
        chunks.push(chunk);
      });
      
      response.on('end', async () => {
        try {
          const buffer = Buffer.concat(chunks);
          await fs.writeFile(destPath, buffer);
          resolve(destPath);
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Procesa template de valores dinámicos
 */
function processTemplate(template, data) {
  if (!template) return '';
  
  let result = template;
  
  // Reemplazar {{customers.field}}
  result = result.replace(/\{\{customers\.(\w+)\}\}/g, (match, field) => {
    return data.customer?.[field] || '';
  });
  
  // Reemplazar {{loyalty_cards.field}}
  result = result.replace(/\{\{loyalty_cards\.(\w+)\}\}/g, (match, field) => {
    return data.loyaltyCard?.[field] || '';
  });
  
  return result;
}

/**
 * Obtiene el href correcto según el tipo de link
 */
function getLinkHref(type, url) {
  switch(type) {
    case 'phone':
      return `tel:${url.replace(/[^0-9+]/g, '')}`;
    case 'email':
      return `mailto:${url}`;
    case 'address':
      return `maps://?q=${encodeURIComponent(url)}`;
    default:
      return url.startsWith('http') ? url : `https://${url}`;
  }
}

router.get('/wallet', async (req, res) => {
  try {
    const { customerId, businessId, configId } = req.query;

    if (!customerId || !businessId || !configId) {
      return res.status(400).json({
        error: 'Missing required parameters',
        required: ['customerId', 'businessId', 'configId']
      });
    }

    console.log('📱 Generating pass:', { customerId, businessId, configId });

    // ============================================
    // 1. OBTENER DATOS DEL CLIENTE
    // ============================================
    const { data: customerData, error: customerError } = await supabase
      .from('customers')
      .select(`
        id,
        full_name,
        email,
        phone,
        business_id,
        created_at,
        loyalty_cards (
          current_points,
          current_stamps,
          card_number,
          status
        )
      `)
      .eq('id', customerId)
      .single();

    if (customerError || !customerData) {
      console.error('❌ Customer not found:', customerError);
      return res.status(404).json({ error: 'Customer not found' });
    }

    const loyaltyCard = Array.isArray(customerData.loyalty_cards) 
      ? customerData.loyalty_cards[0] 
      : customerData.loyalty_cards;

    console.log('✅ Customer:', customerData.full_name);

    // ============================================
    // 2. OBTENER DATOS DEL NEGOCIO
    // ============================================
    const { data: businessData,