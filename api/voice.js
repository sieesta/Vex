/**
 * Vercel serverless proxy. All provider keys stay in environment variables;
 * the browser only talks to this same-origin endpoint.
 *
 * Vercel env vars: GROQ_API_KEYS, GEMINI_API_KEYS, ELEVENLABS_API_KEYS,
 * ELEVENLABS_VOICE_ID, ELEVENLABS_VOICE_IDS (JSON map) — see .env.example.
 */
const keys = (value) => String(value || '').split(/[\s,;]+/).map((k) => k.trim()).filter(Boolean)
const env = (name, fallback) => String(process.env[name] || fallback)

let GROQ = []
let GEMINI = []
let ELEVEN = []
let ELEVEN_VOICE = ''
let ELEVEN_VOICE_IDS = {}

function refreshConfig() {
  GROQ = keys(process.env.GROQ_API_KEYS)
  GEMINI = keys(process.env.GEMINI_API_KEYS)
  ELEVEN = keys(process.env.ELEVENLABS_API_KEYS)
  ELEVEN_VOICE = env('ELEVENLABS_VOICE_ID', '')
  try {
    ELEVEN_VOICE_IDS = JSON.parse(process.env.ELEVENLABS_VOICE_IDS || '{}')
  } catch {
    ELEVEN_VOICE_IDS = {}
  }
}

// Per-account cooldowns. A key that returns 429/401 is rested, and the next
// account is used immediately — accounts have independent quotas.
const cursors = { groq: 0, gemini: 0, eleven: 0 }
const cooldowns = { groq: new Map(), gemini: new Map(), eleven: new Map() }

function markCooldown(bucket, key, seconds) {
  const value = Number(seconds)
  const wait = Number.isFinite(value) && value > 0 ? value * 1000 : 60_000
  cooldowns[bucket].set(key, Date.now() + Math.min(wait, 300_000))
}

function pick(bucket, list) {
  if (!list.length) return null
  const now = Date.now()
  const usable = list.filter((key) => (cooldowns[bucket].get(key) || 0) <= now)
  if (!usable.length) return null
  return usable[cursors[bucket]++ % usable.length]
}

function retrySeconds(response, bodyText) {
  const header = Number(response.headers.get('retry-after'))
  if (Number.isFinite(header) && header > 0) return header
  try {
    const data = JSON.parse(bodyText)
    const raw =
      data?.error?.details?.[0]?.retryDelay ||
      data?.detail?.retryDelay ||
      data?.retryDelay ||
      data?.error?.message ||
      ''
    const match = String(raw).match(/(\d+(?:\.\d+)?)\s*s/i)
    if (match) return Number(match[1])
  } catch {
    /* ignore */
  }
  return null
}

function json(res, status, data) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(data))
}

function audio(res, bytes, type = 'audio/mpeg') {
  res.statusCode = 200
  res.setHeader('Content-Type', type)
  res.setHeader('Cache-Control', 'no-store')
  res.end(Buffer.from(bytes))
}

async function readBody(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

function providerError(response, detail) {
  return Object.assign(new Error(detail.slice(0, 300)), {
    status: response.status,
    retryAfter: retrySeconds(response, detail),
  })
}

async function groqChat(payload) {
  let lastError = null
  for (let attempt = 0; attempt < GROQ.length; attempt += 1) {
    const key = pick('groq', GROQ)
    if (!key) break
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: payload.model || env('GROQ_CHAT_MODEL', 'openai/gpt-oss-120b'),
        messages: [
          { role: 'system', content: String(payload.systemInstruction || '') },
          ...(payload.history || []).map((m) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: String(m.content || ''),
          })),
        ],
        temperature: 0.8,
        max_tokens: 400,
        reasoning_effort: 'low',
      })
    })
    if (response.ok) {
      const data = await response.json()
      return { content: data.choices?.[0]?.message?.content?.trim() || '', account: key.slice(0, 6) }
    }
    const detail = await response.text().catch(() => '')
    lastError = providerError(response, detail)
    if (response.status === 429 || response.status === 401 || response.status === 403) {
      markCooldown('groq', key, lastError.retryAfter || 60)
      continue
    }
    throw lastError
  }
  throw lastError || Object.assign(new Error('No Groq account available'), { status: 503 })
}

async function geminiRequest(model, body) {
  let lastError = null
  for (let attempt = 0; attempt < GEMINI.length; attempt += 1) {
    const key = pick('gemini', GEMINI)
    if (!key) break
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    )
    if (response.ok) return response.json()
    const detail = await response.text().catch(() => '')
    lastError = providerError(response, detail)
    if (response.status === 429 || response.status === 401 || response.status === 403) {
      markCooldown('gemini', key, lastError.retryAfter || 60)
      continue
    }
    throw lastError
  }
  throw lastError || Object.assign(new Error('No Gemini account available'), { status: 503 })
}

