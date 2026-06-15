function parseLimitEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function getRequestKey(req, name) {
  const forwardedFor = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwardedFor || req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';
  const userPart = req.user?.authorization_id || req.user?.id || '';
  return `${name}:${ip}:${userPart}`;
}

function createRateLimiter(options = {}) {
  const name = options.name || 'default';
  const max = Number(options.max || 60);
  const windowMs = Number(options.windowMs || 60_000);
  const now = options.now || Date.now;
  const store = options.store || new Map();

  return (req, res, next) => {
    const key = options.keyGenerator ? options.keyGenerator(req) : getRequestKey(req, name);
    const current = now();
    const bucket = store.get(key);

    if (!bucket || bucket.resetAt <= current) {
      store.set(key, { count: 1, resetAt: current + windowMs });
      if (typeof res.setHeader === 'function') {
        res.setHeader('X-RateLimit-Limit', String(max));
        res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - 1)));
      }
      return next();
    }

    bucket.count += 1;
    const remaining = Math.max(0, max - bucket.count);
    if (typeof res.setHeader === 'function') {
      res.setHeader('X-RateLimit-Limit', String(max));
      res.setHeader('X-RateLimit-Remaining', String(remaining));
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - current) / 1000))));
    }

    if (bucket.count > max) {
      return res.status(429).json({
        error: 'Too many requests, please retry later',
        code: 'RATE_LIMITED'
      });
    }

    return next();
  };
}

const rateLimiters = {
  generalApi: createRateLimiter({
    name: 'api',
    max: parseLimitEnv('RATE_LIMIT_API_PER_MINUTE', 600),
    windowMs: 60_000
  }),
  authLogin: createRateLimiter({
    name: 'auth-login',
    max: parseLimitEnv('RATE_LIMIT_LOGIN_PER_MINUTE', 10),
    windowMs: 60_000
  }),
  clientCheckIn: createRateLimiter({
    name: 'client-check-in',
    max: parseLimitEnv('RATE_LIMIT_CLIENT_CHECKIN_PER_MINUTE', 60),
    windowMs: 60_000
  }),
  qrcodeUpload: createRateLimiter({
    name: 'qrcode-upload',
    max: parseLimitEnv('RATE_LIMIT_QRCODE_UPLOAD_PER_MINUTE', 120),
    windowMs: 60_000
  }),
  emailPoll: createRateLimiter({
    name: 'email-poll',
    max: parseLimitEnv('RATE_LIMIT_EMAIL_POLL_PER_MINUTE', 20),
    windowMs: 60_000
  })
};

module.exports = {
  createRateLimiter,
  rateLimiters
};
