import { prepareForSpeech, truncateForOrpheus } from './speech'
import { USE_PROXY, proxyCall } from './proxy'

// Eleven v3 follows audio tags ([shouting], [sighs], [crying]...) for genuine
// delivery. Multilingual v2 ignores them — shouting then sounds like normal
// text in caps, which was the whole problem.
const ELEVENLABS_DEFAULT_MODEL = 'eleven_v3'
const ORPHEUS_DEFAULT_MODEL = 'canopylabs/orpheus-v1-english'
const ORPHEUS_VOICE = 'austin'

// Natural conversational pace. ElevenLabs docs: speed 0.7–1.2, default 1.0;
// extreme values hurt quality. Emotion now comes from audio tags and pauses,
// not from slowing the voice to a crawl or speeding it up.
const ELEVENLABS_EMOTION = {
  chill: { stability: 0.5, similarity_boost: 0.78, style: 0.25, speed: 0.95 },
  amused: { stability: 0.48, similarity_boost: 0.8, style: 0.4, speed: 0.98 },
  sarcastic: { stability: 0.55, similarity_boost: 0.8, style: 0.3, speed: 0.94 },
  annoyed: { stability: 0.45, similarity_boost: 0.82, style: 0.5, speed: 0.97 },
  frustrated: { stability: 0.35, similarity_boost: 0.85, style: 0.65, speed: 1.0 },
  unhinged: { stability: 0.3, similarity_boost: 0.88, style: 0.8, speed: 1.02 },
}

const MAX_SPEECH_SPEED = 1.05

/**
 * Map Vex's stage directions to ElevenLabs v3/v4 audio tags. These are
 * performance instructions, NOT spoken words — this is what actually makes
 * the engine shout, sigh, laugh or cry instead of reading caps flatly.
 */
const AUDIO_TAG_MAP = {
  'screaming in frustration': 'shouting',
  angry: 'angry',
  'laughing hysterically': 'laughing harder',
  giggling: 'giggles',
  'dark chuckle': 'chuckles',
  'exasperated sigh': 'sighs',
  'deep annoyed groan': 'sighs',
  'rubbing temples': 'sighs',
  'pauses to laugh': 'laughs',
  'whispering tiredly': 'whispers',
  'voice breaking': 'voice trembling with emotion',
  sniffles: 'crying',
  'teary laugh': 'crying, then laughing',
  coughs: 'coughs',
  'clears throat': 'clears throat',
  sarcastic: 'sarcastic',
  deadpan: 'deadpan',
  'mock sympathy': 'sympathetic',
  cheerful: 'excited',
  warm: 'warmly',
}

function elevenLabsText(text) {
  const raw = String(text || '')
  const tags = [...raw.matchAll(/\[([^\]]+)\]/g)]
    .map((match) => AUDIO_TAG_MAP[match[1].trim().toLowerCase()])
    .filter(Boolean)
    .slice(0, 2)
  const clean = prepareForSpeech(raw, { preserveEmphasis: true })
  return `${tags.map((tag) => `[${tag}]`).join(' ')} ${clean}`.trim()
}

/* ----------------------------- key rotation ----------------------------- */
// Each provider keeps its own cursor and per-key health. A rate-limited key is
// cooled down (and retried later), an invalid key is skipped for the session,
// and the cursor advances after success so all configured accounts are used.
const KEY_HEALTH = { eleven: new Map(), groq: new Map() }
const KEY_CURSOR = { eleven: 0, groq: 0 }
const COOLDOWN_MS = 60_000

function maskKey(key) {
  return `${String(key).slice(0, 6)}…${String(key).slice(-4)}`
}

function availableKey(keys, bucket) {
  const now = Date.now()
  const usable = keys
    .map((key, index) => ({ key, index }))
    .filter(({ key }) => {
      const health = KEY_HEALTH[bucket].get(key)
      if (!health) return true
      if (health.status === 'invalid') return false
      return !health.until || health.until <= now
    })

  if (!usable.length) return null
  return usable[KEY_CURSOR[bucket] % usable.length] || usable[0]
}

function markKey(bucket, key, error) {
  const status = error?.status
  // 402 on ElevenLabs means the account can't use this voice at all — no
  // point retrying it every turn for the rest of the session.
  if (status === 401 || status === 402 || status === 403) {
    KEY_HEALTH[bucket].set(key, { status: 'invalid' })
    return
  }
  let wait = COOLDOWN_MS
  if (status === 429 && Number(error?.retryAfter) > 0) {
    wait = Number(error.retryAfter) * 1000
  } else if (status !== 429) {
    wait = 10_000
  }
  KEY_HEALTH[bucket].set(key, { status: 'cooldown', until: Date.now() + Math.min(wait, 300_000) })
}

