const express = require('express');
const { body, query, validationResult } = require('express-validator');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { verifyToken } = require('../middleware/auth');
const { findMatchingEmailVerificationRule } = require('../utils/collectionPolicy');

const router = express.Router();
const accountSyncLocks = new Map();

router.use(verifyToken);

function requireAdmin(req, res) {
  if (req.user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return false;
  }
  return true;
}

function canManageAssignments(req) {
  return req.user?.role === 'admin'
    || (req.user?.auth_type === 'ip' && req.user?.role === 'leader');
}

function requireAssignmentManager(req, res) {
  if (!canManageAssignments(req)) {
    res.status(403).json({ error: 'Admin or leader access required' });
    return false;
  }
  return true;
}

function getAssignmentById(db, id) {
  return db.prepare(`
    SELECT assignment.*,
      user.ip_address AS user_ip_address,
      user.note AS user_note,
      user.status AS user_status,
      user.leader_authorization_id AS current_leader_authorization_id,
      leader.ip_address AS leader_ip_address,
      account.name AS email_name,
      account.email_address,
      account.provider,
      account.enabled AS email_enabled
    FROM email_account_assignments assignment
    JOIN client_ip_authorizations user ON assignment.user_authorization_id = user.id
    LEFT JOIN client_ip_authorizations leader ON assignment.leader_authorization_id = leader.id
    JOIN email_pool_accounts account ON assignment.email_account_id = account.id
    WHERE assignment.id = ?
  `).get(id);
}

function listAssignments(db, whereClause = '', params = []) {
  return db.prepare(`
    SELECT assignment.*,
      user.ip_address AS user_ip_address,
      user.note AS user_note,
      user.status AS user_status,
      user.leader_authorization_id AS current_leader_authorization_id,
      leader.ip_address AS leader_ip_address,
      account.name AS email_name,
      account.email_address,
      account.provider,
      account.enabled AS email_enabled
    FROM email_account_assignments assignment
    JOIN client_ip_authorizations user ON assignment.user_authorization_id = user.id
    LEFT JOIN client_ip_authorizations leader ON assignment.leader_authorization_id = leader.id
    JOIN email_pool_accounts account ON assignment.email_account_id = account.id
    ${whereClause}
    ORDER BY assignment.assigned_at DESC, assignment.id DESC
  `).all(...params);
}

function normalizeAccountPayload(body) {
  const provider = body.provider || 'custom';
  return {
    name: String(body.name || '').trim(),
    email_address: String(body.email_address || '').trim().toLowerCase(),
    provider,
    protocol: String(body.protocol || 'imap').toLowerCase(),
    host: String(body.host || '').trim(),
    port: Number(body.port || 993),
    secure: body.secure === false || body.secure === 0 ? 0 : 1,
    username: String(body.username || body.email_address || '').trim(),
    auth_secret: body.auth_secret,
    enabled: body.enabled === false || body.enabled === 0 ? 0 : 1,
    note: String(body.note || '').trim()
  };
}

function sanitizeAccount(row) {
  if (!row) return row;
  const { auth_secret, ...safe } = row;
  return {
    ...safe,
    secure: !!safe.secure,
    enabled: !!safe.enabled,
    has_auth_secret: !!auth_secret
  };
}

function getAccount(req, id) {
  return req.db.prepare('SELECT * FROM email_pool_accounts WHERE id = ?').get(id);
}

function getAddressText(address) {
  if (!address) return '';
  if (typeof address === 'string') return address;
  if (address.text) return address.text;
  if (Array.isArray(address.value)) {
    return address.value.map(item => item.address || item.name).filter(Boolean).join(', ');
  }
  return '';
}

function extractVerificationCode(subject, text) {
  const content = `${subject || ''}\n${text || ''}`.replace(/\s+/g, ' ').trim();
  const keywordPattern = /验证码|校验码|动态码|认证码|安全码|verification\s*code|security\s*code|one[- ]time\s*(?:password|code)|\botp\b/i;
  const patterns = [
    /(?:验证码|校验码|动态码|认证码|安全码|verification\s*code|security\s*code|one[- ]time\s*(?:password|code)|\botp\b)[^A-Z0-9]{0,24}([A-Z0-9]{4,8})/i,
    /([A-Z0-9]{4,8})[^A-Z0-9]{0,24}(?:验证码|校验码|动态码|认证码|安全码|verification\s*code|security\s*code|\botp\b)/i
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match?.[1]) return match[1].toUpperCase();
  }

  if (keywordPattern.test(content)) {
    const numericMatch = content.match(/(?:^|\D)(\d{4,8})(?!\d)/);
    if (numericMatch?.[1]) return numericMatch[1];
  }

  return null;
}

function buildTextPreview(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280);
}

function extractEmailVerificationCode(subject, text) {
  const content = `${subject || ''}\n${text || ''}`.replace(/\s+/g, ' ').trim();
  const keywords = '验证码|校验码|动态码|认证码|安全码|verification\\s*code|security\\s*code|one[- ]time\\s*(?:password|code)|\\botp\\b';
  const patterns = [
    new RegExp(`(?:${keywords})[^A-Z0-9]{0,32}((?:\\d[\\s-]?){4,8})`, 'i'),
    new RegExp(`((?:\\d[\\s-]?){4,8})[^A-Z0-9]{0,32}(?:${keywords})`, 'i'),
    new RegExp(`(?:${keywords})[^A-Z0-9]{0,32}([A-Z0-9]{4,8})`, 'i')
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match?.[1]) return match[1].replace(/[\s-]/g, '').toUpperCase();
  }

  return null;
}

function isVerificationMessage(subject, text) {
  return /验证码|校验码|动态码|认证码|安全码|verification|security\s*code|one[- ]time\s*(?:password|code)|\botp\b/i
    .test(`${subject || ''}\n${text || ''}`);
}

