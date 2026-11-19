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
    const result = { blob: await response.blob(), status: response.status }
    // Edge sends word boundaries so captions can follow the voice.
    const encoded = response.headers.get('X-Vex-Words')
    if (encoded) {
      try {
        const binary = atob(encoded)
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
        result.words = JSON.parse(new TextDecoder().decode(bytes))
      } catch {
        /* timings are optional; the caption still works without them */
      }
    }
    return result
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
