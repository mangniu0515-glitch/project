function normalizeIp(value) {
  let ip = String(value || '').trim();
  if (!ip) return '';

  if (ip.includes(',')) {
    ip = ip.split(',')[0].trim();
  }

  if (ip.startsWith('::ffff:')) {
    ip = ip.slice(7);
  }

  if (ip === '::1') return '127.0.0.1';
  return ip;
}

function isValidIpAddress(value) {
  const ip = normalizeIp(value);
  if (!ip) return false;

  const ipv4Parts = ip.split('.');
  if (ipv4Parts.length === 4) {
    return ipv4Parts.every(part => {
      if (!/^\d{1,3}$/.test(part)) return false;
      const number = Number(part);
      return number >= 0 && number <= 255;
    });
  }

  if (!ip.includes(':')) return false;
  if (!/^[0-9a-f:]+$/i.test(ip)) return false;
  if (ip.split('::').length > 2) return false;

  const compact = ip.includes('::');
  const parts = ip.split(':').filter(Boolean);
  if (parts.length > 8) return false;
  if (!compact && parts.length !== 8) return false;
  return parts.every(part => part.length <= 4);
}

function getClientIp(req) {
  return normalizeIp(req.ip || req.socket?.remoteAddress || '');
}

module.exports = {
  getClientIp,
  isValidIpAddress,
  normalizeIp
};