function wildcardMatch(value, pattern) {
  const escaped = String(pattern || '')
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i').test(String(value || ''));
}

function getEnvelopeAddresses(addresses) {
  if (!Array.isArray(addresses)) return [];
  return addresses
    .map(item => String(item?.address || '').trim().toLowerCase())
    .filter(Boolean);
}

function validateExtractionPattern(pattern) {
  const value = String(pattern || '').trim();
  if (!value || value.length > 300) {
    throw new Error('Extraction pattern must be between 1 and 300 characters');
  }
  if (/(\([^)]*[+*][^)]*\))[+*{]/.test(value)) {
    throw new Error('Extraction pattern contains unsafe nested repetition');
  }
  new RegExp(value, 'i');
  if (!/\((?!\?:|\?=|\?!|\?<)[^)]*\)/.test(value)) {
    throw new Error('Extraction pattern must contain a capturing group');
  }
  return value;
}

function extractCodeByRule(rule, subject, text) {
  const match = new RegExp(rule.extraction_pattern, 'i').exec(`${subject || ''}\n${text || ''}`);
  return match?.[1] ? String(match[1]).replace(/[\s-]/g, '').toUpperCase() : null;
}

function findMatchingRule(rules, envelope) {
  const senders = getEnvelopeAddresses(envelope?.from);
  const subject = String(envelope?.subject || '');
  return rules.find(rule => {
    const senderMatches = senders.some(sender => wildcardMatch(sender, rule.sender_pattern));
    const subjectMatches = !rule.subject_pattern || wildcardMatch(subject, rule.subject_pattern);
    return senderMatches && subjectMatches;
  }) || null;
}

function getEnabledMonitorRules(db) {
  return db.prepare(`
    SELECT * FROM email_monitor_rules WHERE enabled = 1 ORDER BY id
  `).all();
}

