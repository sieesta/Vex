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
 * True when the line contains a sustained vowel run like "AHHHHHHHHH!!!".
 * Only those need the special shout treatment; ordinary caps do not.
 */
export function hasLongShout(text) {
  const value = String(text || '')
  return (
    /([A-Za-z])([A-Za-z])\2{3,}(!+)/.test(value) || // AHHHHHHHHH!!!
    /([A-Za-z])([A-Za-z])\2,\s*\1\2{2}!!/.test(value) || // AHH, AHH!!
    /([A-Za-z])([A-Za-z])\2\.\.\.\s*\1\2{2}!!/.test(value) // AHH... AHH!!
  )
}

/**
 * Normalize a Vex line before it goes to a TTS engine.
 *
 * Screaming in ALL CAPS and stretched letters like "AHHHHHHHHHHHHHH" are great
 * on screen but TTS engines either spell them out or stumble over them. This
 * keeps the emotion (punctuation + the provider's emotion-tuned voice settings)
 * while making every word pronounceable.
 */
export function prepareForSpeech(input, { preserveEmphasis = false, preserveStretch = false } = {}) {
  let text = stripVocalTags(input)

  // Emojis, markdown and stray glyphs are never spoken.
  text = text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
  text = text.replace(/[*_`#>~|]/g, '')

  if (!preserveStretch) {
    // A real long shout is not one flat robot scream. Give it a breath:
    // "AHHHHHHHHH!!!" -> "AHH, AHH!!". The comma becomes a short pause in every
    // engine, so the voice sounds like it caught a breath between the two bursts.
    text = text.replace(
      /([A-Za-z])([A-Za-z])\2{3,}(!+)/g,
      (_, first, vowel, bangs) => `${first}${vowel.repeat(2)}, ${first}${vowel.repeat(2)}${bangs.slice(0, 2)}`,
    )

    // Ordinary stretches: "AHHHHHHHH" -> "AHH" — enough strain, still pronounceable.
    text = text.replace(/([A-Za-z])\1{2,}/g, (_, letter) => letter.repeat(3))
  }
  // Earned meltdowns keep every vowel and get as long as the engine allows.

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

  return text.slice(0, 5000)
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

// The mascot is a small, bright creature: higher pitch, quick but still clear.
// Mood shifts the colour slightly; the words still do most of the emotional work.
const PROSODY = {
  chill: { rate: 1.04, pitch: 1.2 },
  amused: { rate: 1.06, pitch: 1.24 },
  sarcastic: { rate: 1.02, pitch: 1.18 },
  annoyed: { rate: 1.05, pitch: 1.16 },
  frustrated: { rate: 1.06, pitch: 1.14 },
  unhinged: { rate: 1.07, pitch: 1.12 },
}

const BRIGHT_HINTS = [
  'jenny', 'aria', 'zira', 'samantha', 'female', 'hazel', 'susan', 'karen',
  'zoe', 'lily', 'michelle', 'ana', 'rosa', 'clara', 'emma',
]

export function isSpeechSynthesisAvailable() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
}

export function chooseBrowserVoice(voiceId, { lang = 'en-US' } = {}) {
  if (!isSpeechSynthesisAvailable()) return null
  const voices = window.speechSynthesis.getVoices() || []
  if (!voices.length) return null

  const base = String(lang || 'en-US').split('-')[0].toLowerCase()
  const sameLanguage = voices.filter((voice) => String(voice.lang).toLowerCase().startsWith(`${base}-`))
  const english = voices.filter((voice) => /^en([-_]|$)/i.test(voice.lang))
  const pool = sameLanguage.length ? sameLanguage : english.length ? english : voices

  // The mascot is small and bright: prefer the higher, younger-sounding voice
  // the platform offers, then fall back to anything natural or neural.
  const bright = pool.find((voice) => BRIGHT_HINTS.some((hint) => voice.name.toLowerCase().includes(hint)))
  const natural = pool.find((voice) => /natural|neural|premium|enhanced/i.test(voice.name))
  return bright || natural || pool[0] || null
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
export function browserSpeak(text, { emotion = 'chill', voiceId = 'troy', lang = 'en-US' } = {}) {
  const clean = stripVocalTags(text)
  if (!clean || !isSpeechSynthesisAvailable()) return Promise.resolve()

  return new Promise((resolve) => {
    try {
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(clean)
      const profile = PROSODY[emotion] || PROSODY.chill
      const browserVoice = chooseBrowserVoice(voiceId, { lang })

      utterance.lang = browserVoice?.lang || lang
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
