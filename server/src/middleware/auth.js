const jwt = require('jsonwebtoken');
require('dotenv').config();
const { getApiKey, getJwtSecret } = require('../utils/securityConfig');

const JWT_SECRET = getJwtSecret();

function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.auth_type === 'ip' && req.db) {
      const authorization = req.db.prepare(`
        SELECT id, role, status, leader_authorization_id, qrcode_enabled, email_enabled
        FROM client_ip_authorizations
        WHERE id = ?
      `).get(decoded.authorization_id);

      if (!authorization || authorization.status !== 'approved' || authorization.role !== decoded.role) {
        return res.status(403).json({ error: 'Client IP authorization is not approved' });
      }

      decoded.leader_authorization_id = authorization.leader_authorization_id || null;
      decoded.qrcode_enabled = authorization.qrcode_enabled !== 0;
      decoded.email_enabled = authorization.email_enabled !== 0;
    }

    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

function verifyApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' });
  }

  const validApiKey = getApiKey();
  if (apiKey !== validApiKey) {
    return res.status(403).json({ error: 'Invalid API key' });
  }

  next();
}

module.exports = {
  verifyToken,
  verifyApiKey,
  JWT_SECRET
};
