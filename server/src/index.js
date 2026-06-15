require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const initDatabase = require('./utils/db');
const { rateLimiters } = require('./middleware/rateLimit');
const { validateSecurityConfig } = require('./utils/securityConfig');

const app = express();
const PORT = process.env.PORT || 3000;

if (process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', true);
}

app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use('/api/auth/login', rateLimiters.authLogin);
app.use('/api/client-auth/check-in', rateLimiters.clientCheckIn);
app.use('/api/qrcodes/upload', rateLimiters.qrcodeUpload);
app.use('/api/email-pool/monitor/poll', rateLimiters.emailPoll);
app.use('/api', rateLimiters.generalApi);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

let db = null;

async function startServer() {
  try {
    validateSecurityConfig();
    db = await initDatabase();
    console.log('Database ready');
    
    const authRoutes = require('./routes/auth');
    const qrcodeRoutes = require('./routes/qrcodes');
    const userRoutes = require('./routes/users');
    const collectionRoutes = require('./routes/collection');
    const clientAuthRoutes = require('./routes/clientAuth');
    const extensionRoutes = require('./routes/extension');
    const emailPoolRoutes = require('./routes/emailPool');
    const storageRoutes = require('./routes/storage');
    const uploadRoutes = require('./routes/uploads');

    app.get('/api/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    app.use((req, res, next) => {
      req.db = db;
      next();
    });

    app.use('/uploads', uploadRoutes);
    app.use('/api/auth', authRoutes);
    app.use('/api/client-auth', clientAuthRoutes);
    app.use('/api/qrcodes', qrcodeRoutes);
    app.use('/api/users', userRoutes);
    app.use('/api/collection', collectionRoutes);
    app.use('/api/extension', extensionRoutes);
    app.use('/api/email-pool', emailPoolRoutes);
    app.use('/api/storage', storageRoutes);

    app.use((err, req, res, next) => {
      console.error('Error:', err);
      console.error('Stack:', err.stack);
      res.status(err.status || 500).json({
        error: err.message || 'Internal server error',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
      });
    });

    app.use((req, res) => {
      res.status(404).json({ error: 'Not found' });
    });

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
      console.log(`Health check: http://localhost:${PORT}/api/health`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
