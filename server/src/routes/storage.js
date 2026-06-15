const express = require('express');
const { body, validationResult } = require('express-validator');
const { verifyToken } = require('../middleware/auth');
const {
  DEFAULT_RETENTION,
  getStorageOverview,
  runStorageCleanup
} = require('../utils/storageMaintenance');

const router = express.Router();

router.use(verifyToken);

function requireAdmin(req, res) {
  if (req.user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return false;
  }
  return true;
}

function validateRequest(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return false;
  }
  return true;
}

function normalizeCleanupOptions(bodyPayload = {}) {
  return {
    auditLogRetentionDays: bodyPayload.auditLogRetentionDays || DEFAULT_RETENTION.auditLogRetentionDays,
    emailMessageRetentionDays: bodyPayload.emailMessageRetentionDays || DEFAULT_RETENTION.emailMessageRetentionDays,
    emailTaskRetentionDays: bodyPayload.emailTaskRetentionDays || DEFAULT_RETENTION.emailTaskRetentionDays,
    draftRetentionDays: bodyPayload.draftRetentionDays || DEFAULT_RETENTION.draftRetentionDays,
    cleanupAuditLogs: bodyPayload.cleanupAuditLogs !== false,
    cleanupEmailMessages: bodyPayload.cleanupEmailMessages !== false,
    cleanupEmailTasks: bodyPayload.cleanupEmailTasks !== false,
    cleanupDrafts: bodyPayload.cleanupDrafts !== false,
    deleteOrphanUploads: bodyPayload.deleteOrphanUploads === true,
    compactDatabase: bodyPayload.compactDatabase !== false
  };
}

router.get('/overview', (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    res.json(getStorageOverview(req.db));
  } catch (error) {
    console.error('Storage overview error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/cleanup', [
  body('auditLogRetentionDays').optional().isInt({ min: 1, max: 3650 }),
  body('emailMessageRetentionDays').optional().isInt({ min: 1, max: 3650 }),
  body('emailTaskRetentionDays').optional().isInt({ min: 1, max: 3650 }),
  body('draftRetentionDays').optional().isInt({ min: 1, max: 3650 }),
  body('cleanupAuditLogs').optional().isBoolean(),
  body('cleanupEmailMessages').optional().isBoolean(),
  body('cleanupEmailTasks').optional().isBoolean(),
  body('cleanupDrafts').optional().isBoolean(),
  body('deleteOrphanUploads').optional().isBoolean(),
  body('compactDatabase').optional().isBoolean()
], (req, res) => {
  if (!requireAdmin(req, res) || !validateRequest(req, res)) return;

  try {
    const result = runStorageCleanup(req.db, normalizeCleanupOptions(req.body));
    res.json(result);
  } catch (error) {
    console.error('Storage cleanup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
