function patternToRegExp(pattern) {
  const source = String(pattern || '').trim();
  if (!source) return null;

  const escaped = source
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');

  return new RegExp(`^${escaped}$`, 'i');
}

function matchesPattern(value, pattern) {
  const re = patternToRegExp(pattern);
  return !!re && re.test(String(value || ''));
}

function normalizeEnabled(value) {
  return value === true || value === 1 || value === '1';
}

function getEnabledSites(db) {
  return db.prepare(`
    SELECT id, name, url_pattern, enabled, created_at, updated_at
    FROM collection_sites
    WHERE enabled = 1
    ORDER BY id DESC
  `).all();
}

function getEnabledTargetsForSite(db, siteId) {
  return db.prepare(`
    SELECT id, site_id, name, page_url_pattern, selector, element_type, enabled, created_at, updated_at
    FROM collection_targets
    WHERE site_id = ? AND enabled = 1
    ORDER BY id DESC
  `).all(siteId);
}

function getEnabledHiddenRulesForSite(db, siteId) {
  return db.prepare(`
    SELECT id, site_id, name, page_url_pattern, selector, hide_method, enabled, created_at, updated_at
    FROM collection_hidden_rules
    WHERE site_id = ? AND enabled = 1
    ORDER BY id DESC
  `).all(siteId);
}

function getEnabledEmailVerificationRulesForSite(db, siteId) {
  return db.prepare(`
    SELECT id, site_id, name, page_url_pattern, email_input_selector, send_button_selector,
      code_input_selector, enabled, screenshot_path, created_at, updated_at
    FROM collection_email_verification_rules
    WHERE site_id = ? AND enabled = 1
    ORDER BY id DESC
  `).all(siteId);
}

function findMatchingEmailVerificationRule(db, payload) {
  const sourceUrl = payload.source_url || payload.sourceUrl || '';
  const ruleId = Number(payload.rule_id || payload.ruleId || 0);
  const siteId = Number(payload.site_id || payload.siteId || 0);

  if (!sourceUrl) return { allowed: false, reason: 'source_url is required' };
  if (!ruleId || !siteId) return { allowed: false, reason: 'site_id and rule_id are required' };

  const site = db.prepare(`
    SELECT id, name, url_pattern, enabled
    FROM collection_sites
    WHERE id = ?
  `).get(siteId);

  if (!site || !normalizeEnabled(site.enabled)) {
    return { allowed: false, reason: 'collection site is disabled or missing' };
  }
  if (!matchesPattern(sourceUrl, site.url_pattern)) {
    return { allowed: false, reason: 'source_url does not match site rule', site };
  }

  const rule = db.prepare(`
    SELECT id, site_id, name, page_url_pattern, email_input_selector, send_button_selector,
      code_input_selector, enabled
    FROM collection_email_verification_rules
    WHERE id = ? AND site_id = ?
  `).get(ruleId, siteId);

  if (!rule || !normalizeEnabled(rule.enabled)) {
    return { allowed: false, reason: 'email verification rule is disabled or missing', site };
  }
  if (!matchesPattern(sourceUrl, rule.page_url_pattern)) {
    return { allowed: false, reason: 'source_url does not match email verification rule', site, rule };
  }

  return { allowed: true, site, rule };
}

function findMatchingPolicy(db, payload) {
  const sourceUrl = payload.source_url || payload.sourceUrl || '';
  const targetId = Number(payload.target_id || payload.targetId || 0);
  const siteId = Number(payload.site_id || payload.siteId || 0);
  const matchedSelector = payload.matched_selector || payload.matchedSelector || '';

  if (!sourceUrl) {
    return { allowed: false, reason: 'source_url is required' };
  }
  if (!targetId || !siteId) {
    return { allowed: false, reason: 'site_id and target_id are required' };
  }
  if (!matchedSelector) {
    return { allowed: false, reason: 'matched_selector is required' };
  }

  const site = db.prepare(`
    SELECT id, name, url_pattern, enabled
    FROM collection_sites
    WHERE id = ?
  `).get(siteId);

  if (!site || !normalizeEnabled(site.enabled)) {
    return { allowed: false, reason: 'collection site is disabled or missing' };
  }
  if (!matchesPattern(sourceUrl, site.url_pattern)) {
    return { allowed: false, reason: 'source_url does not match site rule', site };
  }

  const target = db.prepare(`
    SELECT id, site_id, name, page_url_pattern, selector, element_type, enabled
    FROM collection_targets
    WHERE id = ? AND site_id = ?
  `).get(targetId, siteId);

  if (!target || !normalizeEnabled(target.enabled)) {
    return { allowed: false, reason: 'collection target is disabled or missing', site };
  }
  if (!matchesPattern(sourceUrl, target.page_url_pattern)) {
    return { allowed: false, reason: 'source_url does not match target page rule', site, target };
  }
  if (String(target.selector).trim() !== String(matchedSelector).trim()) {
    return { allowed: false, reason: 'matched_selector does not match target rule', site, target };
  }

  const elementType = payload.element_type || payload.elementType || 'any';
  if (target.element_type !== 'any' && elementType !== target.element_type) {
    return { allowed: false, reason: 'element_type does not match target rule', site, target };
  }

  return { allowed: true, site, target };
}

function writeUploadAudit(db, payload) {
  db.prepare(`
    INSERT INTO upload_audit_logs (
      source_url, content, site_id, target_id, decision, reason, created_by,
      client_authorization_id, leader_authorization_id, uploaded_by_authorization_id, upload_mode
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    payload.source_url || null,
    payload.content || null,
    payload.site_id || null,
    payload.target_id || null,
    payload.decision,
    payload.reason || null,
    payload.created_by || null,
    payload.client_authorization_id || null,
    payload.leader_authorization_id || null,
    payload.uploaded_by_authorization_id || null,
    payload.upload_mode || 'manual'
  );
}

module.exports = {
  findMatchingEmailVerificationRule,
  findMatchingPolicy,
  getEnabledEmailVerificationRulesForSite,
  getEnabledHiddenRulesForSite,
  getEnabledSites,
  getEnabledTargetsForSite,
  matchesPattern,
  writeUploadAudit
};
