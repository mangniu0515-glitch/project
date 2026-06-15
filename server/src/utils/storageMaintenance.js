const fs = require('fs');
const path = require('path');

const DEFAULT_SERVER_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_UPLOADS_DIR = path.join(DEFAULT_SERVER_ROOT, 'uploads');
const DEFAULT_DB_PATH = path.join(DEFAULT_SERVER_ROOT, 'data', 'qrcodes.db');

const DEFAULT_RETENTION = {
  auditLogRetentionDays: 90,
  emailMessageRetentionDays: 30,
  emailTaskRetentionDays: 7,
  draftRetentionDays: 30
};

function clampDays(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.min(3650, Math.floor(number)));
}

function getFileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function walkFiles(rootDir) {
  if (!fs.existsSync(rootDir)) return [];

  const files = [];
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(absolutePath));
    } else if (entry.isFile()) {
      const stat = fs.statSync(absolutePath);
      files.push({
        absolutePath,
        size: stat.size,
        mtime: stat.mtime
      });
    }
  }
  return files;
}

function normalizePublicUploadPath(absolutePath, uploadsDir = DEFAULT_UPLOADS_DIR) {
  const resolvedUploadsDir = path.resolve(uploadsDir);
  const resolvedPath = path.resolve(absolutePath);
  const relative = path.relative(resolvedUploadsDir, resolvedPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return `/uploads/${relative.replace(/\\/g, '/')}`;
}

function resolveManagedUploadPath(filePath, options = {}) {
  const serverRoot = path.resolve(options.serverRoot || DEFAULT_SERVER_ROOT);
  const uploadsDir = path.resolve(options.uploadsDir || path.join(serverRoot, 'uploads'));
  const value = String(filePath || '').trim();
  if (!value || value.includes('\0')) return null;

  const normalizedInput = value.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalizedInput.startsWith('uploads/')) return null;

  const relativePath = normalizedInput.slice('uploads/'.length);
  if (!relativePath) return null;

  const resolvedPath = path.resolve(uploadsDir, relativePath);
  if (resolvedPath === uploadsDir || !resolvedPath.startsWith(`${uploadsDir}${path.sep}`)) {
    return null;
  }
  return resolvedPath;
}

function rowsForUploadReferences(db, sql) {
  try {
    return db.prepare(sql).all();
  } catch {
    return [];
  }
}

function getReferencedUploadPaths(db, options = {}) {
  const serverRoot = path.resolve(options.serverRoot || DEFAULT_SERVER_ROOT);
  const uploadsDir = path.resolve(options.uploadsDir || path.join(serverRoot, 'uploads'));
  const queries = [
    'SELECT image_path AS file_path FROM qrcodes WHERE image_path IS NOT NULL AND image_path != ""',
    'SELECT screenshot_path AS file_path FROM collection_rule_drafts WHERE screenshot_path IS NOT NULL AND screenshot_path != ""',
    'SELECT screenshot_path AS file_path FROM collection_email_verification_rules WHERE screenshot_path IS NOT NULL AND screenshot_path != ""'
  ];

  const absolutePaths = new Set();
  const publicPaths = new Set();

  for (const query of queries) {
    const rows = rowsForUploadReferences(db, query);
    for (const row of rows) {
      const absolutePath = resolveManagedUploadPath(row.file_path, { serverRoot, uploadsDir });
      if (!absolutePath) continue;
      absolutePaths.add(path.resolve(absolutePath));
      const publicPath = normalizePublicUploadPath(absolutePath, uploadsDir);
      if (publicPath) publicPaths.add(publicPath);
    }
  }

  return { absolutePaths, publicPaths };
}

