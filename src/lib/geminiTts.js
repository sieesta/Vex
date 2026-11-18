import { USE_PROXY, proxyCall } from './proxy'

const CHAT_MODEL = 'gemini-3.8-flash'
const TTS_MODEL = 'gemini-3.8-flash-tts'
const TTS_VOICE = 'Puck'

let sdkPromise = null
function loadSdk() {
  if (!sdkPromise) sdkPromise = import('@google/genai')
  return sdkPromise
}

const PERFORMANCE_BY_TAG = {
  giggling: 'Start with a short, genuine giggle, then continue with a grin in your voice.',
  'dark chuckle': 'Give a brief mischievous chuckle before speaking, without sounding sinister.',
  cheerful: 'Sound bright, bouncy and delighted, like you just heard something fun.',
  warm: 'Sound relaxed, friendly and close, with a small smile.',
  'exasperated sigh': 'Begin with a quick realistic sigh, then sound playfully fed up.',
  sarcastic: 'Use a dry, playful teenage tease; make the irony obvious but affectionate.',
  deadpan: 'Use a deliberately flat, comedic delivery, then add a tiny amused lift at the end.',
  'mock sympathy': 'Sound overly sympathetic in a clearly playful, joking way.',
  'pauses to laugh': 'Pause briefly as if trying not to laugh, then continue naturally.',
  'rapid babbling': 'Speak quickly and excitedly, with tiny natural pauses so the words stay clear.',
}

function decodeBase64(value) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function pcmToWav(pcm, sampleRate = 24000) {
  const buffer = new ArrayBuffer(44 + pcm.length)
  const view = new DataView(buffer)
  const write = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index))
    }
  }
  write(0, 'RIFF')
  view.setUint32(4, 36 + pcm.length, true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  write(36, 'data')
  view.setUint32(40, pcm.length, true)
  new Uint8Array(buffer, 44).set(pcm)
  return new Blob([buffer], { type: 'audio/wav' })
}

function audioBlob(part) {
  const data = part?.inlineData?.data
  if (!data) return null
  const mimeType = String(part.inlineData.mimeType || '')
  if (/audio\/wav|audio\/mpeg|audio\/mp3/i.test(mimeType)) {
    const bytes = decodeBase64(data)
    return new Blob([bytes], { type: mimeType.split(';')[0] })
  }
  const rate = Number(mimeType.match(/rate=(\d+)/i)?.[1]) || 24000
  return pcmToWav(decodeBase64(data), rate)
}

export async function generateGeminiChat({
  keys = [],
  model = CHAT_MODEL,
  systemInstruction,
  history,
  abortSignal,
} = {}) {
  if (USE_PROXY) {
    const data = await proxyCall('gemini-chat', { model, systemInstruction, history }, { abortSignal })
    return data.content
  }
  if (!keys.length) throw new Error('Gemini is not available.')
  const { GoogleGenAI } = await loadSdk()
  let lastError

  for (const key of keys) {
    try {
      const ai = new GoogleGenAI({
        apiKey: key,
        httpOptions: { apiVersion: 'v1beta' },
      })
      const response = await ai.models.generateContent({
        model,
        contents: (history || []).map((message) => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: String(message.content || '') }],
        })),
        config: {
          abortSignal,
          systemInstruction,
          responseMimeType: 'application/json',
          temperature: 0.8,
          maxOutputTokens: 400,
        },
      })
      const content = response.text?.trim()
      if (!content) throw new Error('Gemini returned an empty completion.')
      return content
    } catch (error) {
      if (error?.name === 'AbortError') throw error
      lastError = error
    }
  }

  throw lastError || new Error('Gemini chat failed.')
}

function languageInstruction(languageMode) {
  if (languageMode === 'tagalog') {
    return 'Speak this in natural, clear Filipino Tagalog. Do not translate it or add words. '
  }
  if (languageMode === 'taglish') {
    return 'Speak this naturally in Filipino Taglish. Do not translate it or add words. '
  }
  if (languageMode === 'japanese') {
    return 'Speak this in natural Japanese. Do not translate it or add words. '
  }
  if (languageMode === 'korean') {
    return 'Speak this in natural Korean. Do not translate it or add words. '
  }
  if (languageMode === 'spanish') {
    return 'Speak this in natural Spanish. Do not translate it or add words. '
  }
  return 'Speak this in natural English. Do not translate it or add words. '
}

export async function generateGeminiSpeech(
  text,
  {
    keys = [],
    model = TTS_MODEL,
    voice = TTS_VOICE,
    languageMode = 'taglish',
    abortSignal,
  } = {},
) {
  if (!keys.length && !USE_PROXY) throw new Error('Gemini speech is not available.')

  const { GoogleGenAI, Modality } = USE_PROXY ? {} : await loadSdk()
  const rawText = String(text || '').trim()
  const vocalTag = rawText.match(/^\[([^\]]+)\]\s*/)?.[1]?.toLowerCase()
  const spokenText = rawText.replace(/^\[[^\]]+\]\s*/, '').trim()
  if (!spokenText) throw new Error('Nothing to say.')

  const performance =
    PERFORMANCE_BY_TAG[vocalTag] ||
    'Use lively, natural conversational timing with a playful smile and occasional tiny pauses.'
  const voiceInstruction =
    'Speak as the same natural teenage Filipino boy every time: warm, relaxed, and conversational, with a light youthful pitch. Use a CALM, unhurried conversational pace — take a small breath between clauses, pause briefly at commas and ellipses, and let each sentence land before the next. Never rush or run words together. Do not sound like a deep adult announcer, a baby, a cartoon, or an adult woman. '

  if (USE_PROXY) {
    const contents = `${voiceInstruction}${performance} ${languageInstruction(languageMode)}Say only this exact line naturally: ${spokenText}`
    const { blob } = await proxyCall('gemini-tts', { model, voice, contents }, { abortSignal })
    return blob
  }

  let lastError
  for (const key of keys) {
    try {
      const ai = new GoogleGenAI({
        apiKey: key,
        httpOptions: { apiVersion: 'v1beta' },
      })
      const response = await ai.models.generateContent({
        model,
        contents: `${voiceInstruction}${performance} ${languageInstruction(languageMode)}Say only this exact line naturally: ${spokenText}`,
        config: {
          abortSignal,
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
          },
        },
      })
      const part = response.candidates?.[0]?.content?.parts?.find((item) => item.inlineData?.data)
      const blob = audioBlob(part)
      if (!blob) throw new Error('Gemini returned no audio.')
      return blob
    } catch (error) {
      if (error?.name === 'AbortError') throw error
      lastError = error
    }
  }

  throw lastError || new Error('Gemini speech failed.')
}
