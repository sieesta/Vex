import { USE_PROXY, proxyCall } from './proxy'
import { prepareForSpeech } from './speech'

const CHAT_MODEL = 'gemini-3.8-flash'
const TTS_MODEL = 'gemini-3.8-flash-tts'
// Leda is the youngest, highest prebuilt voice (~260Hz median), which gives the
// mascot its small-creature timbre without any acting instructions.
const TTS_VOICE = 'Leda'

let sdkPromise = null
function loadSdk() {
  if (!sdkPromise) sdkPromise = import('@google/genai')
  return sdkPromise
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

export async function generateGeminiSpeech(
  text,
  { keys = [], model = TTS_MODEL, voice = TTS_VOICE, abortSignal } = {},
) {
  if (!keys.length && !USE_PROXY) throw new Error('Gemini speech is not available.')

  const { GoogleGenAI, Modality } = USE_PROXY ? {} : await loadSdk()
  // Same shaping as the other engines: tags, emojis and stretched vowels are
  // cleaned up, and a long shout becomes "AHH, AHH!!" with a real breath pause.
  const spokenText = prepareForSpeech(text)
  if (!spokenText) throw new Error('Nothing to say.')

  // Gemini TTS reads exactly what it is given. Long style prompts leak into the
  // waveform (a 5-word line came back as 40s of spoken direction), so send only
  // the line and let Leda's youthful timbre carry the character. The reply is
  // already written in the selected language, so no language cue is needed.
  const spokenPrompt = spokenText

  if (USE_PROXY) {
    const contents = spokenPrompt
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
        contents: spokenPrompt,
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
