const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildUploadInventory,
  resolveManagedUploadPath
} = require('./storageMaintenance');

test('resolveManagedUploadPath only resolves files inside uploads directory', () => {
  const serverRoot = path.join(os.tmpdir(), 'storage-maintenance-test');
  const uploadsDir = path.join(serverRoot, 'uploads');

  assert.equal(
    resolveManagedUploadPath('/uploads/a.png', { serverRoot, uploadsDir }),
    path.join(uploadsDir, 'a.png')
  );
  assert.equal(
    resolveManagedUploadPath('uploads/nested/b.png', { serverRoot, uploadsDir }),
    path.join(uploadsDir, 'nested', 'b.png')
  );
  assert.equal(resolveManagedUploadPath('/etc/passwd', { serverRoot, uploadsDir }), null);
  assert.equal(resolveManagedUploadPath('/uploads/../data/qrcodes.db', { serverRoot, uploadsDir }), null);
});

test('buildUploadInventory separates referenced and orphan upload files', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-maintenance-'));
  const serverRoot = tempRoot;
  const uploadsDir = path.join(serverRoot, 'uploads');
  fs.mkdirSync(path.join(uploadsDir, 'nested'), { recursive: true });

  fs.writeFileSync(path.join(uploadsDir, 'kept.png'), 'kept');
  fs.writeFileSync(path.join(uploadsDir, 'draft.png'), 'draft');
  fs.writeFileSync(path.join(uploadsDir, 'nested', 'orphan.png'), 'orphan');

  const fakeDb = {
    prepare(sql) {
      return {
        all() {
          if (sql.includes('FROM qrcodes')) return [{ file_path: '/uploads/kept.png' }];
          if (sql.includes('FROM collection_rule_drafts')) return [{ file_path: '/uploads/draft.png' }];
          if (sql.includes('FROM collection_email_verification_rules')) return [];
          return [];
        }
      };
    }
  };

  const inventory = buildUploadInventory(fakeDb, { serverRoot, uploadsDir });

  assert.equal(inventory.fileCount, 3);
  assert.deepEqual(
    inventory.orphanFiles.map(file => file.publicPath),
    ['/uploads/nested/orphan.png']
  );
  assert.equal(inventory.referencedPublicPaths.includes('/uploads/kept.png'), true);
  assert.equal(inventory.referencedPublicPaths.includes('/uploads/draft.png'), true);
});
