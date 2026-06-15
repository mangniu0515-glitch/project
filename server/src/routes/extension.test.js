const assert = require('node:assert/strict');
const test = require('node:test');

const extensionRouter = require('./extension');

const { inferApiServerUrl } = extensionRouter.__testables;

test('inferApiServerUrl maps admin panel port to API port without authentication state', () => {
  const req = {
    query: {},
    get(name) {
      if (name === 'referer') return 'http://192.168.20.53:3011/email-pool';
      return '';
    },
    headers: {},
    protocol: 'http'
  };

  assert.equal(inferApiServerUrl(req), 'http://192.168.20.53:3010');
});

test('inferApiServerUrl accepts explicit server_url override for package generation', () => {
  const req = {
    query: { server_url: 'http://10.0.0.1:3010/' },
    get() { return ''; },
    headers: {},
    protocol: 'http'
  };

  assert.equal(inferApiServerUrl(req), 'http://10.0.0.1:3010');
});
