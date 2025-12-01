import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import passRoutes from './src/routes/passRoutes.js';
import webhookRoutes from './src/routes/webhookRoutes.js';
import applePassRoutes from './src/routes/applePassRoutes.js';
import walletRoutes from './src/routes/walletRoutes.js';
import certificateManager from './src/config/certificates.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Inicializar certificados al arrancar
await certificateManager.initialize();

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'Apple Wallet Loyalty Service',
    status: 'active',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      wallet: '/wallet',
      api: '/api/passes',
      webhooks: '/api/webhook',
      appleWallet: '/v1'
    },
    documentation: 'https://github.com/jchaveza64-ux/Apple-Wallet-service'
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Apple Wallet Loyalty Service',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Routes
app.use('/', walletRoutes);
app.use('/api/passes', passRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/v1', applePassRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ Error:', err);
  
  const errorResponse = {
    error: err.message || 'Internal Server Error',
    timestamp: new Date().toISOString()
  };
  
  if (process.env.NODE_ENV !== 'production') {
    errorResponse.stack = err.stack;
  }
  
  res.status(err.status || 500).json(errorResponse);
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Route not found',
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log('=================================================');
  console.log(`🚀 Apple Wallet Service STARTED`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 URL: ${process.env.BASE_URL || `http://localhost:${PORT}`}`);
  console.log(`✅ Certificates: Initialized`);
  console.log('=================================================');
});

// Manejo de errores no capturados
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});