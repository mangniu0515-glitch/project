const assert = require('node:assert/strict');
const test = require('node:test');

const { canAccessUploadPath } = require('./uploadAccess');

function createFakeDb({ qrcodes = [], draftScreenshots = [], emailRuleScreenshots = [] } = {}) {
  return {
    prepare(sql) {
      return {
        all(publicPath) {
          if (sql.includes('FROM qrcodes')) {
            return qrcodes.filter(row => row.image_path === publicPath);
          }
          if (sql.includes('FROM collection_rule_drafts')) {
            return draftScreenshots.filter(row => row.screenshot_path === publicPath);
          }
          if (sql.includes('FROM collection_email_verification_rules')) {
            return emailRuleScreenshots.filter(row => row.screenshot_path === publicPath);
          }
          return [];
        }
      };
    }
  };
}

test('admin can access managed uploads without ownership checks', () => {
  const result = canAccessUploadPath(
    createFakeDb(),
    { role: 'admin', username: 'admin' },
    '/uploads/orphan.png'
  );

  assert.equal(result.allowed, true);
  assert.equal(result.scope, 'admin');
});

test('ordinary IP user can access only their own QR image', () => {
  const db = createFakeDb({
    qrcodes: [
      { image_path: '/uploads/a.png', client_authorization_id: 12, leader_authorization_id: 3 },
      { image_path: '/uploads/b.png', client_authorization_id: 99, leader_authorization_id: 3 }
    ]
  });

  assert.equal(canAccessUploadPath(db, {
    auth_type: 'ip',
    role: 'user',
    authorization_id: 12
  }, '/uploads/a.png').allowed, true);

  assert.equal(canAccessUploadPath(db, {
    auth_type: 'ip',
    role: 'user',
    authorization_id: 12
  }, '/uploads/b.png').allowed, false);
});

test('leader IP user can access QR images under their ownership', () => {
  const db = createFakeDb({
    qrcodes: [
      { image_path: '/uploads/a.png', client_authorization_id: 12, leader_authorization_id: 3 }
    ]
  });

  const result = canAccessUploadPath(db, {
    auth_type: 'ip',
    role: 'leader',
    authorization_id: 3
  }, '/uploads/a.png');

  assert.equal(result.allowed, true);
  assert.equal(result.scope, 'qrcode');
});

test('IP users cannot access rule draft screenshots', () => {
  const result = canAccessUploadPath(
    createFakeDb({ draftScreenshots: [{ screenshot_path: '/uploads/draft.png' }] }),
    { auth_type: 'ip', role: 'leader', authorization_id: 3 },
    '/uploads/draft.png'
  );

  assert.equal(result.allowed, false);
});
