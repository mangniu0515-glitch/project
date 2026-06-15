const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const { verifyToken } = require('../middleware/auth');
const {
  getEnabledEmailVerificationRulesForSite,
  getEnabledHiddenRulesForSite,
  getEnabledSites,
  getEnabledTargetsForSite
} = require('../utils/collectionPolicy');

const router = express.Router();
const uploadsDir = path.join(__dirname, '../../uploads');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

router.get('/public-hidden-policy', (req, res) => {
  try {
    const sites = getEnabledSites(req.db)
      .map(site => ({
        id: site.id,
        name: site.name,
        url_pattern: site.url_pattern,
        enabled: !!site.enabled,
        targets: [],
        hidden_rules: getEnabledHiddenRulesForSite(req.db, site.id).map(rule => ({
          id: rule.id,
          site_id: rule.site_id,
          name: rule.name,
          page_url_pattern: rule.page_url_pattern,
          selector: rule.selector,
          hide_method: rule.hide_method || 'cover',
          enabled: !!rule.enabled
        })),
        email_verification_rules: []
      }))
      .filter(site => site.hidden_rules.length > 0);

    res.json({
      version: new Date().toISOString(),
      policy_type: 'public_hidden',
      sites
    });
  } catch (error) {
    console.error('Get public hidden policy error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.use(verifyToken);

function requireAdmin(req, res) {
  if (req.user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return false;
  }
  return true;
}

function booleanToInt(value) {
  return value === false || value === 0 || value === '0' ? 0 : 1;
}

function validateRequest(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return false;
  }
  return true;
}

function optionalNonEmptyString(field) {
  return body(field).optional({ values: 'falsy' }).trim().notEmpty();
}

function saveBase64Image(image) {
  if (!image) return null;

  const match = String(image).match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (!match) return null;

  const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
  const fileName = `${uuidv4()}.${ext === 'svg+xml' ? 'svg' : ext}`;
  const filePath = path.join(uploadsDir, fileName);
  fs.writeFileSync(filePath, Buffer.from(match[2], 'base64'));
  return `/uploads/${fileName}`;
}

function normalizeDraft(row) {
  if (!row) return row;
  return {
    ...row,
    element_rect: row.element_rect ? JSON.parse(row.element_rect) : null,
    email_selectors: row.email_input_selector || row.send_button_selector || row.code_input_selector
      ? {
        email_input_selector: row.email_input_selector || null,
        send_button_selector: row.send_button_selector || null,
        code_input_selector: row.code_input_selector || null
      }
      : null
  };
}

function generateDefaultSiteName(sourceUrl) {
  try {
    return new URL(sourceUrl).hostname;
  } catch {
    return '采集站点';
  }
}

function generateDefaultTargetName(elementTag) {
  return `${String(elementTag || '目标').toUpperCase()} 采集目标`;
}

function normalizeDraftType(value) {
  if (value === 'email_verification') return 'email_verification';
  return value === 'hidden_element' ? 'hidden_element' : 'qrcode_target';
}

function normalizeHideMethod(value) {
  return value === 'remove' ? 'remove' : 'cover';
}

router.get('/policy', (req, res) => {
  try {
    const sites = getEnabledSites(req.db).map(site => ({
      id: site.id,
      name: site.name,
      url_pattern: site.url_pattern,
      enabled: !!site.enabled,
      targets: getEnabledTargetsForSite(req.db, site.id).map(target => ({
        id: target.id,
        site_id: target.site_id,
        name: target.name,
        page_url_pattern: target.page_url_pattern,
        selector: target.selector,
        element_type: target.element_type || 'any',
        enabled: !!target.enabled
      })),
      hidden_rules: getEnabledHiddenRulesForSite(req.db, site.id).map(rule => ({
        id: rule.id,
        site_id: rule.site_id,
        name: rule.name,
        page_url_pattern: rule.page_url_pattern,
        selector: rule.selector,
        hide_method: rule.hide_method || 'cover',
        enabled: !!rule.enabled
      })),
      email_verification_rules: getEnabledEmailVerificationRulesForSite(req.db, site.id).map(rule => ({
        id: rule.id,
        site_id: rule.site_id,
        name: rule.name,
        page_url_pattern: rule.page_url_pattern,
        email_input_selector: rule.email_input_selector,
        send_button_selector: rule.send_button_selector,
        code_input_selector: rule.code_input_selector,
        enabled: !!rule.enabled
      }))
    }));

    res.json({
      version: new Date().toISOString(),
      sites
    });
  } catch (error) {
    console.error('Get policy error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/drafts', (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const status = req.query.status;
    const params = [];
    let whereClause = '';

    if (status) {
      whereClause = 'WHERE collection_rule_drafts.status = ?';
      params.push(status);
    }

    const drafts = req.db.prepare(`
      SELECT collection_rule_drafts.*,
        users.username as creator_name,
        reviewer.username as reviewer_name,
        collection_sites.name as site_name,
        collection_targets.name as target_name
      FROM collection_rule_drafts
      LEFT JOIN users ON collection_rule_drafts.created_by = users.id
      LEFT JOIN users reviewer ON collection_rule_drafts.reviewed_by = reviewer.id
      LEFT JOIN collection_sites ON collection_rule_drafts.site_id = collection_sites.id
      LEFT JOIN collection_targets ON collection_rule_drafts.target_id = collection_targets.id
      ${whereClause}
      ORDER BY collection_rule_drafts.id DESC
      LIMIT 200
    `).all(...params).map(normalizeDraft);

    res.json({ drafts });
  } catch (error) {
    console.error('Get collection drafts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/drafts', [
  body('source_url').notEmpty().trim(),
  body('url_pattern').notEmpty().trim(),
  body('selector').notEmpty().trim(),
  body('element_type').optional().isIn(['any', 'img', 'canvas']),
  body('draft_type').optional().isIn(['qrcode_target', 'hidden_element', 'email_verification']),
  body('hide_method').optional().isIn(['cover', 'remove']),
  body('email_input_selector').optional().trim(),
  body('send_button_selector').optional().trim(),
  body('code_input_selector').optional().trim(),
  body('suggested_site_name').optional().trim(),
  body('suggested_target_name').optional().trim(),
  body('element_tag').optional().trim(),
  body('element_text').optional().trim(),
  body('element_rect').optional(),
  body('screenshot').optional()
], (req, res) => {
  try {
    if (!requireAdmin(req, res) || !validateRequest(req, res)) return;

    const {
      source_url,
      url_pattern,
      selector,
      element_type,
      draft_type,
      hide_method,
      email_input_selector,
      send_button_selector,
      code_input_selector,
      suggested_site_name,
      suggested_target_name,
      element_tag,
      element_text,
      element_rect,
      screenshot
    } = req.body;

    const screenshotPath = saveBase64Image(screenshot);
    const rect = element_rect ? JSON.stringify(element_rect) : null;
    const normalizedDraftType = normalizeDraftType(draft_type);
    if (normalizedDraftType === 'email_verification' && (!email_input_selector || !send_button_selector || !code_input_selector)) {
      return res.status(400).json({ error: 'email verification drafts require email_input_selector, send_button_selector and code_input_selector' });
    }
    const result = req.db.prepare(`
      INSERT INTO collection_rule_drafts (
        source_url, url_pattern, selector, element_type, suggested_site_name,
        suggested_target_name, element_tag, element_text, element_rect,
        screenshot_path, draft_type, hide_method, email_input_selector, send_button_selector,
        code_input_selector, status, created_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(
      source_url,
      url_pattern,
      normalizedDraftType === 'email_verification' ? email_input_selector : selector,
      element_type || 'any',
      suggested_site_name || generateDefaultSiteName(source_url),
      suggested_target_name || generateDefaultTargetName(element_tag),
      element_tag || null,
      element_text || null,
      rect,
      screenshotPath,
      normalizedDraftType,
      normalizedDraftType === 'hidden_element' ? normalizeHideMethod(hide_method) : 'cover',
      normalizedDraftType === 'email_verification' ? email_input_selector : null,
      normalizedDraftType === 'email_verification' ? send_button_selector : null,
      normalizedDraftType === 'email_verification' ? code_input_selector : null,
      req.user.id
    );

    const draft = normalizeDraft(req.db.prepare('SELECT * FROM collection_rule_drafts WHERE id = ?').get(result.lastInsertRowid));
    res.status(201).json({ message: 'Collection rule draft created', draft });
  } catch (error) {
    console.error('Create collection draft error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/drafts/:id', [
  optionalNonEmptyString('url_pattern'),
  optionalNonEmptyString('selector'),
  body('draft_type').optional().isIn(['qrcode_target', 'hidden_element', 'email_verification']),
  body('element_type').optional().isIn(['any', 'img', 'canvas']),
  body('hide_method').optional().isIn(['cover', 'remove']),
  optionalNonEmptyString('email_input_selector'),
  optionalNonEmptyString('send_button_selector'),
  optionalNonEmptyString('code_input_selector'),
  optionalNonEmptyString('suggested_site_name'),
  optionalNonEmptyString('suggested_target_name')
], (req, res) => {
  try {
    if (!requireAdmin(req, res) || !validateRequest(req, res)) return;

    const draft = req.db.prepare('SELECT * FROM collection_rule_drafts WHERE id = ?').get(req.params.id);
    if (!draft) return res.status(404).json({ error: 'Collection draft not found' });
    if (draft.status !== 'pending') return res.status(400).json({ error: 'Only pending collection drafts can be edited' });

    const updates = {};
    [
      'url_pattern',
      'selector',
      'element_type',
      'draft_type',
      'hide_method',
      'email_input_selector',
      'send_button_selector',
      'code_input_selector',
      'suggested_site_name',
      'suggested_target_name'
    ].forEach(key => {
      if (req.body[key] !== undefined) {
        updates[key] = key === 'draft_type'
          ? normalizeDraftType(req.body[key])
          : key === 'hide_method'
            ? normalizeHideMethod(req.body[key])
            : req.body[key];
      }
    });

    const nextDraftType = updates.draft_type || draft.draft_type;
    if (nextDraftType !== 'email_verification') {
      updates.email_input_selector = null;
      updates.send_button_selector = null;
      updates.code_input_selector = null;
    }

    if (Object.keys(updates).length > 0) {
      const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
      req.db.prepare(`UPDATE collection_rule_drafts SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(...Object.values(updates), req.params.id);
    }

    const updatedDraft = normalizeDraft(req.db.prepare('SELECT * FROM collection_rule_drafts WHERE id = ?').get(req.params.id));
    res.json({ message: 'Collection draft updated', draft: updatedDraft });
  } catch (error) {
    console.error('Update collection draft error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/drafts/:id/approve', [
  optionalNonEmptyString('url_pattern'),
  optionalNonEmptyString('selector'),
  body('draft_type').optional().isIn(['qrcode_target', 'hidden_element', 'email_verification']),
  body('element_type').optional().isIn(['any', 'img', 'canvas']),
  body('hide_method').optional().isIn(['cover', 'remove']),
  optionalNonEmptyString('email_input_selector'),
  optionalNonEmptyString('send_button_selector'),
  optionalNonEmptyString('code_input_selector'),
  optionalNonEmptyString('suggested_site_name'),
  optionalNonEmptyString('suggested_target_name')
], (req, res) => {
  try {
    if (!requireAdmin(req, res) || !validateRequest(req, res)) return;

    const draft = req.db.prepare('SELECT * FROM collection_rule_drafts WHERE id = ?').get(req.params.id);
    if (!draft) return res.status(404).json({ error: 'Collection draft not found' });
    if (draft.status !== 'pending') return res.status(400).json({ error: 'Only pending collection drafts can be approved' });

    const urlPattern = req.body.url_pattern || draft.url_pattern;
    const selector = req.body.selector || draft.selector;
    const elementType = req.body.element_type || draft.element_type || 'any';
    const draftType = normalizeDraftType(req.body.draft_type || draft.draft_type);
    const hideMethod = normalizeHideMethod(req.body.hide_method || draft.hide_method);
    const emailInputSelector = req.body.email_input_selector || draft.email_input_selector || selector;
    const sendButtonSelector = req.body.send_button_selector || draft.send_button_selector;
    const codeInputSelector = req.body.code_input_selector || draft.code_input_selector;
    const siteName = req.body.suggested_site_name || draft.suggested_site_name || generateDefaultSiteName(draft.source_url);
    const targetName = req.body.suggested_target_name || draft.suggested_target_name || generateDefaultTargetName(draft.element_tag);

    if (draftType === 'email_verification' && (!emailInputSelector || !sendButtonSelector || !codeInputSelector)) {
      return res.status(400).json({ error: 'email verification rules require all three selectors' });
    }

    let site = req.db.prepare('SELECT * FROM collection_sites WHERE url_pattern = ? ORDER BY id DESC LIMIT 1').get(urlPattern);
    if (!site) {
      const siteResult = req.db.prepare(`
        INSERT INTO collection_sites (name, url_pattern, enabled, created_by)
        VALUES (?, ?, 1, ?)
      `).run(siteName, urlPattern, req.user.id);
      site = req.db.prepare('SELECT * FROM collection_sites WHERE id = ?').get(siteResult.lastInsertRowid);
    } else if (!site.enabled) {
      req.db.prepare('UPDATE collection_sites SET enabled = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(site.id);
      site = req.db.prepare('SELECT * FROM collection_sites WHERE id = ?').get(site.id);
    }

    let target = null;
    let hiddenRule = null;
    let emailRule = null;

    if (draftType === 'hidden_element') {
      const ruleResult = req.db.prepare(`
        INSERT INTO collection_hidden_rules (site_id, name, page_url_pattern, selector, hide_method, enabled)
        VALUES (?, ?, ?, ?, ?, 1)
      `).run(site.id, targetName, urlPattern, selector, hideMethod);
      hiddenRule = req.db.prepare('SELECT * FROM collection_hidden_rules WHERE id = ?').get(ruleResult.lastInsertRowid);
    } else if (draftType === 'email_verification') {
      const ruleResult = req.db.prepare(`
        INSERT INTO collection_email_verification_rules (
          site_id, name, page_url_pattern, email_input_selector, send_button_selector,
          code_input_selector, enabled, screenshot_path
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
      `).run(site.id, targetName, urlPattern, emailInputSelector, sendButtonSelector, codeInputSelector, draft.screenshot_path || null);
      emailRule = req.db.prepare('SELECT * FROM collection_email_verification_rules WHERE id = ?').get(ruleResult.lastInsertRowid);
    } else {
      const targetResult = req.db.prepare(`
        INSERT INTO collection_targets (site_id, name, page_url_pattern, selector, element_type, enabled)
        VALUES (?, ?, ?, ?, ?, 1)
      `).run(site.id, targetName, urlPattern, selector, elementType);
      target = req.db.prepare('SELECT * FROM collection_targets WHERE id = ?').get(targetResult.lastInsertRowid);
    }

    req.db.prepare(`
      UPDATE collection_rule_drafts
      SET url_pattern = ?, selector = ?, element_type = ?, draft_type = ?, hide_method = ?, suggested_site_name = ?,
        suggested_target_name = ?, email_input_selector = ?, send_button_selector = ?, code_input_selector = ?,
        status = 'approved', site_id = ?, target_id = ?, hide_rule_id = ?, email_rule_id = ?,
        reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      urlPattern,
      draftType === 'email_verification' ? emailInputSelector : selector,
      elementType,
      draftType,
      hideMethod,
      siteName,
      targetName,
      draftType === 'email_verification' ? emailInputSelector : null,
      draftType === 'email_verification' ? sendButtonSelector : null,
      draftType === 'email_verification' ? codeInputSelector : null,
      site.id,
      target?.id || null,
      hiddenRule?.id || null,
      emailRule?.id || null,
      req.user.id,
      req.params.id
    );

    const updatedDraft = normalizeDraft(req.db.prepare('SELECT * FROM collection_rule_drafts WHERE id = ?').get(req.params.id));
    res.json({ message: 'Collection draft approved', draft: updatedDraft, site, target, hidden_rule: hiddenRule, email_rule: emailRule });
  } catch (error) {
    console.error('Approve collection draft error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/drafts/:id/reject', (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const draft = req.db.prepare('SELECT * FROM collection_rule_drafts WHERE id = ?').get(req.params.id);
    if (!draft) return res.status(404).json({ error: 'Collection draft not found' });
    if (draft.status !== 'pending') return res.status(400).json({ error: 'Only pending collection drafts can be rejected' });

    req.db.prepare(`
      UPDATE collection_rule_drafts
      SET status = 'rejected', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(req.user.id, req.params.id);

    const updatedDraft = normalizeDraft(req.db.prepare('SELECT * FROM collection_rule_drafts WHERE id = ?').get(req.params.id));
    res.json({ message: 'Collection draft rejected', draft: updatedDraft });
  } catch (error) {
    console.error('Reject collection draft error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/sites', (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const sites = req.db.prepare(`
      SELECT collection_sites.*,
        COUNT(DISTINCT collection_targets.id) as target_count,
        COUNT(DISTINCT collection_hidden_rules.id) as hidden_rule_count,
        COUNT(DISTINCT collection_email_verification_rules.id) as email_rule_count
      FROM collection_sites
      LEFT JOIN collection_targets ON collection_sites.id = collection_targets.site_id
      LEFT JOIN collection_hidden_rules ON collection_sites.id = collection_hidden_rules.site_id
      LEFT JOIN collection_email_verification_rules ON collection_sites.id = collection_email_verification_rules.site_id
      GROUP BY collection_sites.id
      ORDER BY collection_sites.id DESC
    `).all();

    res.json({ sites });
  } catch (error) {
    console.error('Get collection sites error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/sites', [
  body('name').notEmpty().trim(),
  body('url_pattern').notEmpty().trim(),
  body('enabled').optional().isBoolean()
], (req, res) => {
  try {
    if (!requireAdmin(req, res) || !validateRequest(req, res)) return;

    const { name, url_pattern, enabled } = req.body;
    const result = req.db.prepare(`
      INSERT INTO collection_sites (name, url_pattern, enabled, created_by)
      VALUES (?, ?, ?, ?)
    `).run(name, url_pattern, booleanToInt(enabled), req.user.id);

    const site = req.db.prepare('SELECT * FROM collection_sites WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ message: 'Collection site created', site });
  } catch (error) {
    console.error('Create collection site error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/sites/:id', [
  body('name').optional().trim().notEmpty(),
  body('url_pattern').optional().trim().notEmpty(),
  body('enabled').optional().isBoolean()
], (req, res) => {
  try {
    if (!requireAdmin(req, res) || !validateRequest(req, res)) return;

    const site = req.db.prepare('SELECT * FROM collection_sites WHERE id = ?').get(req.params.id);
    if (!site) return res.status(404).json({ error: 'Collection site not found' });

    const updates = {};
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.url_pattern !== undefined) updates.url_pattern = req.body.url_pattern;
    if (req.body.enabled !== undefined) updates.enabled = booleanToInt(req.body.enabled);

    if (Object.keys(updates).length > 0) {
      const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
      req.db.prepare(`UPDATE collection_sites SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(...Object.values(updates), req.params.id);
    }

    const updatedSite = req.db.prepare('SELECT * FROM collection_sites WHERE id = ?').get(req.params.id);
    res.json({ message: 'Collection site updated', site: updatedSite });
  } catch (error) {
    console.error('Update collection site error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/sites/:id', (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const site = req.db.prepare('SELECT * FROM collection_sites WHERE id = ?').get(req.params.id);
    if (!site) return res.status(404).json({ error: 'Collection site not found' });

    req.db.prepare('DELETE FROM collection_targets WHERE site_id = ?').run(req.params.id);
    req.db.prepare('DELETE FROM collection_hidden_rules WHERE site_id = ?').run(req.params.id);
    req.db.prepare('DELETE FROM collection_email_verification_rules WHERE site_id = ?').run(req.params.id);
    req.db.prepare('DELETE FROM collection_sites WHERE id = ?').run(req.params.id);

    res.json({ message: 'Collection site deleted' });
  } catch (error) {
    console.error('Delete collection site error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/sites/:siteId/targets', (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const targets = req.db.prepare(`
      SELECT * FROM collection_targets
      WHERE site_id = ?
      ORDER BY id DESC
    `).all(req.params.siteId);

    res.json({ targets });
  } catch (error) {
    console.error('Get collection targets error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/sites/:siteId/targets', [
  body('name').notEmpty().trim(),
  body('page_url_pattern').notEmpty().trim(),
  body('selector').notEmpty().trim(),
  body('element_type').optional().isIn(['any', 'img', 'canvas']),
  body('enabled').optional().isBoolean()
], (req, res) => {
  try {
    if (!requireAdmin(req, res) || !validateRequest(req, res)) return;

    const site = req.db.prepare('SELECT * FROM collection_sites WHERE id = ?').get(req.params.siteId);
    if (!site) return res.status(404).json({ error: 'Collection site not found' });

    const { name, page_url_pattern, selector, element_type, enabled } = req.body;
    const result = req.db.prepare(`
      INSERT INTO collection_targets (site_id, name, page_url_pattern, selector, element_type, enabled)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      req.params.siteId,
      name,
      page_url_pattern,
      selector,
      element_type || 'any',
      booleanToInt(enabled)
    );

    const target = req.db.prepare('SELECT * FROM collection_targets WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ message: 'Collection target created', target });
  } catch (error) {
    console.error('Create collection target error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/targets/:targetId', [
  body('name').optional().trim().notEmpty(),
  body('page_url_pattern').optional().trim().notEmpty(),
  body('selector').optional().trim().notEmpty(),
  body('element_type').optional().isIn(['any', 'img', 'canvas']),
  body('enabled').optional().isBoolean()
], (req, res) => {
  try {
    if (!requireAdmin(req, res) || !validateRequest(req, res)) return;

    const target = req.db.prepare('SELECT * FROM collection_targets WHERE id = ?').get(req.params.targetId);
    if (!target) return res.status(404).json({ error: 'Collection target not found' });

    const updates = {};
    ['name', 'page_url_pattern', 'selector', 'element_type'].forEach(key => {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    });
    if (req.body.enabled !== undefined) updates.enabled = booleanToInt(req.body.enabled);

    if (Object.keys(updates).length > 0) {
      const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
      req.db.prepare(`UPDATE collection_targets SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(...Object.values(updates), req.params.targetId);
    }

    const updatedTarget = req.db.prepare('SELECT * FROM collection_targets WHERE id = ?').get(req.params.targetId);
    res.json({ message: 'Collection target updated', target: updatedTarget });
  } catch (error) {
    console.error('Update collection target error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/targets/:targetId', (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const target = req.db.prepare('SELECT * FROM collection_targets WHERE id = ?').get(req.params.targetId);
    if (!target) return res.status(404).json({ error: 'Collection target not found' });

    req.db.prepare('DELETE FROM collection_targets WHERE id = ?').run(req.params.targetId);
    res.json({ message: 'Collection target deleted' });
  } catch (error) {
    console.error('Delete collection target error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/sites/:siteId/hidden-rules', (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const rules = req.db.prepare(`
      SELECT * FROM collection_hidden_rules
      WHERE site_id = ?
      ORDER BY id DESC
    `).all(req.params.siteId);

    res.json({ rules });
  } catch (error) {
    console.error('Get hidden rules error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/sites/:siteId/hidden-rules', [
  body('name').notEmpty().trim(),
  body('page_url_pattern').notEmpty().trim(),
  body('selector').notEmpty().trim(),
  body('hide_method').optional().isIn(['cover', 'remove']),
  body('enabled').optional().isBoolean()
], (req, res) => {
  try {
    if (!requireAdmin(req, res) || !validateRequest(req, res)) return;

    const site = req.db.prepare('SELECT * FROM collection_sites WHERE id = ?').get(req.params.siteId);
    if (!site) return res.status(404).json({ error: 'Collection site not found' });

    const { name, page_url_pattern, selector, hide_method, enabled } = req.body;
    const result = req.db.prepare(`
      INSERT INTO collection_hidden_rules (site_id, name, page_url_pattern, selector, hide_method, enabled)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      req.params.siteId,
      name,
      page_url_pattern,
      selector,
      normalizeHideMethod(hide_method),
      booleanToInt(enabled)
    );

    const rule = req.db.prepare('SELECT * FROM collection_hidden_rules WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ message: 'Hidden rule created', rule });
  } catch (error) {
    console.error('Create hidden rule error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/hidden-rules/:ruleId', [
  body('name').optional().trim().notEmpty(),
  body('page_url_pattern').optional().trim().notEmpty(),
  body('selector').optional().trim().notEmpty(),
  body('hide_method').optional().isIn(['cover', 'remove']),
  body('enabled').optional().isBoolean()
], (req, res) => {
  try {
    if (!requireAdmin(req, res) || !validateRequest(req, res)) return;

    const rule = req.db.prepare('SELECT * FROM collection_hidden_rules WHERE id = ?').get(req.params.ruleId);
    if (!rule) return res.status(404).json({ error: 'Hidden rule not found' });

    const updates = {};
    ['name', 'page_url_pattern', 'selector', 'hide_method'].forEach(key => {
      if (req.body[key] !== undefined) updates[key] = key === 'hide_method'
        ? normalizeHideMethod(req.body[key])
        : req.body[key];
    });
    if (req.body.enabled !== undefined) updates.enabled = booleanToInt(req.body.enabled);

    if (Object.keys(updates).length > 0) {
      const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
      req.db.prepare(`UPDATE collection_hidden_rules SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(...Object.values(updates), req.params.ruleId);
    }

    const updatedRule = req.db.prepare('SELECT * FROM collection_hidden_rules WHERE id = ?').get(req.params.ruleId);
    res.json({ message: 'Hidden rule updated', rule: updatedRule });
  } catch (error) {
    console.error('Update hidden rule error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/hidden-rules/:ruleId', (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const rule = req.db.prepare('SELECT * FROM collection_hidden_rules WHERE id = ?').get(req.params.ruleId);
    if (!rule) return res.status(404).json({ error: 'Hidden rule not found' });

    req.db.prepare('DELETE FROM collection_hidden_rules WHERE id = ?').run(req.params.ruleId);
    res.json({ message: 'Hidden rule deleted' });
  } catch (error) {
    console.error('Delete hidden rule error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/sites/:siteId/email-verification-rules', (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const rules = req.db.prepare(`
      SELECT * FROM collection_email_verification_rules
      WHERE site_id = ?
      ORDER BY id DESC
    `).all(req.params.siteId);

    res.json({ rules });
  } catch (error) {
    console.error('Get email verification rules error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/sites/:siteId/email-verification-rules', [
  body('name').notEmpty().trim(),
  body('page_url_pattern').notEmpty().trim(),
  body('email_input_selector').notEmpty().trim(),
  body('send_button_selector').notEmpty().trim(),
  body('code_input_selector').notEmpty().trim(),
  body('enabled').optional().isBoolean()
], (req, res) => {
  try {
    if (!requireAdmin(req, res) || !validateRequest(req, res)) return;

    const site = req.db.prepare('SELECT * FROM collection_sites WHERE id = ?').get(req.params.siteId);
    if (!site) return res.status(404).json({ error: 'Collection site not found' });

    const { name, page_url_pattern, email_input_selector, send_button_selector, code_input_selector, enabled } = req.body;
    const result = req.db.prepare(`
      INSERT INTO collection_email_verification_rules (
        site_id, name, page_url_pattern, email_input_selector, send_button_selector,
        code_input_selector, enabled
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.params.siteId,
      name,
      page_url_pattern,
      email_input_selector,
      send_button_selector,
      code_input_selector,
      booleanToInt(enabled)
    );

    const rule = req.db.prepare('SELECT * FROM collection_email_verification_rules WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ message: 'Email verification rule created', rule });
  } catch (error) {
    console.error('Create email verification rule error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/email-verification-rules/:ruleId', [
  body('name').optional().trim().notEmpty(),
  body('page_url_pattern').optional().trim().notEmpty(),
  body('email_input_selector').optional().trim().notEmpty(),
  body('send_button_selector').optional().trim().notEmpty(),
  body('code_input_selector').optional().trim().notEmpty(),
  body('enabled').optional().isBoolean()
], (req, res) => {
  try {
    if (!requireAdmin(req, res) || !validateRequest(req, res)) return;

    const rule = req.db.prepare('SELECT * FROM collection_email_verification_rules WHERE id = ?').get(req.params.ruleId);
    if (!rule) return res.status(404).json({ error: 'Email verification rule not found' });

    const updates = {};
    ['name', 'page_url_pattern', 'email_input_selector', 'send_button_selector', 'code_input_selector'].forEach(key => {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    });
    if (req.body.enabled !== undefined) updates.enabled = booleanToInt(req.body.enabled);

    if (Object.keys(updates).length > 0) {
      const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
      req.db.prepare(`UPDATE collection_email_verification_rules SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(...Object.values(updates), req.params.ruleId);
    }

    const updatedRule = req.db.prepare('SELECT * FROM collection_email_verification_rules WHERE id = ?').get(req.params.ruleId);
    res.json({ message: 'Email verification rule updated', rule: updatedRule });
  } catch (error) {
    console.error('Update email verification rule error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/email-verification-rules/:ruleId', (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const rule = req.db.prepare('SELECT * FROM collection_email_verification_rules WHERE id = ?').get(req.params.ruleId);
    if (!rule) return res.status(404).json({ error: 'Email verification rule not found' });

    req.db.prepare('DELETE FROM collection_email_verification_rules WHERE id = ?').run(req.params.ruleId);
    res.json({ message: 'Email verification rule deleted' });
  } catch (error) {
    console.error('Delete email verification rule error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/audit-logs', (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const logs = req.db.prepare(`
      SELECT upload_audit_logs.*,
        collection_sites.name as site_name,
        collection_targets.name as target_name,
        users.username as creator_name
      FROM upload_audit_logs
      LEFT JOIN collection_sites ON upload_audit_logs.site_id = collection_sites.id
      LEFT JOIN collection_targets ON upload_audit_logs.target_id = collection_targets.id
      LEFT JOIN users ON upload_audit_logs.created_by = users.id
      ORDER BY upload_audit_logs.created_at DESC
      LIMIT ?
    `).all(limit);

    res.json({ logs });
  } catch (error) {
    console.error('Get audit logs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
