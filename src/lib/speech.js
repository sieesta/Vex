export const VOICES = [
  { id: 'troy', label: 'Troy', descriptor: 'Casual Male', gender: 'male' },
  { id: 'austin', label: 'Austin', descriptor: 'Expressive Male', gender: 'male' },
  { id: 'daniel', label: 'Daniel', descriptor: 'Deep Male', gender: 'male' },
  { id: 'hannah', label: 'Hannah', descriptor: 'Expressive Female', gender: 'female' },
  { id: 'autumn', label: 'Autumn', descriptor: 'Warm Female', gender: 'female' },
  { id: 'diana', label: 'Diana', descriptor: 'Sharp Female', gender: 'female' },
]

export const VOICE_IDS = VOICES.map((voice) => voice.id)

export function voiceById(id) {
  return VOICES.find((voice) => voice.id === id) || VOICES[0]
}

export function stripVocalTags(text) {
  return String(text || '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Normalize a Vex line before it goes to a TTS engine.
 *
 * Screaming in ALL CAPS and stretched letters like "AHHHHHHHHHHHHHH" are great
 * on screen but TTS engines either spell them out or stumble over them. This
 * keeps the emotion (punctuation + the provider's emotion-tuned voice settings)
 * while making every word pronounceable.
 */
export function prepareForSpeech(input, { preserveEmphasis = false } = {}) {
  let text = stripVocalTags(input)

  // Emojis, markdown and stray glyphs are never spoken.
  text = text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
  text = text.replace(/[*_`#>~|]/g, '')

  // Stretch letters: "AHHHHHHHH" -> "AHH" — enough strain, still pronounceable.
  text = text.replace(/([A-Za-z])\1{2,}/g, (_, letter) => letter.repeat(3))

  // ElevenLabs treats CAPS as emphasis, so keep shouted words uppercase there.
  // Other engines spell caps out — title-case for them.
  if (!preserveEmphasis) {
    text = text.replace(/\b[A-Z]{2,}\b/g, (word) => word[0] + word.slice(1).toLowerCase())
  }

  // Keep shouting, but cap punctuation so engines don't misread it.
  // Keep a single "..." — it is a natural breath/pause cue for TTS engines.
  text = text.replace(/!{3,}/g, '!!').replace(/\?{3,}/g, '??').replace(/\.{4,}/g, '...')
  text = text.replace(/\s+([,.!?;:])/g, '$1')
  text = text.replace(/([,.!?;:])(?=[A-Za-z0-9])/g, '$1 ')
  text = text.replace(/\s+/g, ' ').trim()

  return text.slice(0, 1200)
}

/** Hard safety guard: Orpheus rejects inputs over 200 characters. */
export function truncateForOrpheus(input, max = 195) {
  let text = String(input || '').replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text

  text = text.slice(0, max)
  const lastSpace = text.lastIndexOf(' ')
  if (lastSpace > max * 0.6) text = text.slice(0, lastSpace)

  const openTag = text.lastIndexOf('[')
  if (openTag !== -1 && text.indexOf(']', openTag) === -1) {
    text = text.slice(0, openTag)
  }

  text = text.trimEnd().replace(/[,;:]$/, '.')
  return text.slice(0, max)
}

// Keep the browser fallback close to a normal speaking voice. Mood is carried
// by the words; large pitch/rate swings make the fallback sound like a parody.
const PROSODY = {
  chill: { rate: 0.98, pitch: 1.0 },
  amused: { rate: 0.99, pitch: 1.03 },
  sarcastic: { rate: 0.97, pitch: 0.98 },
  annoyed: { rate: 0.98, pitch: 0.97 },
  frustrated: { rate: 1.0, pitch: 0.95 },
  unhinged: { rate: 1.0, pitch: 0.93 },
}

const MALE_HINTS = ['guy', 'david', 'mark', 'alex', 'daniel', 'george', 'ryan', 'male', 'arthur', 'fred']
const FEMALE_HINTS = ['aria', 'zira', 'jenny', 'samantha', 'susan', 'hazel', 'female', 'hannah', 'karen', 'victoria', 'zoe']

export function isSpeechSynthesisAvailable() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
}

export function chooseBrowserVoice(voiceId) {
  if (!isSpeechSynthesisAvailable()) return null
  const voices = window.speechSynthesis.getVoices() || []
  if (!voices.length) return null

  const english = voices.filter((voice) => /^en([-_]|$)/i.test(voice.lang))
  const pool = english.length ? english : voices
  const hints = voiceById(voiceId).gender === 'male' ? MALE_HINTS : FEMALE_HINTS
  const byGender = pool.find((voice) => hints.some((hint) => voice.name.toLowerCase().includes(hint)))
  const natural = pool.find((voice) => /natural|neural|premium|enhanced/i.test(voice.name))
  return byGender || natural || pool[0] || null
}

export function cancelBrowserSpeech() {
  if (isSpeechSynthesisAvailable()) {
    try {
      window.speechSynthesis.cancel()
    } catch {
      /* some engines throw when nothing is queued */
    }
  }
}

/** Speak through the platform voice when Orpheus is unavailable. */
export function browserSpeak(text, { emotion = 'chill', voiceId = 'troy' } = {}) {
  const clean = stripVocalTags(text)
  if (!clean || !isSpeechSynthesisAvailable()) return Promise.resolve()

  return new Promise((resolve) => {
    try {
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(clean)
      const profile = PROSODY[emotion] || PROSODY.chill
      const browserVoice = chooseBrowserVoice(voiceId)

      utterance.lang = browserVoice?.lang || 'en-US'
      if (browserVoice) utterance.voice = browserVoice
      utterance.rate = profile.rate
      utterance.pitch = profile.pitch
      utterance.volume = 1

      let done = false
      const finish = () => {
        if (done) return
        done = true
        resolve()
      }
      utterance.onend = finish
      utterance.onerror = finish
      window.speechSynthesis.speak(utterance)
    } catch {
      resolve()
    }
  })
}
