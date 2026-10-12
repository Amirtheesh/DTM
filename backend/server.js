/**
 * Automated Sanitizing System - IoT Backend Server
 * Node.js & Express API Gateway for Arduino Uno + ESP32
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const sensorRoutes = require('./routes/sensorRoutes');

const app = express();
const PORT = process.env.PORT || 5000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

// Middleware
app.use(cors({
  origin: CORS_ORIGIN === '*' ? '*' : CORS_ORIGIN,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-API-Key', 'Authorization']
}));

app.use(express.json({ limit: '1mb' }));

// Serve frontend static files
const frontendPath = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendPath));

// API Routes
app.use('/api', sensorRoutes);

// Root route fallback to frontend index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// 404 Handler for undefined API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    error: `API route not found: ${req.method} ${req.originalUrl}`
  });
});

// Central error handler
app.use((err, req, res, next) => {
  console.error('[SERVER ERROR]', err);
  res.status(500).json({
    success: false,
    error: 'Internal Server Error',
    message: err.message
  });
});

// Start Server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('====================================================');
  console.log('  AUTOMATED SANITIZING SYSTEM — IoT BACKEND GATEWAY');
  console.log('====================================================');
  console.log(`  Local URL:        http://localhost:${PORT}`);
  console.log(`  Network (LAN):    http://0.0.0.0:${PORT} (Reach via PC IPv4)`);
  console.log(`  Sensor Ingest:    POST http://<YOUR_PC_IP>:${PORT}/api/sensor-data`);
  console.log(`  Health Check:     http://localhost:${PORT}/api/health`);
  console.log(`  Latest Readings:  http://localhost:${PORT}/api/sensor-data/latest`);
  console.log(`  Device Auth:      X-API-Key: ${process.env.DEVICE_API_KEY ? 'CONFIGURED' : 'NOT CONFIGURED'}`);
  console.log('====================================================\n');
});

module.exports = { app, server };
