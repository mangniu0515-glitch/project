const express = require('express');
const { body, query, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { verifyToken } = require('../middleware/auth');
const { findMatchingPolicy, writeUploadAudit } = require('../utils/collectionPolicy');

const router = express.Router();

const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

function deleteUploadedImage(imagePath) {
  if (!imagePath) return;
  const absolutePath = path.join(__dirname, '../..', imagePath);
  if (fs.existsSync(absolutePath)) {
    fs.unlinkSync(absolutePath);
  }
}

function saveUploadedImage(image) {
  if (!image) return null;
  const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
  const imageBuffer = Buffer.from(base64Data, 'base64');
  const fileName = `${uuidv4()}.png`;
  const filePath = path.join(uploadsDir, fileName);

  fs.writeFileSync(filePath, imageBuffer);
  return `/uploads/${fileName}`;
}

router.post('/upload', [
  body('content').optional({ nullable: true }).isString(),
  body('image').optional(),
  body('source_url').optional(),
  body('source_page_title').optional(),
  body('width').optional().isInt(),
  body('height').optional().isInt(),
  body('format').optional(),
  body('site_id').notEmpty().isInt(),
  body('target_id').notEmpty().isInt(),
  body('matched_selector').notEmpty(),
  body('element_type').optional().isIn(['any', 'img', 'canvas']),
  body('image_src').optional(),
  body('extension_version').optional(),
  body('upload_mode').optional().isIn(['manual', 'auto', 'leader_assisted']),
  body('client_authorization_id').optional().isInt()
], verifyToken, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      content,
      image,
      source_url,
      source_page_title,
      width,
      height,
      format,
      site_id,
      target_id,
      matched_selector,
      element_type,
      image_src,
      extension_version,
      upload_mode,
      client_authorization_id
    } = req.body;
    const normalizedContent = String(content || '').trim();
    const normalizedMatchedSelector = String(matched_selector || '').trim();
    const normalizedUploadMode = ['auto', 'leader_assisted'].includes(upload_mode) ? upload_mode : 'manual';
    const tokenAuthorizationId = req.user?.auth_type === 'ip'
      ? Number(req.user.authorization_id || 0) || null
      : null;
    let clientAuthorizationId = null;
    let leaderAuthorizationId = null;
    let uploadedByAuthorizationId = tokenAuthorizationId;
    let shouldOverwriteLatest = false;

    if (req.user?.auth_type === 'ip') {
      const authorization = tokenAuthorizationId
        ? req.db.prepare('SELECT * FROM client_ip_authorizations WHERE id = ?').get(tokenAuthorizationId)
        : null;
      if (!authorization || authorization.status !== 'approved' || authorization.role !== req.user.role) {
        writeUploadAudit(req.db, {
          source_url,
          content: normalizedContent || null,
          site_id: site_id || null,
          target_id: target_id || null,
          decision: 'rejected',
          reason: 'client IP authorization is not approved',
          created_by: null,
          client_authorization_id: tokenAuthorizationId,
          leader_authorization_id: null,
          uploaded_by_authorization_id: tokenAuthorizationId,
          upload_mode: normalizedUploadMode
        });
        return res.status(403).json({ error: 'Client IP authorization is not approved' });
      }

      if (authorization.role === 'user' && normalizedUploadMode !== 'auto') {
        writeUploadAudit(req.db, {
          source_url,
          content: normalizedContent || null,
          site_id: site_id || null,
          target_id: target_id || null,
          decision: 'rejected',
          reason: 'ordinary IP users can only use auto upload',
          created_by: null,
          client_authorization_id: authorization.id,
          leader_authorization_id: authorization.leader_authorization_id || null,
          uploaded_by_authorization_id: authorization.id,
          upload_mode: normalizedUploadMode
        });
        return res.status(403).json({ error: 'Ordinary IP users can only use auto upload' });
      }

      if (authorization.role === 'leader' && normalizedUploadMode !== 'leader_assisted') {
        writeUploadAudit(req.db, {
          source_url,
          content: normalizedContent || null,
          site_id: site_id || null,
          target_id: target_id || null,
          decision: 'rejected',
          reason: 'leader IP users must select an assigned ordinary user',
          created_by: null,
          client_authorization_id: null,
          leader_authorization_id: authorization.id,
          uploaded_by_authorization_id: authorization.id,
          upload_mode: normalizedUploadMode
        });
        return res.status(403).json({ error: 'Please select one of your ordinary users before upload' });
      }

      if (normalizedUploadMode === 'auto') {
        if (req.user.role !== 'user') {
          return res.status(403).json({ error: 'Auto upload is only available to ordinary users' });
        }

        if (authorization.qrcode_enabled === 0) {
          writeUploadAudit(req.db, {
            source_url,
            content: normalizedContent || null,
            site_id: site_id || null,
            target_id: target_id || null,
            decision: 'rejected',
            reason: 'ordinary user QR collection is disabled',
            created_by: null,
            client_authorization_id: authorization.id,
            leader_authorization_id: authorization.leader_authorization_id || null,
            uploaded_by_authorization_id: authorization.id,
            upload_mode: normalizedUploadMode
          });
          return res.status(403).json({ error: 'QR collection is disabled for this ordinary user' });
        }

        if (!authorization.leader_authorization_id) {
          writeUploadAudit(req.db, {
            source_url,
            content: normalizedContent || null,
            site_id: site_id || null,
            target_id: target_id || null,
            decision: 'rejected',
            reason: 'ordinary user has no assigned leader',
            created_by: null,
            client_authorization_id: authorization.id,
            leader_authorization_id: null,
            uploaded_by_authorization_id: authorization.id,
            upload_mode: normalizedUploadMode
          });
          return res.status(403).json({ error: 'Waiting for administrator to assign a leader before auto upload' });
        }

        const leader = req.db.prepare(`
          SELECT id FROM client_ip_authorizations
          WHERE id = ? AND role = 'leader' AND status = 'approved'
        `).get(authorization.leader_authorization_id);
        if (!leader) {
          return res.status(403).json({ error: 'Assigned leader is not available' });
        }

        clientAuthorizationId = authorization.id;
        leaderAuthorizationId = leader.id;
        shouldOverwriteLatest = true;
      } else if (normalizedUploadMode === 'leader_assisted') {
        if (req.user.role !== 'leader') {
          return res.status(403).json({ error: 'Leader assisted upload is only available to leaders' });
        }

        const selectedUserId = Number(client_authorization_id || 0);
        const selectedUser = selectedUserId
          ? req.db.prepare(`
            SELECT id, qrcode_enabled FROM client_ip_authorizations
            WHERE id = ? AND role = 'user' AND status = 'approved' AND leader_authorization_id = ?
          `).get(selectedUserId, authorization.id)
          : null;
        if (!selectedUser) {
          return res.status(403).json({ error: 'Please select one of your ordinary users before upload' });
        }
        if (selectedUser.qrcode_enabled === 0) {
          writeUploadAudit(req.db, {
            source_url,
            content: normalizedContent || null,
            site_id: site_id || null,
            target_id: target_id || null,
            decision: 'rejected',
            reason: 'selected ordinary user QR collection is disabled',
            created_by: null,
            client_authorization_id: selectedUser.id,
            leader_authorization_id: authorization.id,
            uploaded_by_authorization_id: authorization.id,
            upload_mode: normalizedUploadMode
          });
          return res.status(403).json({ error: 'QR collection is disabled for the selected ordinary user' });
        }

        clientAuthorizationId = selectedUser.id;
        leaderAuthorizationId = authorization.id;
        shouldOverwriteLatest = true;
      } else {
        clientAuthorizationId = authorization.id;
        leaderAuthorizationId = req.user.role === 'leader'
          ? authorization.id
          : authorization.leader_authorization_id || null;
      }
    }

    const policy = findMatchingPolicy(req.db, req.body);
    if (!policy.allowed) {
      writeUploadAudit(req.db, {
        source_url,
        content: normalizedContent || null,
        site_id: site_id || null,
        target_id: target_id || null,
        decision: 'rejected',
        reason: policy.reason,
        created_by: req.user?.id || null,
        client_authorization_id: clientAuthorizationId,
        leader_authorization_id: leaderAuthorizationId,
        uploaded_by_authorization_id: uploadedByAuthorizationId,
        upload_mode: normalizedUploadMode
      });
      return res.status(403).json({ error: policy.reason || 'Upload is not allowed by collection policy' });
    }

    const image_path = saveUploadedImage(image);

    const clientMetadata = JSON.stringify({
      element_type: element_type || 'any',
      image_src: image_src || null,
      extension_version: extension_version || null,
      content_unparsed: !normalizedContent,
      upload_mode: normalizedUploadMode,
      auth_type: req.user?.auth_type || 'password',
      client_authorization_id: clientAuthorizationId,
      leader_authorization_id: leaderAuthorizationId,
      uploaded_by_authorization_id: uploadedByAuthorizationId
    });

    let qrcode = null;
    let statusCode = 201;
    let message = 'QR code uploaded successfully';

    if (shouldOverwriteLatest) {
      const existing = req.db.prepare(`
        SELECT * FROM qrcodes
        WHERE client_authorization_id = ?
          AND site_id = ?
          AND target_id = ?
          AND matched_selector = ?
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      `).get(clientAuthorizationId, policy.site.id, policy.target.id, normalizedMatchedSelector);

      if (existing) {
        req.db.prepare(`
          UPDATE qrcodes
          SET content = ?,
              image_path = ?,
              source_url = ?,
              source_page_title = ?,
              width = ?,
              height = ?,
              format = ?,
              created_by = ?,
              site_id = ?,
              target_id = ?,
              matched_selector = ?,
              client_metadata = ?,
              client_authorization_id = ?,
              leader_authorization_id = ?,
              uploaded_by_authorization_id = ?,
              upload_mode = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(
          normalizedContent || '[UNPARSED_QR_TARGET]',
          image_path || existing.image_path || null,
          source_url || null,
          source_page_title || null,
          width || null,
          height || null,
          format || 'png',
          null,
          policy.site.id,
          policy.target.id,
          normalizedMatchedSelector,
          clientMetadata,
          clientAuthorizationId,
          leaderAuthorizationId,
          uploadedByAuthorizationId,
          normalizedUploadMode,
          existing.id
        );

        if (image_path && existing.image_path && existing.image_path !== image_path) {
          deleteUploadedImage(existing.image_path);
        }

        qrcode = req.db.prepare('SELECT * FROM qrcodes WHERE id = ?').get(existing.id);
        statusCode = 200;
        message = 'QR code updated successfully';
      }
    }

    if (!qrcode) {
      const stmt = req.db.prepare(`
        INSERT INTO qrcodes (
          content, image_path, source_url, source_page_title, width, height, format,
          created_by, site_id, target_id, matched_selector, client_metadata,
          client_authorization_id, leader_authorization_id, uploaded_by_authorization_id, upload_mode
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        normalizedContent || '[UNPARSED_QR_TARGET]',
        image_path,
        source_url || null,
        source_page_title || null,
        width || null,
        height || null,
        format || 'png',
        req.user?.id || null,
        policy.site.id,
        policy.target.id,
        normalizedMatchedSelector,
        clientMetadata,
        clientAuthorizationId,
        leaderAuthorizationId,
        uploadedByAuthorizationId,
        normalizedUploadMode
      );

      qrcode = req.db.prepare('SELECT * FROM qrcodes WHERE id = ?').get(result.lastInsertRowid);
    }

    writeUploadAudit(req.db, {
      source_url,
      content: normalizedContent || null,
      site_id: policy.site.id,
      target_id: policy.target.id,
      decision: 'allowed',
      reason: 'matched collection policy',
      created_by: req.user?.id || null,
      client_authorization_id: clientAuthorizationId,
      leader_authorization_id: leaderAuthorizationId,
      uploaded_by_authorization_id: uploadedByAuthorizationId,
      upload_mode: normalizedUploadMode
    });

    res.status(statusCode).json({
      message,
      qrcode,
      upload_mode: normalizedUploadMode,
      overwritten: shouldOverwriteLatest && statusCode === 200
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/stats', verifyToken, (req, res) => {
  try {
    let scopeClause = 'WHERE 1=1';
    const scopeParams = [];
    if (req.user?.auth_type === 'ip') {
      if (req.user.role === 'leader') {
        scopeClause += ' AND leader_authorization_id = ?';
        scopeParams.push(req.user.authorization_id);
      } else {
        scopeClause += ' AND client_authorization_id = ?';
        scopeParams.push(req.user.authorization_id);
      }
    }

    const totalCount = req.db.prepare(`SELECT COUNT(*) as count FROM qrcodes ${scopeClause}`).get(...scopeParams).count;
    const todayCount = req.db.prepare(`
      SELECT COUNT(*) as count FROM qrcodes
      ${scopeClause} AND date(created_at) = date('now', 'localtime')
    `).get(...scopeParams).count;
    const weekCount = req.db.prepare(`
      SELECT COUNT(*) as count FROM qrcodes
      ${scopeClause} AND created_at >= datetime('now', '-7 days')
    `).get(...scopeParams).count;

    res.json({ todayCount, weekCount, totalCount });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/list', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('start_date').optional().isISO8601(),
  query('end_date').optional().isISO8601(),
  query('source_url').optional(),
  query('search').optional()
], verifyToken, (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const { start_date, end_date, source_url, search } = req.query;

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (start_date) {
      whereClause += ' AND qrcodes.created_at >= ?';
      params.push(start_date);
    }

    if (end_date) {
      whereClause += ' AND qrcodes.created_at <= ?';
      params.push(end_date);
    }

    if (source_url) {
      whereClause += ' AND qrcodes.source_url LIKE ?';
      params.push(`%${source_url}%`);
    }

    if (search) {
      whereClause += ' AND (qrcodes.content LIKE ? OR qrcodes.source_page_title LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    if (req.user?.auth_type === 'ip') {
      if (req.user.role === 'leader') {
        whereClause += ' AND qrcodes.leader_authorization_id = ?';
        params.push(req.user.authorization_id);
      } else {
        whereClause += ' AND qrcodes.client_authorization_id = ?';
        params.push(req.user.authorization_id);
      }
    }

    const countStmt = req.db.prepare(`SELECT COUNT(*) as total FROM qrcodes ${whereClause}`);
    const total = countStmt.get(...params).total;

    const dataStmt = req.db.prepare(`
      SELECT qrcodes.*, users.username as creator_name,
        source_auth.ip_address as client_ip_address,
        source_auth.role as client_role,
        source_auth.status as client_status,
        leader_auth.ip_address as leader_ip_address,
        leader_auth.role as leader_role,
        uploader_auth.ip_address as uploaded_by_ip_address,
        uploader_auth.role as uploaded_by_role,
        collection_sites.name as site_name,
        collection_targets.name as target_name
      FROM qrcodes
      LEFT JOIN users ON qrcodes.created_by = users.id
      LEFT JOIN client_ip_authorizations source_auth ON qrcodes.client_authorization_id = source_auth.id
      LEFT JOIN client_ip_authorizations leader_auth ON qrcodes.leader_authorization_id = leader_auth.id
      LEFT JOIN client_ip_authorizations uploader_auth ON qrcodes.uploaded_by_authorization_id = uploader_auth.id
      LEFT JOIN collection_sites ON qrcodes.site_id = collection_sites.id
      LEFT JOIN collection_targets ON qrcodes.target_id = collection_targets.id
      ${whereClause}
      ORDER BY qrcodes.updated_at DESC, qrcodes.created_at DESC
      LIMIT ? OFFSET ?
    `);
    const qrcodes = dataStmt.all(...params, limit, offset);

    res.json({
      qrcodes,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('List error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/export', [
  query('format').optional().isIn(['csv', 'json']),
  query('start_date').optional().isISO8601(),
  query('end_date').optional().isISO8601(),
  query('source_url').optional()
], verifyToken, (req, res) => {
  try {
    const format = req.query.format || 'json';
    const { start_date, end_date, source_url } = req.query;

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (start_date) {
      whereClause += ' AND created_at >= ?';
      params.push(start_date);
    }

    if (end_date) {
      whereClause += ' AND created_at <= ?';
      params.push(end_date);
    }

    if (source_url) {
      whereClause += ' AND source_url LIKE ?';
      params.push(`%${source_url}%`);
    }

    if (req.user?.auth_type === 'ip') {
      if (req.user.role === 'leader') {
        whereClause += ' AND leader_authorization_id = ?';
        params.push(req.user.authorization_id);
      } else {
        whereClause += ' AND client_authorization_id = ?';
        params.push(req.user.authorization_id);
      }
    }

    const stmt = req.db.prepare(`SELECT * FROM qrcodes ${whereClause} ORDER BY created_at DESC`);
    const qrcodes = stmt.all(...params);

    if (format === 'csv') {
      const headers = ['ID', 'Content', 'Source URL', 'Page Title', 'Width', 'Height', 'Format', 'Created At'];
      const csvRows = [headers.join(',')];

      qrcodes.forEach(qr => {
        const row = [
          qr.id,
          `"${(qr.content || '').replace(/"/g, '""')}"`,
          `"${(qr.source_url || '').replace(/"/g, '""')}"`,
          `"${(qr.source_page_title || '').replace(/"/g, '""')}"`,
          qr.width || '',
          qr.height || '',
          qr.format || '',
          `"${qr.created_at}"`
        ];
        csvRows.push(row.join(','));
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=qrcodes.csv');
      return res.send(csvRows.join('\n'));
    }

    res.setHeader('Content-Disposition', 'attachment; filename=qrcodes.json');
    res.json({ qrcodes });
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/batch', [
  body('ids').isArray({ min: 1 })
], verifyToken, (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { ids } = req.body;
    const placeholders = ids.map(() => '?').join(',');

    const qrcodes = req.db.prepare(`SELECT * FROM qrcodes WHERE id IN (${placeholders})`).all(...ids);
    if (req.user?.auth_type === 'ip') {
      const unauthorized = qrcodes.some(qr => {
        if (req.user.role === 'leader') return Number(qr.leader_authorization_id) !== Number(req.user.authorization_id);
        return Number(qr.client_authorization_id) !== Number(req.user.authorization_id);
      });
      if (unauthorized) return res.status(403).json({ error: 'QR code access denied' });
    }

    qrcodes.forEach(qr => {
      deleteUploadedImage(qr.image_path);
    });

    req.db.prepare(`DELETE FROM qrcodes WHERE id IN (${placeholders})`).run(...ids);

    res.json({ message: `${ids.length} QR codes deleted successfully` });
  } catch (error) {
    console.error('Batch delete error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id', verifyToken, (req, res) => {
  try {
    const qrcode = req.db.prepare(`
      SELECT qrcodes.*, users.username as creator_name,
        source_auth.ip_address as client_ip_address,
        source_auth.role as client_role,
        source_auth.status as client_status,
        leader_auth.ip_address as leader_ip_address,
        leader_auth.role as leader_role,
        uploader_auth.ip_address as uploaded_by_ip_address,
        uploader_auth.role as uploaded_by_role,
        collection_sites.name as site_name,
        collection_targets.name as target_name
      FROM qrcodes
      LEFT JOIN users ON qrcodes.created_by = users.id
      LEFT JOIN client_ip_authorizations source_auth ON qrcodes.client_authorization_id = source_auth.id
      LEFT JOIN client_ip_authorizations leader_auth ON qrcodes.leader_authorization_id = leader_auth.id
      LEFT JOIN client_ip_authorizations uploader_auth ON qrcodes.uploaded_by_authorization_id = uploader_auth.id
      LEFT JOIN collection_sites ON qrcodes.site_id = collection_sites.id
      LEFT JOIN collection_targets ON qrcodes.target_id = collection_targets.id
      WHERE qrcodes.id = ?
    `).get(req.params.id);

    if (!qrcode) {
      return res.status(404).json({ error: 'QR code not found' });
    }

    if (req.user?.auth_type === 'ip') {
      const isLeaderOwner = req.user.role === 'leader' && Number(qrcode.leader_authorization_id) === Number(req.user.authorization_id);
      const isUserOwner = req.user.role === 'user' && Number(qrcode.client_authorization_id) === Number(req.user.authorization_id);
      if (!isLeaderOwner && !isUserOwner) return res.status(403).json({ error: 'QR code access denied' });
    }

    res.json({ qrcode });
  } catch (error) {
    console.error('Get QR code error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', verifyToken, (req, res) => {
  try {
    const qrcode = req.db.prepare('SELECT * FROM qrcodes WHERE id = ?').get(req.params.id);

    if (!qrcode) {
      return res.status(404).json({ error: 'QR code not found' });
    }

    if (req.user?.auth_type === 'ip') {
      const isLeaderOwner = req.user.role === 'leader' && Number(qrcode.leader_authorization_id) === Number(req.user.authorization_id);
      const isUserOwner = req.user.role === 'user' && Number(qrcode.client_authorization_id) === Number(req.user.authorization_id);
      if (!isLeaderOwner && !isUserOwner) return res.status(403).json({ error: 'QR code access denied' });
    }

    deleteUploadedImage(qrcode.image_path);

    req.db.prepare('DELETE FROM qrcodes WHERE id = ?').run(req.params.id);

    res.json({ message: 'QR code deleted successfully' });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
