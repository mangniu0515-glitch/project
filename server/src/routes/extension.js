const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const archiver = require('archiver');

const router = express.Router();
const extensionSourceDir = [
  path.resolve(__dirname, '../../chrome-extension'),
  path.resolve(__dirname, '../../../chrome-extension')
].find(candidate => fs.existsSync(path.join(candidate, 'manifest.json')));

function normalizeServerUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

function getRequestOrigin(req) {
  const referer = req.get('referer') || req.get('referrer') || req.get('origin') || '';
  if (referer) {
    try {
      const url = new URL(referer);
      return `${url.protocol}//${url.host}`;
    } catch {
      // Fall through to forwarded headers.
    }
  }

  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol;
  const host = forwardedHost || req.get('host') || '';
  return host ? `${protocol}://${host}` : '';
}

function inferApiServerUrl(req) {
  const explicit = normalizeServerUrl(req.query.server_url || req.query.serverUrl || '');
  if (explicit) return explicit;

  const origin = getRequestOrigin(req);
  if (!origin) return `http://127.0.0.1:${process.env.PORT || 3000}`;

  try {
    const url = new URL(origin);
    if (url.port === '3011') url.port = '3010';
    else if (url.port === '3001') url.port = '3000';
    return normalizeServerUrl(url.toString());
  } catch {
    return normalizeServerUrl(origin);
  }
}

async function copyDirectory(sourceDir, targetDir) {
  const entries = await fsp.readdir(sourceDir, { withFileTypes: true });
  await fsp.mkdir(targetDir, { recursive: true });

  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.endsWith('.zip')) {
      continue;
    }

    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath);
    } else if (entry.isFile()) {
      await fsp.copyFile(sourcePath, targetPath);
    }
  }
}

async function prepareExtensionWorkspace(serverUrl) {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'qrcode-extension-'));
  const extensionDir = path.join(tempRoot, 'extension');
  await copyDirectory(extensionSourceDir, extensionDir);
  await fsp.writeFile(
    path.join(extensionDir, 'extension-config.js'),
    `globalThis.__QRCODE_EXTENSION_CONFIG__ = ${JSON.stringify({ serverUrl }, null, 2)};\n`,
    'utf8'
  );
  return { tempRoot, extensionDir };
}

function getExtensionVersion(extensionDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
  return manifest.version || '1.0.0';
}

function createZipStream(extensionDir) {
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.directory(extensionDir, false);
  return archive;
}

router.get('/info', (req, res) => {
  try {
    const serverUrl = inferApiServerUrl(req);
    const sourceManifest = JSON.parse(fs.readFileSync(path.join(extensionSourceDir, 'manifest.json'), 'utf8'));
    res.json({
      serverUrl,
      version: sourceManifest.version || '1.0.0',
      formats: ['zip']
    });
  } catch (error) {
    console.error('Get extension info error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/package.zip', async (req, res) => {
  let tempRoot = null;
  try {
    const serverUrl = inferApiServerUrl(req);
    const workspace = await prepareExtensionWorkspace(serverUrl);
    tempRoot = workspace.tempRoot;
    const version = getExtensionVersion(workspace.extensionDir);
    const fileName = `qrcode-extension-v${version}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    const zipStream = createZipStream(workspace.extensionDir);
    zipStream.on('error', error => {
      console.error('Extension zip stream error:', error);
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
      res.end();
    });
    res.on('finish', () => {
      if (tempRoot) fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    });
    res.on('close', () => {
      if (tempRoot) fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    });
    zipStream.pipe(res);
    await zipStream.finalize();
  } catch (error) {
    if (tempRoot) await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    console.error('Download extension zip error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
});

router.__testables = {
  inferApiServerUrl,
  normalizeServerUrl
};

module.exports = router;
