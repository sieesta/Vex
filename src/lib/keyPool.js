export const KEY_STATUSES = ['active', 'cooldown', 'exhausted', 'invalid']

export const STATUS_META = {
  active: { label: 'Active', color: '#34d399', note: 'ready to serve' },
  cooldown: { label: 'Cooldown', color: '#fbbf24', note: 'rate limited' },
  exhausted: { label: 'Daily Limit', color: '#fb7185', note: 'RPD / quota gone' },
  invalid: { label: 'Invalid', color: '#f43f5e', note: '401 / 403' },
}

/** Validation guard for the persisted pool. */
export function validKeyPool(value) {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        entry &&
        typeof entry.id === 'string' &&
        typeof entry.key === 'string' &&
        (entry.label === undefined || typeof entry.label === 'string') &&
        (entry.status === undefined || KEY_STATUSES.includes(entry.status)) &&
        (entry.cooldownUntil === undefined ||
          entry.cooldownUntil === null ||
          typeof entry.cooldownUntil === 'number') &&
        (entry.requestsUsed === undefined || typeof entry.requestsUsed === 'number'),
    )
  )
}

export function makeKeyRecord(key, index, id) {
  return {
    id,
    label: `Key #${index + 1}`,
    key: String(key || '').trim(),
    status: 'active',
    cooldownUntil: null,
    requestsUsed: 0,
  }
}

/**
 * Accepts one key per line and/or comma-separated keys, plus stray whitespace.
 * Groq keys start with gsk_ — anything else is ignored to avoid junk entries.
 */
export function parseKeysInput(raw) {
  return String(raw ?? '')
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter((part) => /^gsk_[A-Za-z0-9_-]{6,}$/.test(part))
}

export function summarizePool(pool) {
  const summary = { total: pool.length, active: 0, cooldown: 0, exhausted: 0, invalid: 0, requests: 0 }
  for (const entry of pool) {
    if (KEY_STATUSES.includes(entry.status)) summary[entry.status] += 1
    summary.requests += Number(entry.requestsUsed) || 0
  }
  return summary
}

export function formatCooldown(until, now = Date.now()) {
  const remaining = Number(until) - now
  if (!Number.isFinite(remaining) || remaining <= 0) return '0s'
  if (remaining < 1000) return '<1s'
  const seconds = Math.ceil(remaining / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${seconds % 60}s`
}

export function maskKey(key) {
  const value = String(key || '')
  if (value.length <= 11) return value ? `${value.slice(0, 4)}••••` : '—'
  return `${value.slice(0, 7)}••••••••${value.slice(-4)}`
}
