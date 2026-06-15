const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const {
  assertNoDefaultAdminPassword,
  getInitialAdminCredentials
} = require('./securityConfig');

const dbPath = path.join(__dirname, '../../data/qrcodes.db');
const dataDir = path.dirname(dbPath);

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let db = null;

const dbWrapperSync = {
  prepare: (sql) => ({
    run: (...params) => {
      if (!db) throw new Error('Database not initialized');
      try {
        db.run(sql, params);
        const lastInsertRowid = getLastInsertRowid(sql);
        saveDb();
        return { lastInsertRowid };
      } catch (error) {
        console.error('SQL Error:', error);
        throw error;
      }
    },
    get: (...params) => {
      if (!db) throw new Error('Database not initialized');
      try {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        if (stmt.step()) {
          const row = stmt.getAsObject();
          stmt.free();
          return row;
        }
        stmt.free();
        return undefined;
      } catch (error) {
        console.error('SQL Error:', error);
        throw error;
      }
    },
    all: (...params) => {
      if (!db) throw new Error('Database not initialized');
      try {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        const results = [];
        while (stmt.step()) {
          results.push(stmt.getAsObject());
        }
        stmt.free();
        return results;
      } catch (error) {
        console.error('SQL Error:', error);
        throw error;
      }
    }
  }),
  exec: (sql) => {
    if (!db) throw new Error('Database not initialized');
    try {
      db.run(sql);
      saveDb();
    } catch (error) {
      console.error('SQL Error:', error);
      throw error;
    }
  }
};