function providerError(provider, response, detail) {
  const error = new Error(`${provider} request failed (${response.status}): ${detail}`)
  error.provider = provider
  error.status = response.status
  error.retryAfter = Number(response.headers.get('retry-after')) || null
  error.detail = detail
  return error
}

async function responseDetail(response) {
  try {
    const body = await response.text()
    return body.slice(0, 400) || response.statusText
  } catch {
    return response.statusText || 'Unknown provider error'
  }
}

/* ---- ElevenLabs pre-flight: only spend credits on keys that can work ---- */
const ELEVEN_CHECK_CACHE = new Map()
const CHECK_TTL = 10 * 60_000

async function checkElevenKey(key, voiceId) {
  if (USE_PROXY) return { available: true, detail: 'server-managed' }
  const cacheKey = `${key}:${voiceId}`
  const cached = ELEVEN_CHECK_CACHE.get(cacheKey)
  if (cached && cached.until > Date.now()) return cached

  let result
  try {
    const headers = { 'xi-api-key': key }
    const [userRes, voicesRes] = await Promise.all([
      fetch('https://api.elevenlabs.io/v1/user', { headers }),
      fetch('https://api.elevenlabs.io/v1/voices', { headers }),
    ])

    if (!userRes.ok) {
      result = { available: false, detail: `account check HTTP ${userRes.status}` }
    } else {
      const subscription = (await userRes.json())?.subscription || {}
      const used = Number(subscription.character_count) || 0
      const limit = Number(subscription.character_limit) || 0
      const tier = String(subscription.tier || subscription.type || '').toLowerCase()
      const voices = voicesRes.ok ? (await voicesRes.json().catch(() => ({})))?.voices || [] : []
      const voice = voices.find((item) => item.voice_id === voiceId)
      const category = String(voice?.category || '').toLowerCase()
      const isCustom = category === 'generated' || category === 'cloned'

      if (limit > 0 && used >= limit) {
        result = { available: false, detail: 'character quota exhausted' }
      } else if (limit > 0 && limit - used < 100) {
        result = { available: false, detail: 'quota nearly exhausted' }
      } else if (!voice) {
        result = { available: false, detail: 'voice not in this account' }
      } else if (tier === 'free' && !isCustom) {
        // Free accounts can use their OWN generated/cloned voices, but not
        // ElevenLabs library/professional voices via the API.
        result = { available: false, detail: 'free plan cannot use library voices' }
      } else {
        const left = limit > 0 ? Math.round((1 - used / limit) * 100) : null
        result = {
          available: true,
          detail: `${voice.name || 'custom voice'}${left === null ? '' : ` · ${left}% quota left`}`,
        }
      }
    }
  } catch (error) {
    result = { available: false, detail: error?.message || 'account check failed' }
  }

  // Recheck unavailable accounts sooner, so a topped-up quota is picked up.
  ELEVEN_CHECK_CACHE.set(cacheKey, {
    ...result,
    until: Date.now() + (result.available ? CHECK_TTL : 60_000),
  })
  return ELEVEN_CHECK_CACHE.get(cacheKey)
}

/** Snapshot of each ElevenLabs key's availability for the configured voice. */
export async function getElevenLabsKeyStatus(keys = [], voiceId = '') {
  return Promise.all(
    keys.map(async (key) => ({
      key: maskKey(key),
      ...(await checkElevenKey(key, voiceId)),
    })),
  )
}

