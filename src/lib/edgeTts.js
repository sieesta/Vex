import { USE_PROXY, proxyCall } from './proxy'
import { prepareForSpeech } from './speech'

/**
 * Edge's Read Aloud voice is the mascot's primary timbre. It is proxied through
 * the production function because the Edge WebSocket cannot be opened from a
 * browser page, and because local dev still uses the keyed providers directly.
 */
export async function generateEdgeSpeech(
  text,
  { languageMode = 'taglish', emotion = 'chill', intensity = 0, abortSignal } = {},
) {
  if (!USE_PROXY) throw new Error('Edge TTS is only available through the production proxy.')
  const clean = prepareForSpeech(text)
  if (!clean) throw new Error('Nothing to say.')
  const { blob } = await proxyCall(
    'edge-tts',
    { text: clean, languageMode, emotion, intensity },
    { abortSignal },
  )
  return blob
}
