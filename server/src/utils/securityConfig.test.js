const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_ADMIN_PASSWORD,
  DEFAULT_API_KEY,
  DEFAULT_JWT_SECRET,
  getInitialAdminCredentials,
  isSecurityEnforced,
  validateSecurityConfig
} = require('./securityConfig');

test('development mode keeps local defaults usable', () => {
  const result = validateSecurityConfig({});

  assert.equal(result.enforced, false);
  assert.equal(isSecurityEnforced({ NODE_ENV: 'development' }), false);
  assert.deepEqual(getInitialAdminCredentials({}), {
    username: 'admin',
    password: DEFAULT_ADMIN_PASSWORD,
    email: 'admin@example.com'
  });
});

test('production security rejects placeholder JWT and API secrets', () => {
  assert.throws(
    () => validateSecurityConfig({
      NODE_ENV: 'production',
      JWT_SECRET: DEFAULT_JWT_SECRET,
      API_KEY: 'a-real-looking-api-key'
    }),
    /JWT_SECRET/
  );

  assert.throws(
    () => validateSecurityConfig({
      ENFORCE_PRODUCTION_SECURITY: '1',
      JWT_SECRET: 'a-long-real-jwt-secret-for-production',
      API_KEY: DEFAULT_API_KEY
    }),
    /API_KEY/
  );
});

test('enforced mode requires a non-default initial admin password', () => {
  assert.throws(
    () => getInitialAdminCredentials({
      ENFORCE_PRODUCTION_SECURITY: '1'
    }),
    /ADMIN_PASSWORD/
  );

  assert.throws(
    () => getInitialAdminCredentials({
      ENFORCE_PRODUCTION_SECURITY: '1',
      ADMIN_PASSWORD: DEFAULT_ADMIN_PASSWORD
    }),
    /default admin password/
  );

  assert.deepEqual(getInitialAdminCredentials({
    ENFORCE_PRODUCTION_SECURITY: '1',
    ADMIN_USERNAME: 'root-admin',
    ADMIN_PASSWORD: 'change-me-to-a-strong-password',
    ADMIN_EMAIL: 'root@example.com'
  }), {
    username: 'root-admin',
    password: 'change-me-to-a-strong-password',
    email: 'root@example.com'
  });
});
