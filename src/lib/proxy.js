/**
 * Production (Vercel): voice/AI requests go to a serverless function that
 * holds the real API keys in environment variables. The browser never sees
 * them. Local dev keeps using the `api` credential file directly.
 */
export const USE_PROXY = import.meta.env.PROD

const AUDIO_PROVIDERS = new Set(['edge-tts', 'elevenlabs-tts', 'gemini-tts', 'groq-tts'])

export async function proxyCall(provider, payload = {}, { abortSignal } = {}) {
  const response = await fetch('/api/voice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, payload }),
    signal: abortSignal,
  })

  if (AUDIO_PROVIDERS.has(provider)) {
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`${provider} failed (${response.status}): ${detail.slice(0, 200)}`)
    }
    return { blob: await response.blob(), status: response.status }
  }

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.error || `${provider} failed (${response.status})`)
    error.status = response.status
    error.retryAfter = data.retryAfter || null
    throw error
  }
  return data
}
