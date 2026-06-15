const express = require('express');
const fs = require('fs');
const path = require('path');
const { verifyToken } = require('../middleware/auth');
const { resolveManagedUploadPath } = require('../utils/storageMaintenance');
const { canAccessUploadPath, normalizePublicUploadPath } = require('../utils/uploadAccess');

const router = express.Router();
const serverRoot = path.resolve(__dirname, '..', '..');
const uploadsDir = path.join(serverRoot, 'uploads');

router.get('/*', verifyToken, (req, res) => {
  try {
    const publicPath = normalizePublicUploadPath(`/uploads/${req.params[0] || ''}`);
    const absolutePath = resolveManagedUploadPath(publicPath, { serverRoot, uploadsDir });
    if (!publicPath || !absolutePath) {
      return res.status(400).json({ error: 'Invalid upload path' });
    }

    const access = canAccessUploadPath(req.db, req.user, publicPath);
    if (!access.allowed) {
      return res.status(403).json({ error: access.reason || 'Upload access denied' });
    }

    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ error: 'Upload file not found' });
    }

    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.sendFile(absolutePath);
  } catch (error) {
    console.error('Protected upload error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
