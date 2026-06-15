import assert from 'node:assert/strict'
import test from 'node:test'

import { isUsableAuthToken } from './authToken.js'

function makeToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `header.${body}.signature`
}

test('isUsableAuthToken rejects missing, malformed, and expired tokens', () => {
  assert.equal(isUsableAuthToken(''), false)
  assert.equal(isUsableAuthToken('not-a-jwt'), false)
  assert.equal(isUsableAuthToken(makeToken({ exp: 1000 }), 2000 * 1000), false)
})

test('isUsableAuthToken accepts a token before its expiry timestamp', () => {
  assert.equal(isUsableAuthToken(makeToken({ exp: 3000 }), 2000 * 1000), true)
})