function getLastInsertRowid(sql) {
  const rowidResult = db.exec('SELECT last_insert_rowid()');
  const rowid = rowidResult[0]?.values?.[0]?.[0] || 0;
  if (rowid) return rowid;

  const tableMatch = String(sql).match(/insert\s+into\s+["`[]?([a-zA-Z_][\w]*)/i);
  if (!tableMatch) return 0;

  try {
    const maxResult = db.exec(`SELECT MAX(rowid) FROM ${tableMatch[1]}`);
    return maxResult[0]?.values?.[0]?.[0] || 0;
  } catch {
    return 0;
  }
}

function saveDb() {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  } catch (error) {
    console.error('Failed to save database:', error);
  }
}

function columnExists(tableName, columnName) {
  const columns = dbWrapperSync.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.some(column => column.name === columnName);
}

function addColumnIfMissing(tableName, columnName, definition) {
  if (!columnExists(tableName, columnName)) {
    dbWrapperSync.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

async function initDb() {
  try {
    const SQL = await initSqlJs();
    
    if (fs.existsSync(dbPath)) {
      const fileBuffer = fs.readFileSync(dbPath);
      db = new SQL.Database(fileBuffer);
      console.log('Database loaded from file');
    } else {
      db = new SQL.Database();
      console.log('New database created');
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        email TEXT,
        role TEXT DEFAULT 'user',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS qrcodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        image_path TEXT,
        source_url TEXT,
        source_page_title TEXT,
        width INTEGER,
        height INTEGER,
        format TEXT,
        created_by INTEGER,
        client_authorization_id INTEGER,
        leader_authorization_id INTEGER,
        uploaded_by_authorization_id INTEGER,
        upload_mode TEXT DEFAULT 'manual',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS collection_sites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        url_pattern TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS collection_targets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        page_url_pattern TEXT NOT NULL,
        selector TEXT NOT NULL,
        element_type TEXT DEFAULT 'any',
        enabled INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (site_id) REFERENCES collection_sites(id)
      );

      CREATE TABLE IF NOT EXISTS collection_hidden_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        page_url_pattern TEXT NOT NULL,
        selector TEXT NOT NULL,
        hide_method TEXT DEFAULT 'cover',
        enabled INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (site_id) REFERENCES collection_sites(id)
      );

      CREATE TABLE IF NOT EXISTS collection_email_verification_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        page_url_pattern TEXT NOT NULL,
        email_input_selector TEXT NOT NULL,
        send_button_selector TEXT NOT NULL,
        code_input_selector TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        screenshot_path TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (site_id) REFERENCES collection_sites(id)
      );

      CREATE TABLE IF NOT EXISTS upload_audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_url TEXT,
        content TEXT,
        site_id INTEGER,
        target_id INTEGER,
        decision TEXT NOT NULL,
        reason TEXT,
        created_by INTEGER,
        client_authorization_id INTEGER,
        leader_authorization_id INTEGER,
        uploaded_by_authorization_id INTEGER,
        upload_mode TEXT DEFAULT 'manual',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (site_id) REFERENCES collection_sites(id),
        FOREIGN KEY (target_id) REFERENCES collection_targets(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS collection_rule_drafts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_url TEXT NOT NULL,
        url_pattern TEXT NOT NULL,
        selector TEXT NOT NULL,
        element_type TEXT DEFAULT 'any',
        suggested_site_name TEXT,
        suggested_target_name TEXT,
        element_tag TEXT,
        element_text TEXT,
        element_rect TEXT,
        screenshot_path TEXT,
        draft_type TEXT DEFAULT 'qrcode_target',
        hide_method TEXT DEFAULT 'cover',
        email_input_selector TEXT,
        send_button_selector TEXT,
        code_input_selector TEXT,
        email_rule_id INTEGER,
        status TEXT DEFAULT 'pending',
        site_id INTEGER,
        target_id INTEGER,
        hide_rule_id INTEGER,
        created_by INTEGER,
        reviewed_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        reviewed_at DATETIME,
        FOREIGN KEY (site_id) REFERENCES collection_sites(id),
        FOREIGN KEY (target_id) REFERENCES collection_targets(id),
        FOREIGN KEY (hide_rule_id) REFERENCES collection_hidden_rules(id),
        FOREIGN KEY (email_rule_id) REFERENCES collection_email_verification_rules(id),
        FOREIGN KEY (created_by) REFERENCES users(id),
        FOREIGN KEY (reviewed_by) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS client_ip_authorizations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip_address TEXT UNIQUE NOT NULL,
        role TEXT DEFAULT 'user',
        status TEXT DEFAULT 'pending',
        note TEXT,
        first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        user_agent TEXT,
        extension_version TEXT,
        qrcode_enabled INTEGER DEFAULT 1,
        email_enabled INTEGER DEFAULT 1,
        leader_authorization_id INTEGER,
        leader_assigned_at DATETIME,
        leader_assigned_by_authorization_id INTEGER,
        leader_assignment_source TEXT,
        created_by INTEGER,
        updated_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id),
        FOREIGN KEY (updated_by) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS leader_assignment_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_authorization_id INTEGER NOT NULL,
        leader_authorization_id INTEGER NOT NULL,
        status TEXT DEFAULT 'pending',
        requested_by_authorization_id INTEGER,
        reviewed_by_authorization_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        reviewed_at DATETIME,
        FOREIGN KEY (user_authorization_id) REFERENCES client_ip_authorizations(id),
        FOREIGN KEY (leader_authorization_id) REFERENCES client_ip_authorizations(id),
        FOREIGN KEY (requested_by_authorization_id) REFERENCES client_ip_authorizations(id),
        FOREIGN KEY (reviewed_by_authorization_id) REFERENCES client_ip_authorizations(id)
      );

      CREATE TABLE IF NOT EXISTS email_pool_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email_address TEXT UNIQUE NOT NULL,
        provider TEXT DEFAULT 'custom',
        protocol TEXT DEFAULT 'imap',
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        secure INTEGER DEFAULT 1,
        username TEXT NOT NULL,
        auth_secret TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        last_test_status TEXT,
        last_test_message TEXT,
        last_test_at DATETIME,
        last_sync_uid INTEGER DEFAULT 0,
        last_sync_status TEXT,
        last_sync_message TEXT,
        last_sync_at DATETIME,
        note TEXT,
        created_by INTEGER,
        updated_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id),
        FOREIGN KEY (updated_by) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS email_verification_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email_account_id INTEGER NOT NULL,
        monitor_rule_id INTEGER,
        imap_uid INTEGER NOT NULL,
        message_id TEXT,
        sender TEXT,
        recipient TEXT,
        subject TEXT,
        verification_code TEXT,
        parse_status TEXT DEFAULT 'unmatched',
        text_preview TEXT,
        received_at DATETIME,
        captured_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (email_account_id) REFERENCES email_pool_accounts(id),
        FOREIGN KEY (monitor_rule_id) REFERENCES email_monitor_rules(id)
      );

      CREATE TABLE IF NOT EXISTS email_monitor_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        sender_pattern TEXT NOT NULL,
        subject_pattern TEXT,
        extraction_pattern TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        created_by INTEGER,
        updated_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id),
        FOREIGN KEY (updated_by) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS email_account_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_authorization_id INTEGER NOT NULL,
        email_account_id INTEGER NOT NULL,
        leader_authorization_id INTEGER,
        status TEXT DEFAULT 'active',
        assignment_source TEXT NOT NULL,
        assigned_by_user_id INTEGER,
        assigned_by_authorization_id INTEGER,
        assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        released_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_authorization_id) REFERENCES client_ip_authorizations(id),
        FOREIGN KEY (email_account_id) REFERENCES email_pool_accounts(id),
        FOREIGN KEY (leader_authorization_id) REFERENCES client_ip_authorizations(id),
        FOREIGN KEY (assigned_by_user_id) REFERENCES users(id),
        FOREIGN KEY (assigned_by_authorization_id) REFERENCES client_ip_authorizations(id)
      );

      CREATE TABLE IF NOT EXISTS email_verification_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_authorization_id INTEGER NOT NULL,
        email_account_id INTEGER NOT NULL,
        site_id INTEGER NOT NULL,
        rule_id INTEGER NOT NULL,
        source_url TEXT NOT NULL,
        email_address TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        verification_code TEXT,
        message_id INTEGER,
        error_message TEXT,
        requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL,
        completed_at DATETIME,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_authorization_id) REFERENCES client_ip_authorizations(id),
        FOREIGN KEY (email_account_id) REFERENCES email_pool_accounts(id),
        FOREIGN KEY (site_id) REFERENCES collection_sites(id),
        FOREIGN KEY (rule_id) REFERENCES collection_email_verification_rules(id),
        FOREIGN KEY (message_id) REFERENCES email_verification_messages(id)
      );
    `);

    addColumnIfMissing('qrcodes', 'site_id', 'INTEGER');
    addColumnIfMissing('qrcodes', 'target_id', 'INTEGER');
    addColumnIfMissing('qrcodes', 'matched_selector', 'TEXT');
    addColumnIfMissing('qrcodes', 'client_metadata', 'TEXT');
    addColumnIfMissing('qrcodes', 'client_authorization_id', 'INTEGER');
    addColumnIfMissing('qrcodes', 'leader_authorization_id', 'INTEGER');
    addColumnIfMissing('qrcodes', 'uploaded_by_authorization_id', 'INTEGER');
    addColumnIfMissing('qrcodes', 'upload_mode', "TEXT DEFAULT 'manual'");
    addColumnIfMissing('upload_audit_logs', 'client_authorization_id', 'INTEGER');
    addColumnIfMissing('upload_audit_logs', 'leader_authorization_id', 'INTEGER');
    addColumnIfMissing('upload_audit_logs', 'uploaded_by_authorization_id', 'INTEGER');
    addColumnIfMissing('upload_audit_logs', 'upload_mode', "TEXT DEFAULT 'manual'");
    addColumnIfMissing('client_ip_authorizations', 'leader_authorization_id', 'INTEGER');
    addColumnIfMissing('client_ip_authorizations', 'leader_assigned_at', 'DATETIME');
    addColumnIfMissing('client_ip_authorizations', 'leader_assigned_by_authorization_id', 'INTEGER');
    addColumnIfMissing('client_ip_authorizations', 'leader_assignment_source', 'TEXT');
    addColumnIfMissing('client_ip_authorizations', 'qrcode_enabled', 'INTEGER DEFAULT 1');
    addColumnIfMissing('client_ip_authorizations', 'email_enabled', 'INTEGER DEFAULT 1');
    addColumnIfMissing('collection_rule_drafts', 'draft_type', "TEXT DEFAULT 'qrcode_target'");
    addColumnIfMissing('collection_rule_drafts', 'hide_method', "TEXT DEFAULT 'cover'");
    addColumnIfMissing('collection_rule_drafts', 'hide_rule_id', 'INTEGER');
    addColumnIfMissing('collection_rule_drafts', 'email_input_selector', 'TEXT');
    addColumnIfMissing('collection_rule_drafts', 'send_button_selector', 'TEXT');
    addColumnIfMissing('collection_rule_drafts', 'code_input_selector', 'TEXT');
    addColumnIfMissing('collection_rule_drafts', 'email_rule_id', 'INTEGER');
    addColumnIfMissing('email_pool_accounts', 'provider', "TEXT DEFAULT 'custom'");
    addColumnIfMissing('email_pool_accounts', 'last_test_status', 'TEXT');
    addColumnIfMissing('email_pool_accounts', 'last_test_message', 'TEXT');
    addColumnIfMissing('email_pool_accounts', 'last_test_at', 'DATETIME');
    addColumnIfMissing('email_pool_accounts', 'note', 'TEXT');
    addColumnIfMissing('email_pool_accounts', 'updated_by', 'INTEGER');
    addColumnIfMissing('email_pool_accounts', 'last_sync_uid', 'INTEGER DEFAULT 0');
    addColumnIfMissing('email_pool_accounts', 'last_sync_status', 'TEXT');
    addColumnIfMissing('email_pool_accounts', 'last_sync_message', 'TEXT');
    addColumnIfMissing('email_pool_accounts', 'last_sync_at', 'DATETIME');
    addColumnIfMissing('email_verification_messages', 'monitor_rule_id', 'INTEGER');

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_qrcodes_created_at ON qrcodes(created_at);
      CREATE INDEX IF NOT EXISTS idx_qrcodes_source_url ON qrcodes(source_url);
      CREATE INDEX IF NOT EXISTS idx_qrcodes_client_authorization ON qrcodes(client_authorization_id);
      CREATE INDEX IF NOT EXISTS idx_qrcodes_leader_authorization ON qrcodes(leader_authorization_id);
      CREATE INDEX IF NOT EXISTS idx_qrcodes_uploaded_by_authorization ON qrcodes(uploaded_by_authorization_id);
      CREATE INDEX IF NOT EXISTS idx_qrcodes_latest_target ON qrcodes(client_authorization_id, site_id, target_id, matched_selector);
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
      CREATE INDEX IF NOT EXISTS idx_collection_sites_enabled ON collection_sites(enabled);
      CREATE INDEX IF NOT EXISTS idx_collection_targets_site_id ON collection_targets(site_id);
      CREATE INDEX IF NOT EXISTS idx_collection_hidden_rules_site_id ON collection_hidden_rules(site_id);
      CREATE INDEX IF NOT EXISTS idx_collection_hidden_rules_enabled ON collection_hidden_rules(enabled);
      CREATE INDEX IF NOT EXISTS idx_collection_email_rules_site_id ON collection_email_verification_rules(site_id);
      CREATE INDEX IF NOT EXISTS idx_collection_email_rules_enabled ON collection_email_verification_rules(enabled);
      CREATE INDEX IF NOT EXISTS idx_upload_audit_logs_created_at ON upload_audit_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_upload_audit_logs_client_authorization ON upload_audit_logs(client_authorization_id);
      CREATE INDEX IF NOT EXISTS idx_upload_audit_logs_leader_authorization ON upload_audit_logs(leader_authorization_id);
      CREATE INDEX IF NOT EXISTS idx_collection_rule_drafts_status ON collection_rule_drafts(status);
      CREATE INDEX IF NOT EXISTS idx_collection_rule_drafts_type ON collection_rule_drafts(draft_type);
      CREATE INDEX IF NOT EXISTS idx_collection_rule_drafts_created_at ON collection_rule_drafts(created_at);
      CREATE INDEX IF NOT EXISTS idx_client_ip_authorizations_ip ON client_ip_authorizations(ip_address);
      CREATE INDEX IF NOT EXISTS idx_client_ip_authorizations_status ON client_ip_authorizations(status);
      CREATE INDEX IF NOT EXISTS idx_client_ip_authorizations_leader ON client_ip_authorizations(leader_authorization_id);
      CREATE INDEX IF NOT EXISTS idx_client_ip_authorizations_last_seen ON client_ip_authorizations(last_seen_at);
      CREATE INDEX IF NOT EXISTS idx_leader_assignment_requests_user ON leader_assignment_requests(user_authorization_id);
      CREATE INDEX IF NOT EXISTS idx_leader_assignment_requests_leader ON leader_assignment_requests(leader_authorization_id);
      CREATE INDEX IF NOT EXISTS idx_leader_assignment_requests_status ON leader_assignment_requests(status);
      CREATE INDEX IF NOT EXISTS idx_email_pool_accounts_email ON email_pool_accounts(email_address);
      CREATE INDEX IF NOT EXISTS idx_email_pool_accounts_enabled ON email_pool_accounts(enabled);
      CREATE INDEX IF NOT EXISTS idx_email_pool_accounts_provider ON email_pool_accounts(provider);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_email_verification_account_uid ON email_verification_messages(email_account_id, imap_uid);
      CREATE INDEX IF NOT EXISTS idx_email_verification_received_at ON email_verification_messages(received_at);
      CREATE INDEX IF NOT EXISTS idx_email_verification_code ON email_verification_messages(verification_code);
      CREATE INDEX IF NOT EXISTS idx_email_verification_status ON email_verification_messages(parse_status);
      CREATE INDEX IF NOT EXISTS idx_email_verification_rule ON email_verification_messages(monitor_rule_id);
      CREATE INDEX IF NOT EXISTS idx_email_monitor_rules_enabled ON email_monitor_rules(enabled);
      CREATE INDEX IF NOT EXISTS idx_email_monitor_rules_sender ON email_monitor_rules(sender_pattern);
      CREATE INDEX IF NOT EXISTS idx_email_assignments_user ON email_account_assignments(user_authorization_id);
      CREATE INDEX IF NOT EXISTS idx_email_assignments_account ON email_account_assignments(email_account_id);
      CREATE INDEX IF NOT EXISTS idx_email_assignments_leader ON email_account_assignments(leader_authorization_id);
      CREATE INDEX IF NOT EXISTS idx_email_assignments_status ON email_account_assignments(status);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_email_assignments_active_user
        ON email_account_assignments(user_authorization_id) WHERE status = 'active';
      CREATE UNIQUE INDEX IF NOT EXISTS idx_email_assignments_active_account
        ON email_account_assignments(email_account_id) WHERE status = 'active';
      CREATE INDEX IF NOT EXISTS idx_email_verification_tasks_user ON email_verification_tasks(user_authorization_id);
      CREATE INDEX IF NOT EXISTS idx_email_verification_tasks_status ON email_verification_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_email_verification_tasks_expires ON email_verification_tasks(expires_at);
    `);

    const adminExists = dbWrapperSync.prepare('SELECT id FROM users WHERE role = ? LIMIT 1').get('admin');
    if (!adminExists) {
      const initialAdmin = getInitialAdminCredentials();
      const hashedPassword = bcrypt.hashSync(initialAdmin.password, 10);
      dbWrapperSync.prepare('INSERT INTO users (username, password, email, role) VALUES (?, ?, ?, ?)').run(
        initialAdmin.username,
        hashedPassword,
        initialAdmin.email,
        'admin'
      );
      console.log(`Initial admin user created: ${initialAdmin.username}`);
    } else {
      console.log('Admin user already exists');
    }
    assertNoDefaultAdminPassword(dbWrapperSync);

    const monitorRuleExists = dbWrapperSync.prepare('SELECT id FROM email_monitor_rules LIMIT 1').get();
    if (!monitorRuleExists) {
      const admin = dbWrapperSync.prepare('SELECT id FROM users WHERE username = ?').get('admin');
      dbWrapperSync.prepare(`
        INSERT INTO email_monitor_rules (
          name, sender_pattern, subject_pattern, extraction_pattern, enabled, created_by, updated_by
        ) VALUES (?, ?, ?, ?, 1, ?, ?)
      `).run(
        'TLabel 邮箱验证码',
        'tlabel@tencent.com',
        '*验证码*',
        '验证码(?:为|是)?[：:\\s]*((?:\\d[\\s-]?){4,8})',
        admin?.id || null,
        admin?.id || null
      );
    }

    saveDb();
    console.log('Database initialized successfully');
    return dbWrapperSync;
  } catch (error) {
    console.error('Failed to initialize database:', error);
    throw error;
  }
}

module.exports = initDb;
module.exports.default = initDb;
