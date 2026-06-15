const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { verifyToken, JWT_SECRET } = require('../middleware/auth');
const { getClientIp, isValidIpAddress, normalizeIp } = require('../utils/ip');

const router = express.Router();

function requireAdmin(req, res) {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return false;
  }
  return true;
}

function requireIpRole(req, res, role = null) {
  if (req.user?.auth_type !== 'ip') {
    res.status(403).json({ error: 'IP authorization token required' });
    return false;
  }
  if (role && req.user.role !== role) {
    res.status(403).json({ error: `${role} access required` });
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

function normalizeRole(value) {
  return value === 'leader' ? 'leader' : 'user';
}

function normalizeStatus(value) {
  if (value === 'approved' || value === 'disabled') return value;
  return 'pending';
}

function normalizeEnabled(value, fallback = 1) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 1 || value === '1' || value === 'true') return 1;
  if (value === false || value === 0 || value === '0' || value === 'false') return 0;
  return fallback;
}

function parseIpBatchText(text) {
  const seen = new Set();
  const entries = [];

  String(text || '')
    .split(/[\s,，;；]+/)
    .map(item => item.trim())
    .filter(Boolean)
    .forEach(raw => {
      const ipAddress = normalizeIp(raw);
      if (!isValidIpAddress(ipAddress) || seen.has(ipAddress)) return;
      seen.add(ipAddress);
      entries.push({ raw, ip_address: ipAddress });
    });

  return entries;
}

function safeUserAgent(value) {
  const text = String(value || '').trim();
  return text ? text.slice(0, 500) : null;
}

