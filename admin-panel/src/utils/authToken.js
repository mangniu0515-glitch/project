export function decodeJwtPayload(token) {
  const parts = String(token || '').split('.')
  if (parts.length < 2 || !parts[1]) return null

  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const json = typeof atob === 'function'
      ? decodeURIComponent(Array.from(atob(padded), char => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''))
      : Buffer.from(padded, 'base64').toString('utf8')
    return JSON.parse(json)
  } catch {
    return null
  }
}

export function isUsableAuthToken(token, nowMs = Date.now()) {
  const payload = decodeJwtPayload(token)
  if (!payload || typeof payload.exp !== 'number') return false
  return payload.exp * 1000 > nowMs
}