function buildUploadInventory(db, options = {}) {
  const serverRoot = path.resolve(options.serverRoot || DEFAULT_SERVER_ROOT);
  const uploadsDir = path.resolve(options.uploadsDir || path.join(serverRoot, 'uploads'));
  const references = getReferencedUploadPaths(db, { serverRoot, uploadsDir });
  const files = walkFiles(uploadsDir)
    .map(file => ({
      ...file,
      publicPath: normalizePublicUploadPath(file.absolutePath, uploadsDir)
    }))
    .filter(file => file.publicPath);

  const orphanFiles = files
    .filter(file => !references.absolutePaths.has(path.resolve(file.absolutePath)))
    .sort((a, b) => a.publicPath.localeCompare(b.publicPath));

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const orphanBytes = orphanFiles.reduce((sum, file) => sum + file.size, 0);

  return {
    uploadsDir,
    fileCount: files.length,
    totalBytes,
    referencedCount: references.absolutePaths.size,
    referencedPublicPaths: Array.from(references.publicPaths).sort(),
    orphanCount: orphanFiles.length,
    orphanBytes,
    orphanFiles
  };
}

function scalar(db, sql, params = [], fallback = 0) {
  try {
    const row = db.prepare(sql).get(...params);
    if (!row) return fallback;
    const value = Object.values(row)[0];
    return value === undefined || value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

function countRows(db, tableName) {
  return Number(scalar(db, `SELECT COUNT(*) AS count FROM ${tableName}`));
}

function groupCounts(db, sql) {
  try {
    return db.prepare(sql).all().reduce((acc, row) => {
      const key = row.key || row.status || row.upload_mode || 'unknown';
      acc[key] = Number(row.count || 0);
      return acc;
    }, {});
  } catch {
    return {};
  }
}

function buildCutoff(days) {
  return `datetime('now', '-${days} days')`;
}

function countCleanupCandidates(db, retention) {
  return {
    auditLogs: Number(scalar(db, `
      SELECT COUNT(*) AS count FROM upload_audit_logs
      WHERE created_at < ${buildCutoff(retention.auditLogRetentionDays)}
    `)),
    emailMessages: Number(scalar(db, `
      SELECT COUNT(*) AS count FROM email_verification_messages
      WHERE COALESCE(captured_at, received_at) < ${buildCutoff(retention.emailMessageRetentionDays)}
    `)),
    emailTasks: Number(scalar(db, `
      SELECT COUNT(*) AS count FROM email_verification_tasks
      WHERE requested_at < ${buildCutoff(retention.emailTaskRetentionDays)}
        AND status IN ('matched', 'expired', 'failed', 'completed')
    `)),
    drafts: Number(scalar(db, `
      SELECT COUNT(*) AS count FROM collection_rule_drafts
      WHERE status != 'pending'
        AND created_at < ${buildCutoff(retention.draftRetentionDays)}
    `))
  };
}

function getStorageOverview(db, options = {}) {
  const serverRoot = path.resolve(options.serverRoot || DEFAULT_SERVER_ROOT);
  const dbPath = path.resolve(options.dbPath || DEFAULT_DB_PATH);
  const uploadsDir = path.resolve(options.uploadsDir || path.join(serverRoot, 'uploads'));
  const retention = {
    auditLogRetentionDays: clampDays(options.auditLogRetentionDays, DEFAULT_RETENTION.auditLogRetentionDays),
    emailMessageRetentionDays: clampDays(options.emailMessageRetentionDays, DEFAULT_RETENTION.emailMessageRetentionDays),
    emailTaskRetentionDays: clampDays(options.emailTaskRetentionDays, DEFAULT_RETENTION.emailTaskRetentionDays),
    draftRetentionDays: clampDays(options.draftRetentionDays, DEFAULT_RETENTION.draftRetentionDays)
  };
  const uploadInventory = buildUploadInventory(db, { serverRoot, uploadsDir });
  const dbBytes = getFileSize(dbPath);
  const warnings = [];

  if (dbBytes > 200 * 1024 * 1024) warnings.push('数据库文件已超过 200 MB，建议清理历史审计和验证码消息后压缩数据库。');
  if (uploadInventory.totalBytes > 1024 * 1024 * 1024) warnings.push('上传截图目录已超过 1 GB，建议检查孤儿文件和历史二维码截图。');
  if (uploadInventory.orphanCount > 0) warnings.push(`检测到 ${uploadInventory.orphanCount} 个孤儿上传文件，可在确认后清理。`);

  return {
    generated_at: new Date().toISOString(),
    database: {
      path: dbPath,
      bytes: dbBytes
    },
    uploads: {
      path: uploadsDir,
      bytes: uploadInventory.totalBytes,
      file_count: uploadInventory.fileCount,
      referenced_count: uploadInventory.referencedCount,
      orphan_count: uploadInventory.orphanCount,
      orphan_bytes: uploadInventory.orphanBytes,
      orphan_samples: uploadInventory.orphanFiles.slice(0, 20).map(file => ({
        path: file.publicPath,
        bytes: file.size,
        modified_at: file.mtime.toISOString()
      }))
    },
    records: {
      qrcodes: countRows(db, 'qrcodes'),
      upload_audit_logs: countRows(db, 'upload_audit_logs'),
      email_messages: countRows(db, 'email_verification_messages'),
      email_tasks: countRows(db, 'email_verification_tasks'),
      collection_drafts: countRows(db, 'collection_rule_drafts'),
      email_accounts: countRows(db, 'email_pool_accounts'),
      client_authorizations: countRows(db, 'client_ip_authorizations')
    },
    breakdowns: {
      qrcodes_by_upload_mode: groupCounts(db, `
        SELECT COALESCE(upload_mode, 'manual') AS key, COUNT(*) AS count
        FROM qrcodes
        GROUP BY COALESCE(upload_mode, 'manual')
      `),
      email_tasks_by_status: groupCounts(db, `
        SELECT COALESCE(status, 'unknown') AS key, COUNT(*) AS count
        FROM email_verification_tasks
        GROUP BY COALESCE(status, 'unknown')
      `),
      drafts_by_status: groupCounts(db, `
        SELECT COALESCE(status, 'unknown') AS key, COUNT(*) AS count
        FROM collection_rule_drafts
        GROUP BY COALESCE(status, 'unknown')
      `)
    },
    retention,
    cleanup_candidates: countCleanupCandidates(db, retention),
    warnings
  };
}

function deleteManagedFile(filePath, options = {}) {
  const resolvedPath = resolveManagedUploadPath(filePath, options);
  if (!resolvedPath || !fs.existsSync(resolvedPath)) return { deleted: false, bytes: 0 };
  const bytes = getFileSize(resolvedPath);
  fs.unlinkSync(resolvedPath);
  return { deleted: true, bytes };
}

function deleteRows(db, countSql, deleteSql) {
  const count = Number(scalar(db, countSql));
  if (count > 0) {
    db.prepare(deleteSql).run();
  }
  return count;
}

function collectDraftScreenshots(db, retention) {
  try {
    return db.prepare(`
      SELECT screenshot_path
      FROM collection_rule_drafts
      WHERE status != 'pending'
        AND created_at < ${buildCutoff(retention.draftRetentionDays)}
        AND screenshot_path IS NOT NULL
        AND screenshot_path != ''
    `).all().map(row => row.screenshot_path).filter(Boolean);
  } catch {
    return [];
  }
}

function runStorageCleanup(db, options = {}) {
  const serverRoot = path.resolve(options.serverRoot || DEFAULT_SERVER_ROOT);
  const uploadsDir = path.resolve(options.uploadsDir || path.join(serverRoot, 'uploads'));
  const dbPath = path.resolve(options.dbPath || DEFAULT_DB_PATH);
  const retention = {
    auditLogRetentionDays: clampDays(options.auditLogRetentionDays, DEFAULT_RETENTION.auditLogRetentionDays),
    emailMessageRetentionDays: clampDays(options.emailMessageRetentionDays, DEFAULT_RETENTION.emailMessageRetentionDays),
    emailTaskRetentionDays: clampDays(options.emailTaskRetentionDays, DEFAULT_RETENTION.emailTaskRetentionDays),
    draftRetentionDays: clampDays(options.draftRetentionDays, DEFAULT_RETENTION.draftRetentionDays)
  };
  const before = getStorageOverview(db, { serverRoot, uploadsDir, dbPath, ...retention });
  const deleted = {
    audit_logs: 0,
    email_messages: 0,
    email_tasks: 0,
    drafts: 0,
    draft_screenshot_files: 0,
    orphan_upload_files: 0,
    upload_bytes: 0
  };
  const flags = {
    cleanupAuditLogs: options.cleanupAuditLogs !== false,
    cleanupEmailMessages: options.cleanupEmailMessages !== false,
    cleanupEmailTasks: options.cleanupEmailTasks !== false,
    cleanupDrafts: options.cleanupDrafts !== false,
    deleteOrphanUploads: options.deleteOrphanUploads === true,
    compactDatabase: options.compactDatabase !== false
  };

  if (flags.cleanupEmailTasks) {
    deleted.email_tasks = deleteRows(
      db,
      `SELECT COUNT(*) AS count FROM email_verification_tasks
       WHERE requested_at < ${buildCutoff(retention.emailTaskRetentionDays)}
         AND status IN ('matched', 'expired', 'failed', 'completed')`,
      `DELETE FROM email_verification_tasks
       WHERE requested_at < ${buildCutoff(retention.emailTaskRetentionDays)}
         AND status IN ('matched', 'expired', 'failed', 'completed')`
    );
  }

  if (flags.cleanupEmailMessages) {
    deleted.email_messages = deleteRows(
      db,
      `SELECT COUNT(*) AS count FROM email_verification_messages
       WHERE COALESCE(captured_at, received_at) < ${buildCutoff(retention.emailMessageRetentionDays)}`,
      `DELETE FROM email_verification_messages
       WHERE COALESCE(captured_at, received_at) < ${buildCutoff(retention.emailMessageRetentionDays)}`
    );
  }

  if (flags.cleanupAuditLogs) {
    deleted.audit_logs = deleteRows(
      db,
      `SELECT COUNT(*) AS count FROM upload_audit_logs
       WHERE created_at < ${buildCutoff(retention.auditLogRetentionDays)}`,
      `DELETE FROM upload_audit_logs
       WHERE created_at < ${buildCutoff(retention.auditLogRetentionDays)}`
    );
  }

  if (flags.cleanupDrafts) {
    const draftScreenshots = collectDraftScreenshots(db, retention);
    deleted.drafts = deleteRows(
      db,
      `SELECT COUNT(*) AS count FROM collection_rule_drafts
       WHERE status != 'pending'
         AND created_at < ${buildCutoff(retention.draftRetentionDays)}`,
      `DELETE FROM collection_rule_drafts
       WHERE status != 'pending'
         AND created_at < ${buildCutoff(retention.draftRetentionDays)}`
    );

    const referencesAfterDraftCleanup = getReferencedUploadPaths(db, { serverRoot, uploadsDir });
    for (const screenshotPath of draftScreenshots) {
      const resolvedPath = resolveManagedUploadPath(screenshotPath, { serverRoot, uploadsDir });
      if (!resolvedPath || referencesAfterDraftCleanup.absolutePaths.has(path.resolve(resolvedPath))) continue;
      const result = deleteManagedFile(screenshotPath, { serverRoot, uploadsDir });
      if (result.deleted) {
        deleted.draft_screenshot_files += 1;
        deleted.upload_bytes += result.bytes;
      }
    }
  }

  if (flags.deleteOrphanUploads) {
    const inventory = buildUploadInventory(db, { serverRoot, uploadsDir });
    for (const file of inventory.orphanFiles) {
      const result = deleteManagedFile(file.publicPath, { serverRoot, uploadsDir });
      if (result.deleted) {
        deleted.orphan_upload_files += 1;
        deleted.upload_bytes += result.bytes;
      }
    }
  }

  const deletedRows = deleted.audit_logs + deleted.email_messages + deleted.email_tasks + deleted.drafts;
  if (deletedRows > 0 && flags.compactDatabase) {
    try {
      db.exec('VACUUM');
    } catch (error) {
      return {
        before,
        after: getStorageOverview(db, { serverRoot, uploadsDir, dbPath, ...retention }),
        deleted,
        retention,
        compacted: false,
        compact_error: error.message
      };
    }
  }

  return {
    before,
    after: getStorageOverview(db, { serverRoot, uploadsDir, dbPath, ...retention }),
    deleted,
    retention,
    compacted: deletedRows > 0 && flags.compactDatabase
  };
}

module.exports = {
  DEFAULT_RETENTION,
  buildUploadInventory,
  getReferencedUploadPaths,
  getStorageOverview,
  resolveManagedUploadPath,
  runStorageCleanup
};
