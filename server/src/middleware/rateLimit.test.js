const assert = require('node:assert/strict');
const test = require('node:test');

const { createRateLimiter } = require('./rateLimit');

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

test('createRateLimiter rejects requests over the configured window limit', () => {
  let now = 1000;
  let nextCount = 0;
  const limiter = createRateLimiter({
    name: 'test',
    max: 2,
    windowMs: 1000,
    now: () => now
  });

  const req = { ip: '10.0.0.1', method: 'POST', originalUrl: '/api/test' };
  const first = createResponse();
  const second = createResponse();
  const third = createResponse();

  limiter(req, first, () => { nextCount += 1; });
  limiter(req, second, () => { nextCount += 1; });
  limiter(req, third, () => { nextCount += 1; });

  assert.equal(nextCount, 2);
  assert.equal(third.statusCode, 429);
  assert.match(third.body.error, /Too many requests/);

  now = 2101;
  const afterWindow = createResponse();
  limiter(req, afterWindow, () => { nextCount += 1; });

  assert.equal(afterWindow.statusCode, 200);
  assert.equal(nextCount, 3);
});
