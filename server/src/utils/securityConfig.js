const bcrypt = require('bcryptjs');

const DEFAULT_JWT_SECRET = 'your-secret-key-change-in-production';
const DEFAULT_API_KEY = 'plugin-api-key-change-in-production';
const DEFAULT_ADMIN_PASSWORD = 'admin123';

function isTruthy(value) {
  return value === true || value === '1' || String(value).toLowerCase() === 'true';
}

function isSecurityEnforced(env = process.env) {
  return env.NODE_ENV === 'production' || isTruthy(env.ENFORCE_PRODUCTION_SECURITY);
}

function validateSecret(name, value, placeholder, enforced) {
  const normalized = String(value || '').trim();
  if (!enforced) return;
  if (!normalized) {
    throw new Error(`${name} is required when production security is enforced`);
  }
  if (normalized === placeholder) {
    throw new Error(`${name} must not use the default placeholder value`);
  }
  if (normalized.length < 32) {
    throw new Error(`${name} must be at least 32 characters when production security is enforced`);
  }
}

function getJwtSecret(env = process.env) {
  return env.JWT_SECRET || DEFAULT_JWT_SECRET;
}

function getApiKey(env = process.env) {
  return env.API_KEY || DEFAULT_API_KEY;
}

function validateSecurityConfig(env = process.env) {
  const enforced = isSecurityEnforced(env);
  validateSecret('JWT_SECRET', getJwtSecret(env), DEFAULT_JWT_SECRET, enforced);
  validateSecret('API_KEY', getApiKey(env), DEFAULT_API_KEY, enforced);
  return { enforced };
}

function getInitialAdminCredentials(env = process.env) {
  const enforced = isSecurityEnforced(env);
  const username = String(env.ADMIN_USERNAME || 'admin').trim() || 'admin';
  const email = String(env.ADMIN_EMAIL || 'admin@example.com').trim() || 'admin@example.com';
  const password = env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;

  if (enforced) {
    if (!env.ADMIN_PASSWORD) {
      throw new Error('ADMIN_PASSWORD is required before creating the initial admin account');
    }
    if (password === DEFAULT_ADMIN_PASSWORD) {
      throw new Error('Initial admin must not use the default admin password in production');
    }
    if (String(password).length < 12) {
      throw new Error('ADMIN_PASSWORD must be at least 12 characters when production security is enforced');
    }
  }

  return { username, password, email };
}

function assertNoDefaultAdminPassword(db, env = process.env) {
  if (!isSecurityEnforced(env)) return;

  const admin = db.prepare('SELECT username, password FROM users WHERE username = ? AND role = ?')
    .get('admin', 'admin');
  if (!admin) return;

  if (bcrypt.compareSync(DEFAULT_ADMIN_PASSWORD, admin.password)) {
    throw new Error('Default admin password is still active. Change admin/admin123 before production startup.');
  }
}

module.exports = {
  DEFAULT_ADMIN_PASSWORD,
  DEFAULT_API_KEY,
  DEFAULT_JWT_SECRET,
  assertNoDefaultAdminPassword,
  getApiKey,
  getInitialAdminCredentials,
  getJwtSecret,
  isSecurityEnforced,
  validateSecurityConfig
};