async function scanEmailAccountForTask(req, account, task) {
  if (account.protocol !== 'imap') {
    throw new Error('Only IMAP monitoring is supported');
  }

  const rules = getEnabledMonitorRules(req.db);
  if (rules.length === 0) {
    throw new Error('No enabled email monitor rules');
  }

  const client = new ImapFlow({
    host: account.host,
    port: Number(account.port),
    secure: !!account.secure,
    auth: {
      user: account.username,
      pass: account.auth_secret
    },
    logger: false
  });

  try {
    await client.connect();
    const mailbox = await client.mailboxOpen('INBOX', { readOnly: true });
    const endUid = Math.max(0, Number(mailbox.uidNext || 1) - 1);
    if (endUid <= 0) return null;

    const requestedAt = task.requested_at ? new Date(task.requested_at).getTime() : Date.now() - 2 * 60 * 1000;
    const cutoff = requestedAt - 30 * 1000;
    const fetchRange = `${Math.max(1, endUid - 40)}:*`;
    const candidates = [];

    for await (const message of client.fetch(fetchRange, { uid: true, envelope: true, internalDate: true }, { uid: true })) {
      const uid = Number(message.uid || 0);
      if (!uid) continue;
      const internalDate = message.internalDate || message.envelope?.date || null;
      if (internalDate && new Date(internalDate).getTime() < cutoff) continue;

      const rule = findMatchingRule(rules, message.envelope);
      if (!rule) continue;
      candidates.push({ uid, internalDate, rule });
    }

    candidates.sort((a, b) => a.uid - b.uid);
    for (const candidate of candidates) {
      const message = await client.fetchOne(
        candidate.uid,
        { uid: true, envelope: true, source: true, internalDate: true },
        { uid: true }
      );
      if (!message?.source) continue;

      const parsed = await simpleParser(message.source);
      const subject = parsed.subject || message.envelope?.subject || '';
      const text = parsed.text || parsed.html || '';
      const verificationCode = extractCodeByRule(candidate.rule, subject, text);
      if (!verificationCode) continue;

      const existing = req.db.prepare(`
        SELECT id FROM email_verification_messages
        WHERE email_account_id = ? AND imap_uid = ?
      `).get(account.id, candidate.uid);

      let messageId = existing?.id || null;
      const values = [
        candidate.rule.id,
        parsed.messageId || null,
        getAddressText(parsed.from) || getAddressText(message.envelope?.from),
        getAddressText(parsed.to) || getAddressText(message.envelope?.to) || account.email_address,
        subject || null,
        verificationCode,
        'matched',
        buildTextPreview(parsed.text || ''),
        candidate.internalDate ? new Date(candidate.internalDate).toISOString() : null
      ];

      if (existing) {
        req.db.prepare(`
          UPDATE email_verification_messages
          SET monitor_rule_id = ?, message_id = ?, sender = ?, recipient = ?, subject = ?,
            verification_code = ?, parse_status = ?, text_preview = ?, received_at = ?
          WHERE id = ?
        `).run(...values, existing.id);
      } else {
        const result = req.db.prepare(`
          INSERT INTO email_verification_messages (
            email_account_id, imap_uid, monitor_rule_id, message_id, sender, recipient,
            subject, verification_code, parse_status, text_preview, received_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(account.id, candidate.uid, ...values);
        messageId = result.lastInsertRowid;
      }

      return {
        verification_code: verificationCode,
        message_id: messageId
      };
    }

    return null;
  } finally {
    try {
      await client.logout();
    } catch {
      // Ignore logout errors after failed connections.
    }
  }
}

async function performEmailAccountSync(req, account) {
  if (account.protocol !== 'imap') {
    throw new Error('Only IMAP monitoring is supported');
  }

  const rules = getEnabledMonitorRules(req.db);
  if (rules.length === 0) {
    throw new Error('No enabled email monitor rules');
  }

  const client = new ImapFlow({
    host: account.host,
    port: Number(account.port),
    secure: !!account.secure,
    auth: {
      user: account.username,
      pass: account.auth_secret
    },
    logger: false
  });

  let inserted = 0;
  let matched = 0;
  let scanned = 0;
  let filtered = 0;
  let highestUid = Number(account.last_sync_uid || 0);

  try {
    await client.connect();
    const mailbox = await client.mailboxOpen('INBOX', { readOnly: true });
    const currentHighestUid = Math.max(0, Number(mailbox.uidNext || 1) - 1);
    const previousUid = Number(account.last_sync_uid || 0);

    if (previousUid > 0 && previousUid > currentHighestUid) {
      req.db.prepare(`
        UPDATE email_pool_accounts
        SET last_sync_status = ?, last_sync_message = ?, last_sync_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run('success', 'No new messages', account.id);
      return { account_id: account.id, scanned: 0, inserted: 0, matched: 0, highest_uid: currentHighestUid };
    }

    const fetchRange = previousUid > 0
      ? `${Math.max(1, previousUid - 10)}:*`
      : `${Math.max(1, Number(mailbox.exists || 0) - 29)}:*`;
    const fetchOptions = previousUid > 0 ? { uid: true } : undefined;
    const firstSyncCutoff = Date.now() - 30 * 60 * 1000;
    const candidates = [];

    for await (const message of client.fetch(
      fetchRange,
      { uid: true, envelope: true, internalDate: true },
      fetchOptions
    )) {
      scanned += 1;
      const uid = Number(message.uid || 0);
      if (!uid) continue;
      highestUid = Math.max(highestUid, uid);

      const internalDate = message.internalDate || message.envelope?.date || null;
      if (previousUid === 0 && internalDate && new Date(internalDate).getTime() < firstSyncCutoff) {
        continue;
      }

      const rule = findMatchingRule(rules, message.envelope);
      if (!rule) {
        filtered += 1;
        continue;
      }
      candidates.push({ uid, internalDate, rule });
    }

    for (const candidate of candidates) {
      const { uid, internalDate, rule } = candidate;
      const message = await client.fetchOne(
        uid,
        { uid: true, envelope: true, source: true, internalDate: true },
        { uid: true }
      );
      if (!message?.source) continue;

      const existing = req.db.prepare(`
        SELECT id FROM email_verification_messages
        WHERE email_account_id = ? AND imap_uid = ?
      `).get(account.id, uid);

      const parsed = await simpleParser(message.source);
      const subject = parsed.subject || message.envelope?.subject || '';
      const text = parsed.text || parsed.html || '';
      const verificationCode = extractCodeByRule(rule, subject, text);
      const hasVerificationKeyword = /验证码|校验码|动态码|认证码|安全码|verification|security code|\botp\b/i
        .test(`${subject}\n${text}`);

      const parseStatus = verificationCode ? 'matched' : 'unmatched';
      const values = [
        rule.id,
        parsed.messageId || null,
        getAddressText(parsed.from) || getAddressText(message.envelope?.from),
        getAddressText(parsed.to) || getAddressText(message.envelope?.to) || account.email_address,
        subject || null,
        verificationCode,
        parseStatus,
        buildTextPreview(parsed.text || ''),
        internalDate ? new Date(internalDate).toISOString() : null
      ];

      if (existing) {
        req.db.prepare(`
          UPDATE email_verification_messages
          SET monitor_rule_id = ?, message_id = ?, sender = ?, recipient = ?, subject = ?,
            verification_code = ?, parse_status = ?, text_preview = ?, received_at = ?
          WHERE id = ?
        `).run(...values, existing.id);
      } else {
        req.db.prepare(`
          INSERT INTO email_verification_messages (
            email_account_id, imap_uid, monitor_rule_id, message_id, sender, recipient,
            subject, verification_code, parse_status, text_preview, received_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(account.id, uid, ...values);
        inserted += 1;
        if (verificationCode) matched += 1;
      }
    }

    highestUid = Math.max(highestUid, currentHighestUid);
    const message = `Scanned ${scanned}, filtered ${filtered}, captured ${inserted}, matched ${matched}`;
    req.db.prepare(`
      UPDATE email_pool_accounts
      SET last_sync_uid = ?, last_sync_status = ?, last_sync_message = ?,
        last_sync_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(highestUid, 'success', message, account.id);

    return {
      account_id: account.id,
      scanned,
      filtered,
      body_fetched: candidates.length,
      inserted,
      matched,
      highest_uid: highestUid
    };
  } finally {
    try {
      await client.logout();
    } catch {
      // Ignore logout errors after failed connections.
    }
  }
}

async function syncEmailAccount(req, account) {
  const accountId = Number(account.id);
  const activeSync = accountSyncLocks.get(accountId);
  if (activeSync) {
    const result = await activeSync;
    return { ...result, coalesced: true };
  }

  const syncPromise = performEmailAccountSync(req, account);
  accountSyncLocks.set(accountId, syncPromise);
  try {
    return await syncPromise;
  } finally {
    if (accountSyncLocks.get(accountId) === syncPromise) {
      accountSyncLocks.delete(accountId);
    }
  }
}

async function testImapConnection(config) {
  if (config.protocol !== 'imap') {
    throw new Error('Only IMAP test is supported in this version');
  }

  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: !!config.secure,
    auth: {
      user: config.username,
      pass: config.auth_secret
    },
    logger: false
  });

  try {
    await client.connect();
    const mailbox = await client.mailboxOpen('INBOX', { readOnly: true });
    return {
      success: true,
      message: `IMAP connection OK. INBOX messages: ${mailbox.exists || 0}`,
      mailbox: {
        path: mailbox.path,
        exists: mailbox.exists || 0,
        unseen: mailbox.unseen || 0
      }
    };
  } finally {
    try {
      await client.logout();
    } catch {
      // Ignore logout errors after failed connection attempts.
    }
  }
}

router.get('/accounts', (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const rows = req.db.prepare(`
      SELECT account.*,
        assignment.id AS assignment_id,
        assignment.user_authorization_id AS assigned_user_authorization_id,
        assignment.leader_authorization_id AS assigned_leader_authorization_id,
        user.ip_address AS assigned_user_ip_address,
        user.note AS assigned_user_note,
        leader.ip_address AS assigned_leader_ip_address
      FROM email_pool_accounts account
      LEFT JOIN email_account_assignments assignment
        ON assignment.email_account_id = account.id
        AND assignment.status = 'active'
      LEFT JOIN client_ip_authorizations user ON assignment.user_authorization_id = user.id
      LEFT JOIN client_ip_authorizations leader ON assignment.leader_authorization_id = leader.id
      ORDER BY account.enabled DESC, account.updated_at DESC, account.id DESC
    `).all();

    res.json({ accounts: rows.map(sanitizeAccount) });
  } catch (error) {
    console.error('Get email pool accounts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/assignments/me', (req, res) => {
  try {
    if (req.user?.auth_type !== 'ip' || req.user?.role !== 'user') {
      return res.status(403).json({ error: 'Ordinary IP user access required' });
    }

    const authorization = req.db.prepare(`
      SELECT id, email_enabled FROM client_ip_authorizations
      WHERE id = ? AND role = 'user' AND status = 'approved'
    `).get(req.user.authorization_id);
    if (!authorization) {
      return res.status(403).json({ error: 'Ordinary IP user authorization is not approved' });
    }
    if (authorization.email_enabled === 0) {
      return res.json({ feature_enabled: false, assignment: null });
    }

    const assignment = listAssignments(
      req.db,
      "WHERE assignment.status = 'active' AND assignment.user_authorization_id = ?",
      [req.user.authorization_id]
    )[0] || null;

    res.json({ feature_enabled: true, assignment });
  } catch (error) {
    console.error('Get my email assignment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/verification-tasks', [
  body('site_id').isInt({ min: 1 }),
  body('rule_id').isInt({ min: 1 }),
  body('source_url').notEmpty().trim(),
  body('email_address').isEmail()
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    if (req.user?.auth_type !== 'ip' || req.user?.role !== 'user') {
      return res.status(403).json({ error: 'Ordinary IP user access required' });
    }

    const authorization = req.db.prepare(`
      SELECT * FROM client_ip_authorizations
      WHERE id = ? AND role = 'user' AND status = 'approved'
    `).get(req.user.authorization_id);
    if (!authorization) return res.status(403).json({ error: 'Client IP authorization is not approved' });
    if (authorization.email_enabled === 0) {
      return res.status(403).json({ error: 'Email verification is disabled for this user' });
    }

    const assignment = req.db.prepare(`
      SELECT assignment.*, account.email_address, account.enabled AS account_enabled
      FROM email_account_assignments assignment
      JOIN email_pool_accounts account ON assignment.email_account_id = account.id
      WHERE assignment.status = 'active' AND assignment.user_authorization_id = ?
    `).get(authorization.id);
    if (!assignment || !assignment.account_enabled) {
      return res.status(403).json({ error: 'No active email account is assigned to this user' });
    }

    const submittedEmail = String(req.body.email_address || '').trim().toLowerCase();
    const assignedEmail = String(assignment.email_address || '').trim().toLowerCase();
    if (submittedEmail !== assignedEmail) {
      return res.status(403).json({ error: 'Submitted email does not match the assigned email account' });
    }

    const policy = findMatchingEmailVerificationRule(req.db, req.body);
    if (!policy.allowed) {
      return res.status(403).json({ error: policy.reason || 'Email verification rule is not allowed' });
    }

    const expiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
    const result = req.db.prepare(`
      INSERT INTO email_verification_tasks (
        user_authorization_id, email_account_id, site_id, rule_id, source_url,
        email_address, status, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(
      authorization.id,
      assignment.email_account_id,
      policy.site.id,
      policy.rule.id,
      req.body.source_url,
      assignedEmail,
      expiresAt
    );

    const task = req.db.prepare('SELECT * FROM email_verification_tasks WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({
      task: {
        id: task.id,
        status: task.status,
        expires_at: task.expires_at
      }
    });
  } catch (error) {
    console.error('Create email verification task error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/verification-tasks/:id', async (req, res) => {
  try {
    if (req.user?.auth_type !== 'ip' || req.user?.role !== 'user') {
      return res.status(403).json({ error: 'Ordinary IP user access required' });
    }

    const task = req.db.prepare(`
      SELECT * FROM email_verification_tasks
      WHERE id = ? AND user_authorization_id = ?
    `).get(req.params.id, req.user.authorization_id);
    if (!task) return res.status(404).json({ error: 'Email verification task not found' });

    if (task.status === 'matched') {
      return res.json({
        task: {
          id: task.id,
          status: task.status,
          verification_code: task.verification_code,
          expires_at: task.expires_at,
          completed_at: task.completed_at
        }
      });
    }
    if (task.status === 'failed' || task.status === 'expired') {
      return res.json({
        task: {
          id: task.id,
          status: task.status,
          error: task.error_message,
          expires_at: task.expires_at
        }
      });
    }

    if (new Date(task.expires_at).getTime() <= Date.now()) {
      req.db.prepare(`
        UPDATE email_verification_tasks
        SET status = 'expired', error_message = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run('Verification task timed out', task.id);
      return res.json({
        task: {
          id: task.id,
          status: 'expired',
          error: 'Verification task timed out',
          expires_at: task.expires_at
        }
      });
    }

    const account = getAccount(req, task.email_account_id);
    if (!account || !account.enabled) {
      req.db.prepare(`
        UPDATE email_verification_tasks
        SET status = 'failed', error_message = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run('Assigned email account is disabled', task.id);
      return res.json({ task: { id: task.id, status: 'failed', error: 'Assigned email account is disabled' } });
    }

    const match = await scanEmailAccountForTask(req, account, task);
    if (match?.verification_code) {
      req.db.prepare(`
        UPDATE email_verification_tasks
        SET status = 'matched', verification_code = ?, message_id = ?, completed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(match.verification_code, match.message_id || null, task.id);
      return res.json({
        task: {
          id: task.id,
          status: 'matched',
          verification_code: match.verification_code,
          completed_at: new Date().toISOString(),
          expires_at: task.expires_at
        }
      });
    }

    req.db.prepare(`
      UPDATE email_verification_tasks
      SET status = 'polling', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(task.id);

    res.json({
      task: {
        id: task.id,
        status: 'polling',
        expires_at: task.expires_at
      }
    });
  } catch (error) {
    console.error('Get email verification task error:', error);
    try {
      req.db.prepare(`
        UPDATE email_verification_tasks
        SET status = 'failed', error_message = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_authorization_id = ?
      `).run(error.message || 'Email verification task failed', req.params.id, req.user?.authorization_id || null);
    } catch {
      // Ignore persistence errors while reporting task failure.
    }
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

router.get('/assignments/options', (req, res) => {
  try {
    if (!requireAssignmentManager(req, res)) return;

    const userParams = [];
    let userFilter = "user.role = 'user' AND user.status = 'approved'";
    if (req.user.role === 'leader') {
      userFilter += ' AND user.leader_authorization_id = ?';
      userParams.push(req.user.authorization_id);
    }

    const users = req.db.prepare(`
      SELECT user.id, user.ip_address, user.note, user.leader_authorization_id,
        user.qrcode_enabled,
        user.email_enabled,
        leader.ip_address AS leader_ip_address,
        assignment.id AS assignment_id,
        assignment.email_account_id,
        account.email_address,
        account.name AS email_name
      FROM client_ip_authorizations user
      LEFT JOIN client_ip_authorizations leader ON user.leader_authorization_id = leader.id
      LEFT JOIN email_account_assignments assignment
        ON assignment.user_authorization_id = user.id
        AND assignment.status = 'active'
      LEFT JOIN email_pool_accounts account ON assignment.email_account_id = account.id
      WHERE ${userFilter}
      ORDER BY leader.ip_address, user.ip_address
    `).all(...userParams);

    const accounts = req.db.prepare(`
      SELECT account.id, account.name, account.email_address, account.provider, account.enabled,
        assignment.id AS assignment_id,
        assignment.user_authorization_id,
        user.ip_address AS assigned_user_ip_address
      FROM email_pool_accounts account
      LEFT JOIN email_account_assignments assignment
        ON assignment.email_account_id = account.id
        AND assignment.status = 'active'
      LEFT JOIN client_ip_authorizations user ON assignment.user_authorization_id = user.id
      WHERE account.enabled = 1
      ORDER BY account.name, account.email_address
    `).all();

    res.json({ users, accounts });
  } catch (error) {
    console.error('Get email assignment options error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/assignments', (req, res) => {
  try {
    const status = ['active', 'released'].includes(req.query.status)
      ? req.query.status
      : 'active';

    if (req.user?.role === 'admin') {
      return res.json({
        assignments: listAssignments(req.db, 'WHERE assignment.status = ?', [status])
      });
    }

    if (req.user?.auth_type === 'ip' && req.user?.role === 'leader') {
      return res.json({
        assignments: listAssignments(
          req.db,
          'WHERE assignment.status = ? AND assignment.leader_authorization_id = ?',
          [status, req.user.authorization_id]
        )
      });
    }

    if (req.user?.auth_type === 'ip' && req.user?.role === 'user') {
      return res.json({
        assignments: listAssignments(
          req.db,
          'WHERE assignment.status = ? AND assignment.user_authorization_id = ?',
          [status, req.user.authorization_id]
        )
      });
    }

    return res.status(403).json({ error: 'Email assignment access denied' });
  } catch (error) {
    console.error('Get email assignments error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/assignments', [
  body('user_authorization_id').isInt({ min: 1 }),
  body('email_account_id').isInt({ min: 1 })
], (req, res) => {
  try {
    if (!requireAssignmentManager(req, res)) return;

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userAuthorizationId = Number(req.body.user_authorization_id);
    const emailAccountId = Number(req.body.email_account_id);
    const user = req.db.prepare(`
      SELECT * FROM client_ip_authorizations WHERE id = ?
    `).get(userAuthorizationId);

    if (!user || user.role !== 'user' || user.status !== 'approved') {
      return res.status(400).json({ error: 'Target must be an approved ordinary user' });
    }
    if (
      req.user.role === 'leader'
      && Number(user.leader_authorization_id) !== Number(req.user.authorization_id)
    ) {
      return res.status(403).json({ error: 'Leader can only assign email accounts to owned users' });
    }

    const account = req.db.prepare(`
      SELECT id, name, email_address, enabled FROM email_pool_accounts WHERE id = ?
    `).get(emailAccountId);
    if (!account || !account.enabled) {
      return res.status(400).json({ error: 'Email account must exist and be enabled' });
    }

    const userAssignment = req.db.prepare(`
      SELECT * FROM email_account_assignments
      WHERE user_authorization_id = ? AND status = 'active'
    `).get(userAuthorizationId);
    if (userAssignment && Number(userAssignment.email_account_id) === emailAccountId) {
      return res.json({
        message: 'Email account is already assigned to this user',
        assignment: getAssignmentById(req.db, userAssignment.id)
      });
    }

    const accountAssignment = req.db.prepare(`
      SELECT * FROM email_account_assignments
      WHERE email_account_id = ? AND status = 'active'
    `).get(emailAccountId);
    if (accountAssignment) {
      return res.status(409).json({ error: 'Email account is already assigned to another user' });
    }

    if (userAssignment) {
      req.db.prepare(`
        UPDATE email_account_assignments
        SET status = 'released', released_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(userAssignment.id);
    }

    const isAdmin = req.user.role === 'admin';
    const result = req.db.prepare(`
      INSERT INTO email_account_assignments (
        user_authorization_id, email_account_id, leader_authorization_id,
        status, assignment_source, assigned_by_user_id, assigned_by_authorization_id
      ) VALUES (?, ?, ?, 'active', ?, ?, ?)
    `).run(
      userAuthorizationId,
      emailAccountId,
      user.leader_authorization_id || null,
      isAdmin ? 'admin' : 'leader',
      isAdmin ? req.user.id : null,
      isAdmin ? null : req.user.authorization_id
    );

    res.status(201).json({
      message: 'Email account assigned successfully',
      assignment: getAssignmentById(req.db, result.lastInsertRowid)
    });
  } catch (error) {
    console.error('Assign email account error:', error);
    if (String(error.message || '').includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'User or email account already has an active assignment' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/assignments/:id', (req, res) => {
  try {
    if (!requireAssignmentManager(req, res)) return;

    const assignment = getAssignmentById(req.db, Number(req.params.id));
    if (!assignment || assignment.status !== 'active') {
      return res.status(404).json({ error: 'Active email assignment not found' });
    }
    if (
      req.user.role === 'leader'
      && Number(assignment.current_leader_authorization_id) !== Number(req.user.authorization_id)
    ) {
      return res.status(403).json({ error: 'Leader can only release email accounts from owned users' });
    }

    req.db.prepare(`
      UPDATE email_account_assignments
      SET status = 'released', released_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(assignment.id);

    res.json({ message: 'Email account assignment released' });
  } catch (error) {
    console.error('Release email account assignment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/accounts', [
  body('name').notEmpty().trim().isLength({ max: 80 }),
  body('email_address').isEmail(),
  body('protocol').optional().isIn(['imap']),
  body('host').notEmpty().trim().isLength({ max: 160 }),
  body('port').isInt({ min: 1, max: 65535 }),
  body('username').notEmpty().trim().isLength({ max: 160 }),
  body('auth_secret').notEmpty().isLength({ min: 1 }),
  body('provider').optional().trim().isLength({ max: 40 }),
  body('note').optional().trim().isLength({ max: 500 })
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    if (!requireAdmin(req, res)) return;

    const payload = normalizeAccountPayload(req.body);
    const existing = req.db.prepare('SELECT id FROM email_pool_accounts WHERE email_address = ?').get(payload.email_address);
    if (existing) {
      return res.status(400).json({ error: 'Email account already exists' });
    }

    const result = req.db.prepare(`
      INSERT INTO email_pool_accounts (
        name, email_address, provider, protocol, host, port, secure, username,
        auth_secret, enabled, note, created_by, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      payload.name,
      payload.email_address,
      payload.provider,
      payload.protocol,
      payload.host,
      payload.port,
      payload.secure,
      payload.username,
      payload.auth_secret,
      payload.enabled,
      payload.note,
      req.user.id,
      req.user.id
    );

    const account = getAccount(req, result.lastInsertRowid);
    res.status(201).json({ account: sanitizeAccount(account) });
  } catch (error) {
    console.error('Create email pool account error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/accounts/:id', [
  body('name').optional().trim().isLength({ min: 1, max: 80 }),
  body('email_address').optional().isEmail(),
  body('protocol').optional().isIn(['imap']),
  body('host').optional().trim().isLength({ min: 1, max: 160 }),
  body('port').optional().isInt({ min: 1, max: 65535 }),
  body('username').optional().trim().isLength({ min: 1, max: 160 }),
  body('auth_secret').optional().isLength({ min: 1 }),
  body('provider').optional().trim().isLength({ max: 40 }),
  body('note').optional().trim().isLength({ max: 500 })
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    if (!requireAdmin(req, res)) return;

    const id = Number(req.params.id);
    const existing = getAccount(req, id);
    if (!existing) {
      return res.status(404).json({ error: 'Email account not found' });
    }

    const payload = normalizeAccountPayload({ ...existing, ...req.body });
    if (!Object.prototype.hasOwnProperty.call(req.body, 'auth_secret')) {
      payload.auth_secret = existing.auth_secret;
    }

    const duplicated = req.db.prepare('SELECT id FROM email_pool_accounts WHERE email_address = ? AND id != ?')
      .get(payload.email_address, id);
    if (duplicated) {
      return res.status(400).json({ error: 'Email account already exists' });
    }

    req.db.prepare(`
      UPDATE email_pool_accounts
      SET name = ?, email_address = ?, provider = ?, protocol = ?, host = ?, port = ?,
        secure = ?, username = ?, auth_secret = ?, enabled = ?, note = ?,
        updated_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      payload.name,
      payload.email_address,
      payload.provider,
      payload.protocol,
      payload.host,
      payload.port,
      payload.secure,
      payload.username,
      payload.auth_secret,
      payload.enabled,
      payload.note,
      req.user.id,
      id
    );

    res.json({ account: sanitizeAccount(getAccount(req, id)) });
  } catch (error) {
    console.error('Update email pool account error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/accounts/:id', (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const id = Number(req.params.id);
    const existing = getAccount(req, id);
    if (!existing) {
      return res.status(404).json({ error: 'Email account not found' });
    }

    const activeAssignment = req.db.prepare(`
      SELECT id FROM email_account_assignments
      WHERE email_account_id = ? AND status = 'active'
    `).get(id);
    if (activeAssignment) {
      return res.status(409).json({ error: 'Release the active user assignment before deleting this email account' });
    }

    req.db.prepare('DELETE FROM email_pool_accounts WHERE id = ?').run(id);
    res.json({ message: 'Email account deleted successfully' });
  } catch (error) {
    console.error('Delete email pool account error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/accounts/:id/test', async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const id = Number(req.params.id);
    const account = getAccount(req, id);
    if (!account) {
      return res.status(404).json({ error: 'Email account not found' });
    }

    const testConfig = normalizeAccountPayload({
      ...account,
      ...req.body,
      auth_secret: req.body.auth_secret || account.auth_secret
    });

    const result = await testImapConnection(testConfig);
    req.db.prepare(`
      UPDATE email_pool_accounts
      SET last_test_status = ?, last_test_message = ?, last_test_at = CURRENT_TIMESTAMP,
        updated_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run('success', result.message, req.user.id, id);

    res.json({ ...result, account: sanitizeAccount(getAccount(req, id)) });
  } catch (error) {
    console.error('Test email pool account error:', error);
    const id = Number(req.params.id);
    if (id) {
      try {
        req.db.prepare(`
          UPDATE email_pool_accounts
          SET last_test_status = ?, last_test_message = ?, last_test_at = CURRENT_TIMESTAMP,
            updated_by = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run('failed', error.message || 'Connection failed', req.user.id, id);
      } catch {
        // Ignore audit update errors.
      }
    }
    res.status(400).json({ error: error.message || 'Connection failed' });
  }
});

function normalizeMonitorRulePayload(body) {
  const senderPattern = String(body.sender_pattern || '').trim().toLowerCase();
  if (!senderPattern || senderPattern.length > 160 || !senderPattern.includes('@')) {
    throw new Error('Sender pattern must be an email address or wildcard email pattern');
  }

  return {
    name: String(body.name || '').trim(),
    sender_pattern: senderPattern,
    subject_pattern: String(body.subject_pattern || '').trim(),
    extraction_pattern: validateExtractionPattern(body.extraction_pattern),
    enabled: body.enabled === false || body.enabled === 0 ? 0 : 1
  };
}

function resetEmailMonitorCursor(req) {
  req.db.prepare(`
    UPDATE email_pool_accounts
    SET last_sync_uid = 0, updated_at = CURRENT_TIMESTAMP
    WHERE enabled = 1
  `).run();
}

router.get('/monitor/rules', (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const rules = req.db.prepare(`
      SELECT rules.*,
        (SELECT COUNT(*) FROM email_verification_messages messages
         WHERE messages.monitor_rule_id = rules.id) AS captured_count
      FROM email_monitor_rules rules
      ORDER BY enabled DESC, updated_at DESC, id DESC
    `).all();
    res.json({
      rules: rules.map(rule => ({ ...rule, enabled: !!rule.enabled }))
    });
  } catch (error) {
    console.error('Get email monitor rules error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/monitor/rules/test', [
  body('extraction_pattern').notEmpty().isLength({ max: 300 }),
  body('sample_text').notEmpty().isLength({ max: 5000 })
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    if (!requireAdmin(req, res)) return;

    const pattern = validateExtractionPattern(req.body.extraction_pattern);
    const code = extractCodeByRule({ extraction_pattern: pattern }, '', req.body.sample_text);
    res.json({ matched: !!code, verification_code: code });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Invalid extraction pattern' });
  }
});

router.post('/monitor/rules', [
  body('name').notEmpty().trim().isLength({ max: 80 }),
  body('sender_pattern').notEmpty().trim().isLength({ max: 160 }),
  body('subject_pattern').optional({ nullable: true }).trim().isLength({ max: 200 }),
  body('extraction_pattern').notEmpty().isLength({ max: 300 }),
  body('enabled').optional().isBoolean()
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    if (!requireAdmin(req, res)) return;

    const payload = normalizeMonitorRulePayload(req.body);
    const result = req.db.prepare(`
      INSERT INTO email_monitor_rules (
        name, sender_pattern, subject_pattern, extraction_pattern,
        enabled, created_by, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      payload.name,
      payload.sender_pattern,
      payload.subject_pattern || null,
      payload.extraction_pattern,
      payload.enabled,
      req.user.id,
      req.user.id
    );
    resetEmailMonitorCursor(req);
    const rule = req.db.prepare('SELECT * FROM email_monitor_rules WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ rule: { ...rule, enabled: !!rule.enabled } });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Failed to create monitor rule' });
  }
});

router.put('/monitor/rules/:id', [
  body('name').notEmpty().trim().isLength({ max: 80 }),
  body('sender_pattern').notEmpty().trim().isLength({ max: 160 }),
  body('subject_pattern').optional({ nullable: true }).trim().isLength({ max: 200 }),
  body('extraction_pattern').notEmpty().isLength({ max: 300 }),
  body('enabled').isBoolean()
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    if (!requireAdmin(req, res)) return;

    const id = Number(req.params.id);
    if (!req.db.prepare('SELECT id FROM email_monitor_rules WHERE id = ?').get(id)) {
      return res.status(404).json({ error: 'Email monitor rule not found' });
    }
    const payload = normalizeMonitorRulePayload(req.body);
    req.db.prepare(`
      UPDATE email_monitor_rules
      SET name = ?, sender_pattern = ?, subject_pattern = ?, extraction_pattern = ?,
        enabled = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      payload.name,
      payload.sender_pattern,
      payload.subject_pattern || null,
      payload.extraction_pattern,
      payload.enabled,
      req.user.id,
      id
    );
    resetEmailMonitorCursor(req);
    const rule = req.db.prepare('SELECT * FROM email_monitor_rules WHERE id = ?').get(id);
    res.json({ rule: { ...rule, enabled: !!rule.enabled } });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Failed to update monitor rule' });
  }
});

router.delete('/monitor/rules/:id', (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!req.db.prepare('SELECT id FROM email_monitor_rules WHERE id = ?').get(id)) {
      return res.status(404).json({ error: 'Email monitor rule not found' });
    }
    req.db.prepare('UPDATE email_verification_messages SET monitor_rule_id = NULL WHERE monitor_rule_id = ?').run(id);
    req.db.prepare('DELETE FROM email_monitor_rules WHERE id = ?').run(id);
    resetEmailMonitorCursor(req);
    res.json({ message: 'Email monitor rule deleted successfully' });
  } catch (error) {
    console.error('Delete email monitor rule error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/monitor/poll', [
  body('account_id').optional().isInt({ min: 1 })
], async (req, res) => {
  const results = [];
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    if (!requireAdmin(req, res)) return;

    const accountId = Number(req.body.account_id || 0);
    const accounts = accountId
      ? [getAccount(req, accountId)].filter(Boolean)
      : req.db.prepare('SELECT * FROM email_pool_accounts WHERE enabled = 1 ORDER BY id').all();

    if (accountId && accounts.length === 0) {
      return res.status(404).json({ error: 'Email account not found' });
    }

    for (const account of accounts) {
      if (!account.enabled) {
        results.push({ account_id: account.id, success: false, error: 'Email account is disabled' });
        continue;
      }

      try {
        const result = await syncEmailAccount(req, account);
        results.push({ ...result, success: true, email_address: account.email_address });
      } catch (error) {
        console.error(`Email monitor poll failed for account ${account.id}:`, error);
        req.db.prepare(`
          UPDATE email_pool_accounts
          SET last_sync_status = ?, last_sync_message = ?, last_sync_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run('failed', error.message || 'Sync failed', account.id);
        results.push({
          account_id: account.id,
          email_address: account.email_address,
          success: false,
          error: error.message || 'Sync failed'
        });
      }
    }

    res.json({
      success: results.every(item => item.success),
      results,
      totals: {
        accounts: results.length,
        inserted: results.reduce((sum, item) => sum + Number(item.inserted || 0), 0),
        matched: results.reduce((sum, item) => sum + Number(item.matched || 0), 0)
      }
    });
  } catch (error) {
    console.error('Email monitor poll error:', error);
    res.status(500).json({ error: 'Internal server error', results });
  }
});

router.get('/monitor/messages', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('account_id').optional().isInt({ min: 1 }),
  query('status').optional().isIn(['matched', 'unmatched']),
  query('search').optional().isString(),
  query('start_date').optional().isISO8601(),
  query('end_date').optional().isISO8601()
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    if (!requireAdmin(req, res)) return;

    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 20);
    const offset = (page - 1) * limit;
    let whereClause = 'WHERE 1=1';
    const params = [];

    if (req.query.account_id) {
      whereClause += ' AND messages.email_account_id = ?';
      params.push(Number(req.query.account_id));
    }
    if (req.query.status) {
      whereClause += ' AND messages.parse_status = ?';
      params.push(req.query.status);
    }
    if (req.query.search) {
      whereClause += ' AND (messages.subject LIKE ? OR messages.sender LIKE ? OR messages.verification_code LIKE ?)';
      const search = `%${req.query.search}%`;
      params.push(search, search, search);
    }
    if (req.query.start_date) {
      whereClause += ' AND messages.received_at >= ?';
      params.push(req.query.start_date);
    }
    if (req.query.end_date) {
      whereClause += ' AND messages.received_at <= ?';
      params.push(req.query.end_date);
    }

    const total = req.db.prepare(`
      SELECT COUNT(*) AS total
      FROM email_verification_messages messages
      ${whereClause}
    `).get(...params).total;

    const messages = req.db.prepare(`
      SELECT messages.*, accounts.name AS account_name, accounts.email_address,
        rules.name AS monitor_rule_name
      FROM email_verification_messages messages
      JOIN email_pool_accounts accounts ON messages.email_account_id = accounts.id
      LEFT JOIN email_monitor_rules rules ON messages.monitor_rule_id = rules.id
      ${whereClause}
      ORDER BY COALESCE(messages.received_at, messages.captured_at) DESC, messages.id DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    res.json({
      messages,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get email monitor messages error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/monitor/stats', (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const enabledAccounts = req.db.prepare('SELECT COUNT(*) AS count FROM email_pool_accounts WHERE enabled = 1').get().count;
    const enabledRules = req.db.prepare('SELECT COUNT(*) AS count FROM email_monitor_rules WHERE enabled = 1').get().count;
    const totalMessages = req.db.prepare('SELECT COUNT(*) AS count FROM email_verification_messages').get().count;
    const matchedMessages = req.db.prepare(`
      SELECT COUNT(*) AS count FROM email_verification_messages WHERE parse_status = 'matched'
    `).get().count;
    const todayMessages = req.db.prepare(`
      SELECT COUNT(*) AS count
      FROM email_verification_messages
      WHERE date(COALESCE(received_at, captured_at)) = date('now', 'localtime')
    `).get().count;

    res.json({ enabledAccounts, enabledRules, totalMessages, matchedMessages, todayMessages });
  } catch (error) {
    console.error('Get email monitor stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/monitor/messages/batch', [
  body('ids').isArray({ min: 1 })
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    if (!requireAdmin(req, res)) return;

    const ids = req.body.ids.map(Number).filter(Boolean);
    const placeholders = ids.map(() => '?').join(',');
    req.db.prepare(`DELETE FROM email_verification_messages WHERE id IN (${placeholders})`).run(...ids);
    res.json({ message: `${ids.length} messages deleted successfully` });
  } catch (error) {
    console.error('Batch delete email monitor messages error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/monitor/messages/:id', (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const id = Number(req.params.id);
    const message = req.db.prepare('SELECT id FROM email_verification_messages WHERE id = ?').get(id);
    if (!message) {
      return res.status(404).json({ error: 'Email message not found' });
    }

    req.db.prepare('DELETE FROM email_verification_messages WHERE id = ?').run(id);
    res.json({ message: 'Email message deleted successfully' });
  } catch (error) {
    console.error('Delete email monitor message error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.__testables = {
  findMatchingRule,
  getEnabledMonitorRules
};

module.exports = router;
