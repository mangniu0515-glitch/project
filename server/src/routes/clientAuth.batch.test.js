const assert = require('node:assert/strict');
const test = require('node:test');

const clientAuthRouter = require('./clientAuth');

const { parseIpBatchText } = clientAuthRouter.__testables;

test('parseIpBatchText supports newline comma and semicolon separated IP text', () => {
  const entries = parseIpBatchText('10.0.0.182\n10.0.0.183, 10.0.0.184；10.0.0.183');

  assert.deepEqual(entries.map(item => item.ip_address), [
    '10.0.0.182',
    '10.0.0.183',
    '10.0.0.184'
  ]);
});

test('parseIpBatchText ignores invalid values', () => {
  const entries = parseIpBatchText('hello\n999.1.1.1\n::ffff:10.0.0.185');

  assert.deepEqual(entries.map(item => item.ip_address), ['10.0.0.185']);
});