async function geminiChat(payload) {
  const data = await geminiRequest(payload.model || env('GEMINI_CHAT_MODEL', 'gemini-3.8-flash'), {
    contents: (payload.history || []).map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content || '') }],
    })),
    systemInstruction: { parts: [{ text: String(payload.systemInstruction || '') }] },
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.8,
      maxOutputTokens: 400,
    },
  })
  const content = (data.candidates?.[0]?.content?.parts || [])
    .map((part) => part.text || '')
    .join('')
    .trim()
  return { content }
}

async function tts(res, provider, payload) {
  if (provider === 'elevenlabs-tts') {
    let lastError = null
    for (let attempt = 0; attempt < ELEVEN.length; attempt += 1) {
      const key = pick('eleven', ELEVEN)
      if (!key) break
      const fromClient = String(payload.voiceId || '')
      const voiceId =
        fromClient && fromClient !== 'server' ? fromClient : ELEVEN_VOICE_IDS[key] || ELEVEN_VOICE
      if (!voiceId) {
        lastError = Object.assign(new Error('No ElevenLabs voice configured'), { status: 503 })
        break
      }
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'xi-api-key': key },
          body: JSON.stringify({
            text: String(payload.text || ''),
            model_id: payload.model || env('ELEVENLABS_MODEL', 'eleven_v3'),
            voice_settings: payload.voice_settings || {},
          }),
        },
      )
      if (response.ok) return audio(res, Buffer.from(await response.arrayBuffer()))
      const detail = await response.text().catch(() => '')
      lastError = providerError(response, detail)
      if (response.status === 429 || response.status === 401 || response.status === 402 || response.status === 403) {
        markCooldown('eleven', key, lastError.retryAfter || 60)
        continue
      }
      throw lastError
    }
    throw lastError || Object.assign(new Error('No ElevenLabs account available'), { status: 503 })
  }

  if (provider === 'groq-tts') {
    let lastError = null
    for (let attempt = 0; attempt < GROQ.length; attempt += 1) {
      const key = pick('groq', GROQ)
      if (!key) break
      const response = await fetch('https://api.groq.com/openai/v1/audio/speech', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: payload.model || env('GROQ_TTS_MODEL', 'canopylabs/orpheus-v1-english'),
          voice: payload.voice || 'austin',
          input: String(payload.input || ''),
          response_format: 'wav',
        }),
      })
      if (response.ok) return audio(res, Buffer.from(await response.arrayBuffer()), 'audio/wav')
      const detail = await response.text().catch(() => '')
      lastError = providerError(response, detail)
      if (response.status === 429 || response.status === 401 || response.status === 403) {
        markCooldown('groq', key, lastError.retryAfter || 60)
        continue
      }
      throw lastError
    }
    throw lastError || Object.assign(new Error('No Groq account available'), { status: 503 })
  }

  if (provider === 'gemini-tts') {
    const data = await geminiRequest(
      payload.model || env('GEMINI_TTS_MODEL', 'gemini-3.8-flash-tts'),
      {
        contents: [{ role: 'user', parts: [{ text: String(payload.contents || '') }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: payload.voice || env('GEMINI_TTS_VOICE', 'Puck'),
              },
            },
          },
        },
      },
    )
    const part = (data.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data)
    if (!part) throw Object.assign(new Error('Gemini returned no audio'), { status: 502 })
    return audio(res, Buffer.from(part.inlineData.data, 'base64'), 'audio/wav')
  }

  throw Object.assign(new Error(`Unknown provider: ${provider}`), { status: 400 })
}

export default async function handler(req, res) {
  refreshConfig()
  res.setHeader('Cache-Control', 'no-store')

  if (req.method === 'GET' && req.query?.action === 'config') {
    return json(res, 200, {
      groq: GROQ.length ? ['server'] : [],
      gemini: GEMINI.length ? ['server'] : [],
      elevenlabs: ELEVEN.length ? ['server'] : [],
      elevenlabsVoiceId: ELEVEN_VOICE ? 'server' : '',
      elevenlabsModel: env('ELEVENLABS_MODEL', 'eleven_v3'),
      groqChatModel: env('GROQ_CHAT_MODEL', 'openai/gpt-oss-120b'),
      groqTtsModel: env('GROQ_TTS_MODEL', 'canopylabs/orpheus-v1-english'),
      geminiChatModel: env('GEMINI_CHAT_MODEL', 'gemini-3.8-flash'),
      geminiTtsModel: env('GEMINI_TTS_MODEL', 'gemini-3.8-flash-tts'),
      geminiTtsVoice: env('GEMINI_TTS_VOICE', 'Puck'),
    })
  }

  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  try {
    const { provider, payload = {} } = await readBody(req)
    if (provider === 'groq-chat') return json(res, 200, await groqChat(payload))
    if (provider === 'gemini-chat') return json(res, 200, await geminiChat(payload))
    if (['elevenlabs-tts', 'gemini-tts', 'groq-tts'].includes(provider)) {
      return await tts(res, provider, payload)
    }
    return json(res, 400, { error: `Unknown provider: ${provider}` })
  } catch (error) {
    return json(res, error.status || 502, {
      error: error.message || 'Proxy request failed',
      retryAfter: error.retryAfter || null,
    })
  }
}
