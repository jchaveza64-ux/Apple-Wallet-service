import express from 'express';
import cors from 'cors';
import walletRoutes from './src/routes/walletRoutes.js';
import appleWebServiceRoutes from './src/routes/appleWebService.js';
import giftCardRoutes from './src/routes/giftCardRoutes.js';
import certificateManager from './src/config/certificates.js';
const app = express();
const PORT = process.env.PORT || 3000;
// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Routes
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Apple Wallet Service is running',
    endpoints: {
      generatePass: '/wallet',
      generateGiftCard: '/gift-card/wallet',
      registerDevice: '/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber',
      getUpdatablePasses: '/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier',
      getUpdatedPass: '/v1/passes/:passTypeIdentifier/:serialNumber',
      unregisterDevice: '/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber',
      notifyUpdate: '/notify-update'
    }
  });
});
app.use(walletRoutes);
app.use(appleWebServiceRoutes);
app.use(giftCardRoutes);
// Error handling
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});
// Start server with async initialization
async function startServer() {
  try {
    // CRÍTICO: Inicializar certificados ANTES de iniciar servidor
    console.log('🔐 Initializing certificates...');
    await certificateManager.initialize();
    certificateManager.validateCertificates();
    console.log('✅ Certificates loaded successfully');
    // Iniciar servidor
    app.listen(PORT, () => {
      console.log('=================================================');
      console.log('🚀 Apple Wallet Service STARTED');
      console.log(`📡 Port: ${PORT}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🔗 URL: ${process.env.BASE_URL || 'http://localhost:' + PORT}`);
      console.log('✅ Ready to generate passes');
      console.log('🎁 Gift Card endpoint: /gift-card/wallet');
      console.log('=================================================');
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}
// Iniciar
startServer();
