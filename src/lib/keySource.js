/**
 * Runtime credentials live in the extensionless `api` file at the studio root.
 * Vite serves it in dev and emits it next to the built index.html. Nothing here
 * is imported through `import.meta.env`, so the keys never enter the JS bundle.
 */

export const EMPTY_VOICE_CONFIG = Object.freeze({
  groq: [],
  elevenlabs: [],
  gemini: [],
  elevenlabsVoiceId: '',
  elevenlabsVoiceIds: {},
  elevenlabsModel: 'eleven_multilingual_v2',
  groqChatModel: 'openai/gpt-oss-120b',
  groqTtsModel: 'canopylabs/orpheus-v1-english',
  geminiChatModel: 'gemini-3.8-flash',
  geminiTtsModel: 'gemini-3.8-flash-tts',
  geminiTtsVoice: 'Puck',
  loaded: false,
})

const GROQ_KEY = /gsk_[A-Za-z0-9_-]{6,}/g
const ELEVEN_KEY = /sk_[A-Za-z0-9_-]{20,}/g
const GEMINI_KEY = /(?:AQ\.[A-Za-z0-9_-]{10,}|AIza[A-Za-z0-9_-]{20,})/g

function unique(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))]
}

function split(value) {
  if (Array.isArray(value)) return value
  return String(value ?? '').split(/[\s,;]+/)
}

function collect(source, pattern) {
  return unique(String(source ?? '').match(pattern) || [])
}

function labelled(data, keys) {
  return unique(keys.flatMap((key) => split(data[key])))
}

/**
 * Accepts JSON, `NAME=value` lines, or a bare list of keys. Labelled entries win
 * over loose matches so the file can stay human-editable.
 */
export function parseApiFile(text) {
  const source = String(text ?? '')
  let data = {}

  if (source.trim().startsWith('{')) {
    try {
      data = JSON.parse(source)
    } catch {
      data = {}
    }
  }

  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.+?)\s*$/)
    if (match) data[match[1]] = match[2]
  }

  const groq = unique([
    ...labelled(data, ['groq', 'GROQ', 'GROQ_API_KEYS', 'VITE_GROQ_API_KEYS']),
    ...collect(source, GROQ_KEY),
  ]).filter((key) => /^gsk_[A-Za-z0-9_-]{6,}$/.test(key))

  const elevenlabs = unique([
    ...labelled(data, [
      'elevenlabs',
      'ELEVENLABS',
      'ELEVENLABS_API_KEYS',
      'VITE_ELEVENLABS_API_KEYS',
      'VITE_ELEVENLABS_API_KEY',
    ]),
    ...collect(source, ELEVEN_KEY),
  ]).filter((key) => /^sk_[A-Za-z0-9_-]{20,}$/.test(key))

  const gemini = unique([
    ...labelled(data, [
      'gemini',
      'GEMINI',
      'GEMINI_API_KEYS',
      'VITE_GEMINI_API_KEYS',
      'VITE_GEMINI_API_KEY',
    ]),
    ...collect(source, GEMINI_KEY),
  ]).filter((key) => key.length >= 20)

  const read = (keys, fallback) => {
    for (const key of keys) {
      const value = data[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
    return fallback
  }

  return {
    ...EMPTY_VOICE_CONFIG,
    groq,
    elevenlabs,
    gemini,
    elevenlabsVoiceId: read(['elevenlabsVoiceId', 'ELEVENLABS_VOICE_ID', 'VITE_ELEVENLABS_VOICE_ID'], ''),
    elevenlabsVoiceIds: (() => {
      const raw = data.elevenlabsVoiceIds || data.ELEVENLABS_VOICE_IDS
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw
      if (Array.isArray(raw)) {
        return Object.fromEntries(raw.map((voiceId, index) => [elevenlabs[index], voiceId]))
      }
      return {}
    })(),
    elevenlabsModel: read(
      ['elevenlabsModel', 'ELEVENLABS_MODEL', 'VITE_ELEVENLABS_MODEL'],
      EMPTY_VOICE_CONFIG.elevenlabsModel,
    ),
    groqChatModel: read(
      ['groqChatModel', 'GROQ_CHAT_MODEL', 'VITE_GROQ_CHAT_MODEL'],
      EMPTY_VOICE_CONFIG.groqChatModel,
    ),
    groqTtsModel: read(
      ['groqTtsModel', 'GROQ_TTS_MODEL', 'VITE_GROQ_TTS_MODEL'],
      EMPTY_VOICE_CONFIG.groqTtsModel,
    ),
    geminiChatModel: read(
      ['geminiChatModel', 'GEMINI_CHAT_MODEL', 'VITE_GEMINI_CHAT_MODEL'],
      EMPTY_VOICE_CONFIG.geminiChatModel,
    ),
    geminiTtsModel: read(
      ['geminiTtsModel', 'GEMINI_TTS_MODEL', 'VITE_GEMINI_TTS_MODEL'],
      EMPTY_VOICE_CONFIG.geminiTtsModel,
    ),
    geminiTtsVoice: read(
      ['geminiTtsVoice', 'GEMINI_TTS_VOICE', 'VITE_GEMINI_TTS_VOICE'],
      EMPTY_VOICE_CONFIG.geminiTtsVoice,
    ),
    loaded: true,
  }
}

let current = { ...EMPTY_VOICE_CONFIG }
let pending = null

export function getVoiceConfig() {
  return current
}

export function loadVoiceConfig() {
  if (current.loaded) return Promise.resolve(current)
  if (pending) return pending

  // Production: ask the serverless function for availability only — real keys
  // never leave the server.
  if (import.meta.env.PROD) {
    pending = fetch('/api/voice?action=config', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        current = { ...EMPTY_VOICE_CONFIG, ...(data || {}), loaded: true }
        return current
      })
      .catch(() => {
        current = { ...EMPTY_VOICE_CONFIG, loaded: true }
        return current
      })
    return pending
  }

  // Local dev: Vite injects VITE_* values from .env into the bundle.
  const env = import.meta.env
  current = {
    ...EMPTY_VOICE_CONFIG,
    groq: String(env.VITE_GROQ_API_KEYS || '').split(/[\s,;]+/).filter(Boolean),
    gemini: String(env.VITE_GEMINI_API_KEYS || '').split(/[\s,;]+/).filter(Boolean),
    elevenlabs: String(env.VITE_ELEVENLABS_API_KEYS || '').split(/[\s,;]+/).filter(Boolean),
    elevenlabsVoiceId: String(env.VITE_ELEVENLABS_VOICE_ID || ''),
    elevenlabsVoiceIds: (() => {
      try {
        return JSON.parse(String(env.VITE_ELEVENLABS_VOICE_IDS || '{}'))
      } catch {
        return {}
      }
    })(),
    elevenlabsModel: String(env.VITE_ELEVENLABS_MODEL || EMPTY_VOICE_CONFIG.elevenlabsModel),
    loaded: true,
  }
  pending = Promise.resolve(current)
  return pending
}
