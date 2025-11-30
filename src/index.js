import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import passRoutes from './routes/passRoutes.js';
import webhookRoutes from './routes/webhookRoutes.js';
import applePassRoutes from './routes/applePassRoutes.js';
import certificateManager from './config/certificates.js';

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

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Apple Wallet Loyalty Service',
    timestamp: new Date().toISOString()
  });
});

// Routes
app.use('/api/passes', passRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/v1', applePassRoutes); // Apple Wallet web service endpoints

// Error handling
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.listen(PORT, () => {
  console.log(`🚀 Apple Wallet Service running on port ${PORT}`);
  console.log(`📱 Environment: ${process.env.NODE_ENV || 'development'}`);
});
