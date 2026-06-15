const assert = require('node:assert/strict');
const test = require('node:test');

const emailPoolRouter = require('./emailPool');

const { findMatchingRule } = emailPoolRouter.__testables;

test('findMatchingRule can match a later enabled rule by sender and subject', () => {
  const rules = [
    {
      id: 1,
      sender_pattern: 'tlabel@tencent.com',
      subject_pattern: '*验证码*'
    },
    {
      id: 2,
      sender_pattern: 'notice@example.com',
      subject_pattern: '*Login*'
    }
  ];

  const matched = findMatchingRule(rules, {
    from: [{ address: 'notice@example.com' }],
    subject: 'Your Login Code'
  });

  assert.equal(matched.id, 2);
});
