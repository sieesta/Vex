import { prepareForSpeech, truncateForOrpheus } from './speech'
import { USE_PROXY, proxyCall } from './proxy'

// Eleven v3 follows audio tags ([shouting], [sighs], [crying]...) for genuine
// delivery. Multilingual v2 ignores them — shouting then sounds like normal
// text in caps, which was the whole problem.
const ELEVENLABS_DEFAULT_MODEL = 'eleven_v3'
const ORPHEUS_DEFAULT_MODEL = 'canopylabs/orpheus-v1-english'
// Brightest of the Orpheus voices. This is only the last-resort engine, but it
// should still sound like the mascot rather than a deep announcer.
const ORPHEUS_VOICE = 'hannah'

// Keep emotion in the words, not in extreme voice settings. High `style` and
// low `stability` make ElevenLabs perform — sigh, laugh, over-emote — which is
// exactly what sounds fake on a short conversational line. Movement around
// "Natural" (0.5) is enough to keep the voice alive without acting.
const ELEVENLABS_EMOTION = {
  chill: { stability: 0.38, similarity_boost: 0.82, style: 0.38, speed: 1.04 },
  amused: { stability: 0.34, similarity_boost: 0.84, style: 0.44, speed: 1.06 },
  sarcastic: { stability: 0.36, similarity_boost: 0.84, style: 0.42, speed: 1.04 },
  annoyed: { stability: 0.33, similarity_boost: 0.85, style: 0.46, speed: 1.05 },
  frustrated: { stability: 0.31, similarity_boost: 0.86, style: 0.5, speed: 1.06 },
  unhinged: { stability: 0.29, similarity_boost: 0.88, style: 0.52, speed: 1.07 },
}

const MAX_SPEECH_SPEED = 1.08

// A configured voice can disappear (deleted clone, rotated key, shared account).
// Rather than let that quietly kill the whole ElevenLabs path, fall back to the
// brightest pre-made voices in the shared library. Bella is the highest and
// most playful; Jessica is the most conversational young voice behind her.
const ELEVEN_FALLBACK_VOICES = [
  'hpp4J3VqNfWAUOO0d1Us', // Bella — bright, high, playful
  'cgSgspJ2msm6clMCkdW9', // Jessica — playful, bright, warm
  'FGY2WhTYpPnrIDTdsKH5', // Laura — bright, quirky, young
  'XrExE9yKIg1WjnnlVkGX', // Matilda — upbeat
]

/**
 * Map Vex's stage directions to ElevenLabs v3/v4 audio tags. These are
 * performance instructions, NOT spoken words — this is what actually makes
 * the engine shout, sigh, laugh or cry instead of reading caps flatly.
 */
const AUDIO_TAG_MAP = {
  giggling: 'giggles',
  'dark chuckle': 'chuckles',
  'exasperated sigh': 'sighs',
  sarcastic: 'sarcastic',
  deadpan: 'deadpan',
  'mock sympathy': 'sympathetic',
  cheerful: 'warmly',
  warm: 'warmly',
}

function elevenLabsText(text, intensity = 0) {
  const raw = String(text || '')
  // Audio tags are a spice, not a default. At delivery 0/1 the line is read
  // plainly; even at the ceiling we allow only one small tag.
  const tags =
    intensity >= 2
      ? [...raw.matchAll(/\[([^\]]+)\]/g)]
          .map((match) => AUDIO_TAG_MAP[match[1].trim().toLowerCase()])
          .filter(Boolean)
          .slice(0, 1)
      : []
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
      const voices = voicesRes.ok ? (await voicesRes.json().catch(() => ({})))?.voices || [] : []
      const configured = voices.find((item) => item.voice_id === voiceId)
      const substitute = configured
        ? null
        : ELEVEN_FALLBACK_VOICES.map((id) => voices.find((item) => item.voice_id === id)).find(Boolean)
      const voice = configured || substitute || null

      if (limit > 0 && used >= limit) {
        result = { available: false, detail: 'character quota exhausted' }
      } else if (limit > 0 && limit - used < 100) {
        result = { available: false, detail: 'quota nearly exhausted' }
      } else if (!voice) {
        result = { available: false, detail: 'voice not in this account' }
      } else {
        // Pre-made voices work on free accounts too (verified against the live
        // keys), so quota and ownership are the only things to pre-flight.
        const left = limit > 0 ? Math.round((1 - used / limit) * 100) : null
        result = {
          available: true,
          voiceId: voice.voice_id,
          detail: `${voice.name || 'custom voice'}${substitute ? ' (configured voice missing)' : ''}${
            left === null ? '' : ` · ${left}% quota left`
          }`,
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

function elevenSettings(emotion, intensity) {
  const expression = ELEVENLABS_EMOTION[emotion] || ELEVENLABS_EMOTION.chill
  const level = Math.min(3, Math.max(0, Number(intensity) || 0))
  return {
    ...expression,
    style: Math.min(0.55, expression.style * (0.8 + level * 0.12)),
    speed: Math.min(expression.speed, MAX_SPEECH_SPEED),
    use_speaker_boost: true,
  }
}

async function requestElevenLabs(
  text,
  {
    keys = [],
    voiceId,
    voiceIds = {},
    model = ELEVENLABS_DEFAULT_MODEL,
    emotion = 'chill',
    intensity = 0,
    abortSignal,
  } = {},
) {
  if (!keys.length || !voiceId) throw new Error('ElevenLabs is not available.')
  const settings = elevenSettings(emotion, intensity)

  if (USE_PROXY) {
    const { blob } = await proxyCall(
      'elevenlabs-tts',
      {
        text,
        model,
        voiceId,
        voice_settings: settings,
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
    // The account may not own the configured voice; pre-flight resolves the
    // brightest available substitute so audio still comes out in character.
    const effectiveVoiceId = health.voiceId || chosenVoiceId

    try {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(effectiveVoiceId)}?output_format=mp3_44100_128`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': chosen.key,
          },
          body: JSON.stringify({
            text,
            model_id: model,
            voice_settings: settings,
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
    intensity = 0,
    abortSignal,
  } = {},
) {
  const clean = elevenLabsText(text, intensity)
  if (!clean) throw new Error('Nothing to say.')
  return requestElevenLabs(clean, {
    keys,
    voiceId,
    voiceIds,
    model,
    emotion,
    intensity,
    abortSignal,
  })
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