function getOrCreateAuthorization(req, ipAddress, extensionVersion) {
  const existing = req.db.prepare('SELECT * FROM client_ip_authorizations WHERE ip_address = ?').get(ipAddress);
  const userAgent = safeUserAgent(req.headers['user-agent']);

  if (existing) {
    req.db.prepare(`
      UPDATE client_ip_authorizations
      SET last_seen_at = CURRENT_TIMESTAMP, user_agent = ?, extension_version = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(userAgent, extensionVersion || existing.extension_version || null, existing.id);
    return req.db.prepare('SELECT * FROM client_ip_authorizations WHERE id = ?').get(existing.id);
  }

  const result = req.db.prepare(`
    INSERT INTO client_ip_authorizations (
      ip_address, role, status, first_seen_at, last_seen_at, user_agent, extension_version
    )
    VALUES (?, 'user', 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?)
  `).run(ipAddress, userAgent, extensionVersion || null);

  return req.db.prepare('SELECT * FROM client_ip_authorizations WHERE id = ?').get(result.lastInsertRowid);
}

function buildClientUser(row) {
  return {
    id: null,
    username: row.ip_address,
    role: row.role,
    auth_type: 'ip',
    ip_address: row.ip_address,
    authorization_id: row.id,
    leader_authorization_id: row.leader_authorization_id || null,
    qrcode_enabled: row.qrcode_enabled !== 0,
    email_enabled: row.email_enabled !== 0
  };
}

function getAuthorizationById(db, id) {
  return db.prepare(`
    SELECT authorization.*,
      leader.ip_address as leader_ip_address,
      leader.status as leader_status,
      leader.role as leader_role
    FROM client_ip_authorizations authorization
    LEFT JOIN client_ip_authorizations leader ON authorization.leader_authorization_id = leader.id
    WHERE authorization.id = ?
  `).get(id);
}

function listAuthorizationsWithLeader(db, whereClause = '', params = []) {
  return db.prepare(`
    SELECT authorization.*,
      leader.ip_address as leader_ip_address,
      leader.status as leader_status,
      leader.role as leader_role,
      email_assignment.id as email_assignment_id,
      email_assignment.email_account_id,
      email_account.name as email_name,
      email_account.email_address,
      (
        SELECT COUNT(*)
        FROM client_ip_authorizations member
        WHERE member.leader_authorization_id = authorization.id
          AND member.role = 'user'
          AND member.status = 'approved'
      ) as member_count
    FROM client_ip_authorizations authorization
    LEFT JOIN client_ip_authorizations leader ON authorization.leader_authorization_id = leader.id
    LEFT JOIN email_account_assignments email_assignment
      ON email_assignment.user_authorization_id = authorization.id
      AND email_assignment.status = 'active'
    LEFT JOIN email_pool_accounts email_account ON email_assignment.email_account_id = email_account.id
    ${whereClause}
    ORDER BY
      CASE authorization.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
      authorization.last_seen_at DESC,
      authorization.id DESC
  `).all(...params);
}

function assignLeader(db, userAuthorizationId, leaderAuthorizationId, assignedByAuthorizationId, source) {
  const user = db.prepare('SELECT * FROM client_ip_authorizations WHERE id = ?').get(userAuthorizationId);
  const leader = db.prepare('SELECT * FROM client_ip_authorizations WHERE id = ?').get(leaderAuthorizationId);

  if (!user || user.role !== 'user' || user.status !== 'approved') {
    return { success: false, status: 400, error: 'Target authorization must be an approved ordinary user' };
  }
  if (!leader || leader.role !== 'leader' || leader.status !== 'approved') {
    return { success: false, status: 400, error: 'Leader authorization must be approved' };
  }

  db.prepare(`
    UPDATE client_ip_authorizations
    SET leader_authorization_id = ?,
        leader_assigned_at = CURRENT_TIMESTAMP,
        leader_assigned_by_authorization_id = ?,
        leader_assignment_source = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    leader.id,
    assignedByAuthorizationId || null,
    source || 'manual',
    user.id
  );

  db.prepare(`
    UPDATE email_account_assignments
    SET leader_authorization_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE user_authorization_id = ? AND status = 'active'
  `).run(leader.id, user.id);

  return { success: true, user: getAuthorizationById(db, user.id), leader };
}

router.post('/check-in', [
  body('extension_version').optional().trim()
], (req, res) => {
  try {
    if (!validateRequest(req, res)) return;

    const ipAddress = getClientIp(req);
    if (!ipAddress) {
      return res.status(400).json({ error: 'Unable to detect client IP' });
    }

    const authorization = getOrCreateAuthorization(req, ipAddress, req.body.extension_version);
    const status = normalizeStatus(authorization.status);

    if (status !== 'approved') {
      return res.status(403).json({
        status,
        ip_address: authorization.ip_address,
        role: authorization.role,
        qrcode_enabled: authorization.qrcode_enabled !== 0,
        email_enabled: authorization.email_enabled !== 0,
        message: status === 'disabled' ? '当前 IP 已被禁用' : '当前 IP 等待管理员授权'
      });
    }

    const user = buildClientUser(authorization);
    const token = jwt.sign(user, JWT_SECRET, { expiresIn: '2h' });

    res.json({
      status: 'approved',
      token,
      user,
      authorization: {
        id: authorization.id,
        ip_address: authorization.ip_address,
        role: authorization.role,
        status: authorization.status,
        note: authorization.note || '',
        leader_authorization_id: authorization.leader_authorization_id || null,
        qrcode_enabled: authorization.qrcode_enabled !== 0,
        email_enabled: authorization.email_enabled !== 0
      }
    });
  } catch (error) {
    console.error('Client check-in error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.use(verifyToken);

router.get('/authorizations', (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const status = req.query.status;
    const params = [];
    let whereClause = '';

    if (status && ['pending', 'approved', 'disabled'].includes(status)) {
      whereClause = 'WHERE authorization.status = ?';
      params.push(status);
    }

    const authorizations = listAuthorizationsWithLeader(req.db, whereClause, params);

    res.json({ authorizations });
  } catch (error) {
    console.error('Get client authorizations error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/authorizations', [
  body('ip_address').notEmpty().trim(),
  body('role').optional().isIn(['leader', 'user']),
  body('status').optional().isIn(['pending', 'approved', 'disabled']),
  body('leader_authorization_id').optional({ nullable: true }).isInt(),
  body('qrcode_enabled').optional().isBoolean().toBoolean(),
  body('email_enabled').optional().isBoolean().toBoolean(),
  body('note').optional().trim()
], (req, res) => {
  try {
    if (!requireAdmin(req, res) || !validateRequest(req, res)) return;

    const ipAddress = normalizeIp(req.body.ip_address);
    if (!ipAddress || !isValidIpAddress(ipAddress)) return res.status(400).json({ error: 'Valid ip_address is required' });

    const existing = req.db.prepare('SELECT id FROM client_ip_authorizations WHERE ip_address = ?').get(ipAddress);
    if (existing) return res.status(400).json({ error: 'IP authorization already exists' });

    const role = normalizeRole(req.body.role);
    const status = normalizeStatus(req.body.status || 'approved');
    const qrcodeEnabled = role === 'user' ? normalizeEnabled(req.body.qrcode_enabled, 1) : 1;
    const emailEnabled = role === 'user' ? normalizeEnabled(req.body.email_enabled, 1) : 1;
    let leaderId = null;
    if (role === 'user' && req.body.leader_authorization_id) {
      leaderId = Number(req.body.leader_authorization_id);
      const leader = req.db.prepare('SELECT * FROM client_ip_authorizations WHERE id = ?').get(leaderId);
      if (!leader || leader.role !== 'leader' || leader.status !== 'approved') {
        return res.status(400).json({ error: 'leader_authorization_id must reference an approved leader' });
      }
    }

    const result = req.db.prepare(`
      INSERT INTO client_ip_authorizations (
        ip_address, role, status, note, first_seen_at, last_seen_at,
        qrcode_enabled, email_enabled,
        leader_authorization_id, leader_assigned_at, leader_assigned_by_authorization_id, leader_assignment_source,
        created_by, updated_by
      )
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, ?, ${leaderId ? 'CURRENT_TIMESTAMP' : 'NULL'}, ?, ?, ?, ?)
    `).run(
      ipAddress,
      role,
      status,
      req.body.note || null,
      qrcodeEnabled,
      emailEnabled,
      leaderId,
      leaderId ? null : null,
      leaderId ? 'admin' : null,
      req.user.id,
      req.user.id
    );

    const authorization = req.db.prepare('SELECT * FROM client_ip_authorizations WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ message: 'Client authorization created', authorization });
  } catch (error) {
    console.error('Create client authorization error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/authorizations/batch', [
  body('text').notEmpty().isLength({ max: 20000 }),
  body('role').optional().isIn(['leader', 'user']),
  body('status').optional().isIn(['pending', 'approved', 'disabled']),
  body('leader_authorization_id').optional({ nullable: true }).isInt(),
  body('qrcode_enabled').optional().isBoolean().toBoolean(),
  body('email_enabled').optional().isBoolean().toBoolean(),
  body('note').optional().trim().isLength({ max: 500 })
], (req, res) => {
  try {
    if (!requireAdmin(req, res) || !validateRequest(req, res)) return;

    const entries = parseIpBatchText(req.body.text);
    if (entries.length === 0) {
      return res.status(400).json({ error: 'No valid IP addresses found' });
    }
    if (entries.length > 500) {
      return res.status(400).json({ error: 'Batch size cannot exceed 500 IP addresses' });
    }

    const role = normalizeRole(req.body.role);
    const status = normalizeStatus(req.body.status || 'approved');
    const qrcodeEnabled = role === 'user' ? normalizeEnabled(req.body.qrcode_enabled, 1) : 1;
    const emailEnabled = role === 'user' ? normalizeEnabled(req.body.email_enabled, 1) : 1;
    let leaderId = null;

    if (role === 'user' && req.body.leader_authorization_id) {
      leaderId = Number(req.body.leader_authorization_id);
      const leader = req.db.prepare('SELECT * FROM client_ip_authorizations WHERE id = ?').get(leaderId);
      if (!leader || leader.role !== 'leader' || leader.status !== 'approved') {
        return res.status(400).json({ error: 'leader_authorization_id must reference an approved leader' });
      }
    }

    const created = [];
    const skipped = [];
    const insertStmt = req.db.prepare(`
      INSERT INTO client_ip_authorizations (
        ip_address, role, status, note, first_seen_at, last_seen_at,
        qrcode_enabled, email_enabled,
        leader_authorization_id, leader_assigned_at, leader_assigned_by_authorization_id, leader_assignment_source,
        created_by, updated_by
      )
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, ?, ${leaderId ? 'CURRENT_TIMESTAMP' : 'NULL'}, ?, ?, ?, ?)
    `);

    for (const entry of entries) {
      const existing = req.db.prepare('SELECT id, ip_address FROM client_ip_authorizations WHERE ip_address = ?').get(entry.ip_address);
      if (existing) {
        skipped.push({ ...entry, reason: 'already_exists', id: existing.id });
        continue;
      }

      const result = insertStmt.run(
        entry.ip_address,
        role,
        status,
        req.body.note || null,
        qrcodeEnabled,
        emailEnabled,
        leaderId,
        leaderId ? null : null,
        leaderId ? 'admin' : null,
        req.user.id,
        req.user.id
      );
      created.push({ ...entry, id: result.lastInsertRowid });
    }

    res.status(201).json({
      message: 'Client authorizations batch processed',
      summary: {
        input: entries.length,
        created: created.length,
        skipped: skipped.length
      },
      created,
      skipped
    });
  } catch (error) {
    console.error('Batch create client authorizations error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/authorizations/:id', [
  body('role').optional().isIn(['leader', 'user']),
  body('status').optional().isIn(['pending', 'approved', 'disabled']),
  body('leader_authorization_id').optional({ nullable: true }).isInt(),
  body('qrcode_enabled').optional().isBoolean().toBoolean(),
  body('email_enabled').optional().isBoolean().toBoolean(),
  body('note').optional().trim()
], (req, res) => {
  try {
    if (!requireAdmin(req, res) || !validateRequest(req, res)) return;

    const authorization = req.db.prepare('SELECT * FROM client_ip_authorizations WHERE id = ?').get(req.params.id);
    if (!authorization) return res.status(404).json({ error: 'Client authorization not found' });

    const nextRole = req.body.role !== undefined ? normalizeRole(req.body.role) : authorization.role;
    const updates = {};
    if (req.body.role !== undefined) {
      updates.role = nextRole;
      if (nextRole === 'leader') {
        updates.leader_authorization_id = null;
        updates.leader_assigned_at = null;
        updates.leader_assigned_by_authorization_id = null;
        updates.leader_assignment_source = null;
        updates.qrcode_enabled = 1;
        updates.email_enabled = 1;
      }
    }
    if (req.body.status !== undefined) updates.status = normalizeStatus(req.body.status);
    if (req.body.note !== undefined) updates.note = req.body.note || null;
    if (nextRole === 'user' && req.body.qrcode_enabled !== undefined) {
      updates.qrcode_enabled = normalizeEnabled(req.body.qrcode_enabled, authorization.qrcode_enabled !== 0 ? 1 : 0);
    }
    if (nextRole === 'user' && req.body.email_enabled !== undefined) {
      updates.email_enabled = normalizeEnabled(req.body.email_enabled, authorization.email_enabled !== 0 ? 1 : 0);
    }
    if (req.body.leader_authorization_id !== undefined && nextRole === 'user') {
      const leaderId = req.body.leader_authorization_id ? Number(req.body.leader_authorization_id) : null;
      if (leaderId) {
        const leader = req.db.prepare('SELECT * FROM client_ip_authorizations WHERE id = ?').get(leaderId);
        if (!leader || leader.role !== 'leader' || leader.status !== 'approved') {
          return res.status(400).json({ error: 'leader_authorization_id must reference an approved leader' });
        }
      }
      updates.leader_authorization_id = leaderId;
      updates.leader_assigned_at = leaderId ? new Date().toISOString() : null;
      updates.leader_assigned_by_authorization_id = null;
      updates.leader_assignment_source = leaderId ? 'admin' : null;
    }
    updates.updated_by = req.user.id;

    const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    req.db.prepare(`
      UPDATE client_ip_authorizations
      SET ${setClause}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(...Object.values(updates), req.params.id);

    const nextStatus = updates.status || authorization.status;
    if (nextRole !== 'user' || nextStatus !== 'approved') {
      req.db.prepare(`
        UPDATE email_account_assignments
        SET status = 'released', released_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE user_authorization_id = ? AND status = 'active'
      `).run(req.params.id);
    } else if (Object.prototype.hasOwnProperty.call(updates, 'leader_authorization_id')) {
      req.db.prepare(`
        UPDATE email_account_assignments
        SET leader_authorization_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_authorization_id = ? AND status = 'active'
      `).run(updates.leader_authorization_id || null, req.params.id);
    }

    if (nextRole === 'leader' && nextStatus === 'disabled') {
      req.db.prepare(`
        UPDATE client_ip_authorizations
        SET leader_authorization_id = NULL,
            leader_assigned_at = NULL,
            leader_assigned_by_authorization_id = NULL,
            leader_assignment_source = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE leader_authorization_id = ?
      `).run(req.params.id);

      req.db.prepare(`
        UPDATE email_account_assignments
        SET leader_authorization_id = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE leader_authorization_id = ? AND status = 'active'
      `).run(req.params.id);
    }

    const updated = getAuthorizationById(req.db, req.params.id);
    res.json({ message: 'Client authorization updated', authorization: updated });
  } catch (error) {
    console.error('Update client authorization error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/my-assignment', (req, res) => {
  try {
    if (!requireIpRole(req, res, 'user')) return;

    const authorization = getAuthorizationById(req.db, req.user.authorization_id);

    res.json({ assignment: authorization });
  } catch (error) {
    console.error('Get assignment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/my-users', (req, res) => {
  try {
    if (!requireIpRole(req, res, 'leader')) return;

    const users = listAuthorizationsWithLeader(
      req.db,
      "WHERE authorization.role = 'user' AND authorization.status = 'approved' AND authorization.leader_authorization_id = ?",
      [req.user.authorization_id]
    );

    res.json({ users });
  } catch (error) {
    console.error('Get my users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/assignment-requests', (req, res) => {
  try {
    const isAdmin = req.user?.role === 'admin';
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    let whereClause = "WHERE request.status = 'pending'";

    const requests = req.db.prepare(`
      SELECT request.*,
        user.ip_address as user_ip_address,
        user.note as user_note,
        leader.ip_address as leader_ip_address
      FROM leader_assignment_requests request
      LEFT JOIN client_ip_authorizations user ON request.user_authorization_id = user.id
      LEFT JOIN client_ip_authorizations leader ON request.leader_authorization_id = leader.id
      ${whereClause}
      ORDER BY request.created_at DESC, request.id DESC
    `).all();

    res.json({ requests });
  } catch (error) {
    console.error('Get assignment requests error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function reviewAssignmentRequest(req, res, nextStatus) {
  try {
    if (!requireAdmin(req, res)) return;

    const request = req.db.prepare('SELECT * FROM leader_assignment_requests WHERE id = ?').get(req.params.id);
    if (!request) return res.status(404).json({ error: 'Assignment request not found' });
    if (request.status !== 'pending') return res.status(400).json({ error: 'Only pending requests can be reviewed' });

    if (nextStatus === 'approved') {
      const result = assignLeader(
        req.db,
        request.user_authorization_id,
        request.leader_authorization_id,
        null,
        'admin'
      );
      if (!result.success) return res.status(result.status || 400).json({ error: result.error });
    }

    req.db.prepare(`
      UPDATE leader_assignment_requests
      SET status = ?,
          reviewed_by_authorization_id = NULL,
          reviewed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(nextStatus, request.id);

    const reviewed = req.db.prepare('SELECT * FROM leader_assignment_requests WHERE id = ?').get(request.id);
    res.json({ message: `Assignment request ${nextStatus}`, request: reviewed });
  } catch (error) {
    console.error('Review assignment request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

router.post('/assignment-requests/:id/approve', (req, res) => reviewAssignmentRequest(req, res, 'approved'));
router.post('/assignment-requests/:id/reject', (req, res) => reviewAssignmentRequest(req, res, 'rejected'));

router.delete('/authorizations/:id', (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const authorization = req.db.prepare('SELECT * FROM client_ip_authorizations WHERE id = ?').get(req.params.id);
    if (!authorization) return res.status(404).json({ error: 'Client authorization not found' });

    req.db.prepare(`
      UPDATE email_account_assignments
      SET status = 'released', released_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE user_authorization_id = ? AND status = 'active'
    `).run(req.params.id);

    if (authorization.role === 'leader') {
      req.db.prepare(`
        UPDATE client_ip_authorizations
        SET leader_authorization_id = NULL,
            leader_assigned_at = NULL,
            leader_assigned_by_authorization_id = NULL,
            leader_assignment_source = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE leader_authorization_id = ?
      `).run(req.params.id);
      req.db.prepare(`
        UPDATE email_account_assignments
        SET leader_authorization_id = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE leader_authorization_id = ? AND status = 'active'
      `).run(req.params.id);
    }

    req.db.prepare('DELETE FROM client_ip_authorizations WHERE id = ?').run(req.params.id);
    res.json({ message: 'Client authorization deleted' });
  } catch (error) {
    console.error('Delete client authorization error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.__testables = {
  parseIpBatchText
};

module.exports = router;
