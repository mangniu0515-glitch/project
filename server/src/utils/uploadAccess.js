function normalizePublicUploadPath(filePath) {
  const value = String(filePath || '').trim().replace(/\\/g, '/');
  if (!value || value.includes('\0')) return '';
  const normalized = value.startsWith('/uploads/') ? value : `/${value.replace(/^\/+/, '')}`;
  if (!normalized.startsWith('/uploads/') || normalized.includes('/../')) return '';
  return normalized;
}

function asNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function getRows(db, sql, publicPath) {
  try {
    return db.prepare(sql).all(publicPath);
  } catch {
    return [];
  }
}

function canAccessQrcodeRows(user, rows) {
  if (!user?.auth_type) return rows.length > 0;
  if (user.auth_type !== 'ip') return rows.length > 0;

  const authorizationId = asNumber(user.authorization_id);
  if (!authorizationId) return false;

  return rows.some(row => {
    if (user.role === 'leader') {
      return asNumber(row.leader_authorization_id) === authorizationId;
    }
    if (user.role === 'user') {
      return asNumber(row.client_authorization_id) === authorizationId;
    }
    return false;
  });
}

function canAccessUploadPath(db, user, publicPath) {
  const normalizedPath = normalizePublicUploadPath(publicPath);
  if (!normalizedPath) {
    return { allowed: false, reason: 'Invalid upload path' };
  }

  if (user?.role === 'admin') {
    return { allowed: true, scope: 'admin' };
  }

  const qrcodeRows = getRows(
    db,
    `SELECT id, client_authorization_id, leader_authorization_id
     FROM qrcodes
     WHERE image_path = ?`,
    normalizedPath
  );
  if (canAccessQrcodeRows(user, qrcodeRows)) {
    return { allowed: true, scope: 'qrcode' };
  }

  const draftRows = getRows(
    db,
    'SELECT id FROM collection_rule_drafts WHERE screenshot_path = ?',
    normalizedPath
  );
  const emailRuleRows = getRows(
    db,
    'SELECT id FROM collection_email_verification_rules WHERE screenshot_path = ?',
    normalizedPath
  );

  if (draftRows.length > 0 || emailRuleRows.length > 0) {
    return { allowed: false, reason: 'Admin access required for rule screenshots' };
  }

  if (qrcodeRows.length > 0) {
    return { allowed: false, reason: 'QR code image access denied' };
  }

  return { allowed: false, reason: 'Upload file is not referenced by an accessible record' };
}

module.exports = {
  canAccessUploadPath,
  normalizePublicUploadPath
};