async function requestElevenLabs(
  text,
  {
    keys = [],
    voiceId,
    voiceIds = {},
    model = ELEVENLABS_DEFAULT_MODEL,
    emotion = 'chill',
    abortSignal,
  } = {},
) {
  if (!keys.length || !voiceId) throw new Error('ElevenLabs is not available.')
  const expression = ELEVENLABS_EMOTION[emotion] || ELEVENLABS_EMOTION.chill

  if (USE_PROXY) {
    const { blob } = await proxyCall(
      'elevenlabs-tts',
      {
        text,
        model,
        voiceId,
        voice_settings: {
          ...expression,
          speed: Math.min(expression.speed, MAX_SPEECH_SPEED),
          use_speaker_boost: true,
        },
      },
      { abortSignal },
    )
    return blob
  }

  const failures = []

  for (let attempt = 0; attempt < keys.length; attempt += 1) {
    const chosen = availableKey(keys, 'eleven')
    if (!chosen) break

    // Each account can own a different custom voice ID.
    const chosenVoiceId = voiceIds[chosen.key] || voiceId
    const health = await checkElevenKey(chosen.key, chosenVoiceId)
    if (!health.available) {
      markKey('eleven', chosen.key, { status: 429 })
      failures.push(`${maskKey(chosen.key)}: ${health.detail}`)
      continue
    }

    try {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(chosenVoiceId)}?output_format=mp3_44100_128`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': chosen.key,
          },
          body: JSON.stringify({
            text,
            model_id: model,
            voice_settings: {
              ...expression,
              speed: Math.min(expression.speed, MAX_SPEECH_SPEED),
              use_speaker_boost: true,
            },
          }),
          signal: abortSignal,
        },
      )
      if (!response.ok) throw providerError('ElevenLabs', response, await responseDetail(response))
      const blob = await response.blob()
      if (!blob.size) throw new Error('ElevenLabs returned empty audio.')
      KEY_CURSOR.eleven = (chosen.index + 1) % keys.length
      return blob
    } catch (error) {
      if (error?.name === 'AbortError') throw error
      markKey('eleven', chosen.key, error)
      failures.push(`${maskKey(chosen.key)}: ${error.message || 'request failed'}`)
    }
  }

  throw new Error(
    failures.length
      ? `ElevenLabs: all ${keys.length} lines unavailable — ${failures.join(' · ')}`
      : `ElevenLabs: all ${keys.length} lines are invalid or cooling down`,
  )
}

export async function generateElevenLabsSpeech(
  text,
  {
    keys = [],
    voiceId = '',
    voiceIds = {},
    model = ELEVENLABS_DEFAULT_MODEL,
    emotion = 'chill',
    abortSignal,
  } = {},
) {
  const clean = elevenLabsText(text)
  if (!clean) throw new Error('Nothing to say.')
  return requestElevenLabs(clean, { keys, voiceId, voiceIds, model, emotion, abortSignal })
}

/**
 * Orpheus is English/Arabic only. The caller puts it last for Taglish and
 * first for mostly-English lines. Key outcomes are reported back so the
 * conversation engine can rest or retire a line without showing anything.
 */
export async function generateGroqSpeech(
  text,
  {
    keys = [],
    model = ORPHEUS_DEFAULT_MODEL,
    voice = ORPHEUS_VOICE,
    abortSignal,
    onKeySuccess,
    onKeyError,
  } = {},
) {
  if (!keys.length && !USE_PROXY) throw new Error('Orpheus is not available.')
  const clean = truncateForOrpheus(prepareForSpeech(text))
  if (!clean) throw new Error('Nothing to say.')

  if (USE_PROXY) {
    const { blob } = await proxyCall('groq-tts', { model, voice, input: clean }, { abortSignal })
    return blob
  }

  const failures = []

  for (let attempt = 0; attempt < keys.length; attempt += 1) {
    const chosen = availableKey(keys, 'groq')
    if (!chosen) break

    try {
      const response = await fetch('https://api.groq.com/openai/v1/audio/speech', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${chosen.key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          voice,
          input: clean,
          response_format: 'wav',
        }),
        signal: abortSignal,
      })
      if (!response.ok) throw providerError('Orpheus', response, await responseDetail(response))
      const blob = await response.blob()
      if (!blob.size) throw new Error('Orpheus returned empty audio.')
      KEY_CURSOR.groq = (chosen.index + 1) % keys.length
      try {
        onKeySuccess?.(chosen.key)
      } catch {
        /* the audio matters more than the bookkeeping */
      }
      return blob
    } catch (error) {
      if (error?.name === 'AbortError') throw error
      markKey('groq', chosen.key, error)
      failures.push(`${maskKey(chosen.key)}: ${error.message || 'request failed'}`)
      try {
        onKeyError?.(chosen.key, error)
      } catch {
        /* the audio matters more than the bookkeeping */
      }
    }
  }

  throw new Error(
    failures.length
      ? `Orpheus: all ${keys.length} lines unavailable — ${failures.join(' · ')}`
      : `Orpheus: all ${keys.length} lines are invalid or cooling down`,
  )
}
