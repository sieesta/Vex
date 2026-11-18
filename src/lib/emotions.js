export const EMOTION_KEYS = [
  'chill',
  'amused',
  'sarcastic',
  'annoyed',
  'frustrated',
  'unhinged',
]

export const SENTIMENT_KEYS = ['friendly', 'teasing', 'rude', 'nonsense', 'neutral']

/**
 * Every palette is a room at night: tungsten cream, burnt amber, or a hot
 * signal red. Nothing cool-toned — the studio is lit by valves and one lamp.
 */
export const EMOTION_META = {
  chill: {
    label: 'chill',
    blurb: 'unbothered',
    accent: '#e9b872',
    colors: ['#f7d9a8', '#e9b872', '#7a4a26'],
  },
  amused: {
    label: 'amused',
    blurb: 'finding this funny',
    accent: '#c8e06a',
    colors: ['#e6f2a4', '#c8e06a', '#566321'],
  },
  sarcastic: {
    label: 'sarcastic',
    blurb: 'dry as dust',
    accent: '#d9a3a0',
    colors: ['#f0cbc4', '#d9a3a0', '#6b3533'],
  },
  annoyed: {
    label: 'annoyed',
    blurb: 'brief fuse',
    accent: '#ff9f45',
    colors: ['#ffd09b', '#ff9f45', '#8a4214'],
  },
  frustrated: {
    label: 'frustrated',
    blurb: 'short fuse',
    accent: '#ff6b35',
    colors: ['#ffb07a', '#ff6b35', '#7a2410'],
  },
  unhinged: {
    label: 'unhinged',
    blurb: 'off the rails',
    accent: '#ff4136',
    colors: ['#ff8a72', '#ff4136', '#6d1512'],
  },
}

export const LISTENING_PALETTE = {
  accent: '#c8e06a',
  colors: ['#eef6c2', '#c8e06a', '#4c5a1c'],
}

export const THINKING_PALETTE = {
  accent: '#f6c177',
  colors: ['#ffe6b8', '#f6c177', '#8a5a1e'],
}

export const SENTIMENT_META = {
  friendly: { label: 'friendly', color: '#a8d98a', icon: 'Heart', note: 'warm signal' },
  teasing: { label: 'teasing', color: '#f6c177', icon: 'Smile', note: 'playful jab' },
  rude: { label: 'rude', color: '#ff7a5c', icon: 'Flame', note: 'hostile input' },
  nonsense: { label: 'nonsense', color: '#d9a3a0', icon: 'Sparkles', note: 'low coherence' },
  neutral: { label: 'neutral', color: '#a8967d', icon: 'Minus', note: 'no strong signal' },
}

export const AGENT_STATES = ['IDLE', 'LISTENING', 'THINKING', 'SPEAKING']

export const STATE_META = {
  IDLE: { label: 'idle', note: 'line open', color: '#a8967d' },
  LISTENING: { label: 'listening', note: 'mic open', color: '#c8e06a' },
  THINKING: { label: 'thinking', note: 'signal processing', color: '#f6c177' },
  SPEAKING: { label: 'speaking', note: 'voice out', color: '#ff6b35' },
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

/**
 * Bands have an entry and an exit threshold. A mood only changes when the
 * score clearly crosses the exit point, so a borderline score can't flip the
 * orb (and the few-shot examples) between calm and meltdown every other turn.
 */
const BANDS = [
  { key: 'unhinged', enter: 88, exit: 80 },
  { key: 'frustrated', enter: 70, exit: 62 },
  { key: 'annoyed', enter: 55, exit: 47 },
  { key: 'sarcastic', enter: 38, exit: 31 },
  { key: 'amused', enter: 20, exit: 14 },
]

export function emotionFromFrustration(score, currentEmotion) {
  const value = clamp(Number(score) || 0, 0, 100)
  const held = currentEmotion && BANDS.find((band) => band.key === currentEmotion)
  if (held && value >= held.exit) return held.key
  for (const band of BANDS) {
    if (value >= band.enter) return band.key
  }
  return 'chill'
}

/**
 * Frustration cools down between turns instead of sticking at a meltdown for
 * the rest of the call. Friendly input cools faster; a long pause cools a
 * little so an old argument doesn't dictate the next reply.
 */
export function applyFrustrationDecay(score, { sentiment = 'neutral', elapsedMs = 0 } = {}) {
  let cooled = clamp(Number(score) || 0, 0, 100)
  if (sentiment === 'friendly' || sentiment === 'teasing') cooled -= 3
  else cooled -= 1.5
  if (elapsedMs >= 30_000) cooled -= Math.min(4, Math.floor(elapsedMs / 30_000) * 2)
  return Math.round(clamp(cooled, 0, 100))
}

export function emotionMeta(emotion) {
  return EMOTION_META[emotion] || EMOTION_META.chill
}

export function sentimentMeta(sentiment) {
  return SENTIMENT_META[sentiment] || SENTIMENT_META.neutral
}
