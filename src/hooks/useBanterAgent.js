import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { clamp, EMOTION_KEYS, emotionFromFrustration, SENTIMENT_KEYS } from '../lib/emotions'
import { buildSystemPrompt, offlineAgentReply, parseAgentResponse } from '../lib/persona'
import { createAudioMeter } from '../lib/audioMeter'
import { generateGroqChat } from '../lib/groq'
import { EMPTY_VOICE_CONFIG, loadVoiceConfig } from '../lib/keySource'
import { makeKeyRecord, summarizePool } from '../lib/keyPool'
import { generateGeminiChat, generateGeminiSpeech } from '../lib/geminiTts'
import { generateElevenLabsSpeech } from '../lib/voiceProviders'
import { cancelBrowserSpeech, stripVocalTags } from '../lib/speech'
import { useLocalStorageState } from './useLocalStorage'
import { buildSearchUrl, localSearchAction, preopenTab, runWebAction } from '../lib/webActions'

const MAX_MESSAGES = 40
const MAX_CONTEXT_MESSAGES = 12
const SILENCE_MS = 1400
// How long Vex waits before checking in on a quiet caller.
const IDLE_NUDGE_MS = 60_000
// Earned meltdowns — only after the caller repeats themselves three times in
// a row. Variants rotate so Vex never sounds like a broken record. Stretches
// are preserved and voiced at full length.
const MELTDOWN_LINES = [
  '[shouting] AHHH!! [crying] Ayaw ko na... makipag-usap sa\'yo... [sighs] FUCK.',
  '[shouting] WALLA KAA BANG!!! [crying] Sasabihigg matinoooo?... [sighs] Fuckkkkkkk.',
]

// Gemini has no audio tags. Its SDK sends performance direction as part
// metadata instead, so the same emotion lands on both engines.
const MELTDOWN_STYLE =
  'Distraught and angry Filipino accent. Start with a loud scream of frustration, then drop into a shaky, breathless, exhausted tone with heavy pauses.'
const NAME_WELCOME_STYLE =
  'Playful teasing Filipino friend. Say the insult jokingly, laugh big, then switch warm and friendly.'
const INITIAL_REPLY = '[shouting] HOYYY! GISING!... magsalita ka naman [sighs].'
const INITIAL_LATENCY = {
  llmMs: null,
  ttsMs: null,
  engine: '—',
  llmEngine: 'idle',
  ttsMode: 'idle',
}
const EMPTY_SPECTRUM = Array(32).fill(0)
const LANGUAGE_META = {
  taglish: { recognition: 'fil-PH', browser: 'fil-PH' },
  tagalog: { recognition: 'fil-PH', browser: 'fil-PH' },
  english: { recognition: 'en-US', browser: 'en-US' },
  japanese: { recognition: 'ja-JP', browser: 'ja-JP' },
  korean: { recognition: 'ko-KR', browser: 'ko-KR' },
  spanish: { recognition: 'es-ES', browser: 'es-ES' },
}

const validMessages = (value) =>
  Array.isArray(value) &&
  value.every((item) => item && typeof item.role === 'string' && typeof item.content === 'string')

const EMPTY_MEMORY = Object.freeze({ name: '', facts: [] })
const validMemory = (value) =>
  value &&
  typeof value === 'object' &&
  typeof value.name === 'string' &&
  Array.isArray(value.facts) &&
  value.facts.every((fact) => typeof fact === 'string')

/** Merge new facts without inventing or duplicating anything. */
function mergeMemory(current, additions = []) {
  let name = current?.name || ''
  const facts = Array.isArray(current?.facts) ? [...current.facts] : []
  for (const item of additions) {
    const fact = String(item || '').replace(/\s+/g, ' ').trim().slice(0, 90)
    if (!fact) continue
    const named = /\b(?:their name is|name is|my name is|call me)\s+([A-Za-z][\w'-]{1,20})\b/i.exec(fact)
    if (named && !name) name = named[1]
    const lower = fact.toLowerCase()
    if (facts.some((existing) => existing.toLowerCase() === lower || lower.includes(existing.toLowerCase()))) continue
    facts.push(fact)
  }
  return { name, facts: facts.slice(-12) }
}

function repeatKey(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/** True when the caller has now sent the exact same line three times running. */
function isThirdRepeat(text, messages) {
  const previous = (messages || []).filter((message) => message.role === 'user').map((message) => repeatKey(message.content))
  if (previous.length < 2) return false
  const current = repeatKey(text)
  return current === previous[previous.length - 1] && current === previous[previous.length - 2]
}

/** A name said out loud is always remembered, even if the model omits "remember". */
function nameFromCaller(text) {
  const match = /\b(?:my name is|call me|i'm|i am|ako si|pangalan ko si)\s+([A-Za-z][\w'-]{1,20})\b/i.exec(
    String(text || ''),
  )
  if (!match) return null
  const candidate = match[1]
  const notAName = /^(not|gonna|kinda|sorta|just|really|trying|sorry|okay|fine|here|there|the|a)$/i
  if (notAName.test(candidate)) return null
  return `Their name is ${candidate}`
}

/** Guarantee an await can never hang the FSM in THINKING, even if a provider
 * ignores its AbortSignal. Rejects on timeout so the turn always continues. */
function withHardTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error(`${label} timed out`)
      error.name = 'TimeoutError'
      reject(error)
    }, ms)
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function playAudioElement(audio) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      audio.onended = null
      audio.onerror = null
      if (error) reject(error)
      else resolve()
    }

    audio.onended = () => finish()
    audio.onerror = () => finish(new Error('Audio playback failed'))
    const attempt = audio.play()
    if (attempt && typeof attempt.catch === 'function') attempt.catch(finish)
  })
}

function makeId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * The full affective conversation engine: finite state machine, cumulative
 * frustration model, Gemini LLM, prioritized voice providers, browser fallbacks and barge-in.
 */
export function useBanterAgent({ voice, spiceMode, handsFree, delivery = 0, ttsProvider = 'elevenlabs' }) {
  const [keyPool, setKeyPool] = useState([])
  const [voiceConfig, setVoiceConfig] = useState(EMPTY_VOICE_CONFIG)
  const [agentState, setAgentState] = useState('IDLE')
  const [frustration, setFrustration] = useLocalStorageState(
    'vex.v1.frustration',
    15,
    (value) => Number.isFinite(value) && value >= 0 && value <= 100,
  )
  const [emotion, setEmotion] = useLocalStorageState(
    'vex.v1.emotion',
    'chill',
    (value) => EMOTION_KEYS.includes(value),
  )
  const [sentiment, setSentiment] = useLocalStorageState(
    'vex.v1.sentiment',
    'neutral',
    (value) => SENTIMENT_KEYS.includes(value),
  )
  const [messages, setMessages] = useLocalStorageState('vex.v1.messages', [], validMessages)
  const [memory, setMemory] = useLocalStorageState('vex.v1.memory', EMPTY_MEMORY, validMemory)
  const [lastReply, setLastReply] = useLocalStorageState('vex.v1.lastReply', INITIAL_REPLY)
  const [interimTranscript, setInterimTranscript] = useState('')
  const [captionWords, setCaptionWords] = useState([])
  const [activeWord, setActiveWord] = useState(-1)
  const [latency, setLatency] = useState(INITIAL_LATENCY)
  const [notice, setNotice] = useState(null)
  const [audioLevel, setAudioLevel] = useState(0)
  const [spectrum, setSpectrum] = useState(EMPTY_SPECTRUM)
  const [searchLink, setSearchLink] = useState(null)
  const [webAction, setWebAction] = useState(null)
  const [lastActivityAt, setLastActivityAt] = useState(Date.now())
  const languageMode = 'taglish'
  const filipinoVoiceGender = 'male'
  const setLanguageMode = () => {}
  const setFilipinoVoiceGender = () => {}

  const SpeechRecognitionImpl = useMemo(() => {
    if (typeof window === 'undefined') return null
    return window.SpeechRecognition || window.webkitSpeechRecognition || null
  }, [])
  const [speechUnavailable, setSpeechUnavailable] = useState(false)
  const speechNoticeRef = useRef(false)
  const recognitionSupported = Boolean(SpeechRecognitionImpl) && !speechUnavailable

  const agentStateRef = useRef('IDLE')
  const frustrationRef = useRef(frustration)
  const emotionRef = useRef(emotion)
  const messagesRef = useRef(messages)
  const memoryRef = useRef(memory)
  const settingsRef = useRef({
    voice,
    spiceMode,
    handsFree,
    delivery,
    ttsProvider,
    languageMode,
    filipinoVoiceGender,
  })
  settingsRef.current = {
    voice,
    spiceMode,
    handsFree,
    delivery,
    ttsProvider,
    languageMode,
    filipinoVoiceGender,
  }
  const lastTurnAtRef = useRef(Date.now())

  const poolRef = useRef(keyPool)
  const configRef = useRef(EMPTY_VOICE_CONFIG)

  const audioRef = useRef(null)
  const meterRef = useRef(null)
  const audioUrlRef = useRef(null)
  const recognitionRef = useRef(null)
  const transcriptRef = useRef('')
  const finalTranscriptRef = useRef('')
  const committedRef = useRef(false)
  const listenSessionRef = useRef(0)
  const speechSessionRef = useRef(0)
  const turnSeqRef = useRef(0)
  const llmAbortRef = useRef(null)
  const ttsAbortRef = useRef(null)
  const searchTabRef = useRef(null)
  const webActionTimerRef = useRef(null)
  const silenceTimerRef = useRef(null)
  const autoListenTimerRef = useRef(null)
  const idleTimerRef = useRef(null)
  const lastActivityRef = useRef(Date.now())
  const lastNudgeRef = useRef(0)
  const meltdownCursorRef = useRef(0)
  const idleNudgeRef = useRef(null)
  const mountedRef = useRef(true)
  const offlineReplyRef = useRef('')

  function phase(next) {
    if (agentStateRef.current === next) return
    agentStateRef.current = next
    setAgentState(next)
  }

  function pushNotice(message, tone = 'warning', ttl = 9000) {
    setNotice({ id: makeId(), message, tone, ttl })
  }

  function noteActivity() {
    const now = Date.now()
    lastActivityRef.current = now
    setLastActivityAt(now)
  }

  // The mascot's laptop scene is short-lived: it borrows the same action that
  // opens the real tab, then hands control back to the idle pose.
  function showWebAction(action, phase = 'opening') {
    if (!action) return
    const id = makeId()
    if (webActionTimerRef.current) clearTimeout(webActionTimerRef.current)
    setWebAction({ platform: action.platform, query: action.query, phase, id })
    webActionTimerRef.current = setTimeout(() => {
      webActionTimerRef.current = null
      setWebAction((current) => (current?.id === id ? null : current))
    }, phase === 'blocked' ? 6000 : 1900)
  }

  function dismissWebAction() {
    if (webActionTimerRef.current) clearTimeout(webActionTimerRef.current)
    webActionTimerRef.current = null
    setWebAction(null)
  }

  function clearAutoListen() {
    if (autoListenTimerRef.current) clearTimeout(autoListenTimerRef.current)
    autoListenTimerRef.current = null
  }

  /* ------------------------- studio lines + failover ------------------------- */

  const commitPool = useCallback(
    (next) => {
      poolRef.current = next
      setKeyPool(next)
    },
    [setKeyPool],
  )

  useEffect(() => {
    let alive = true
    loadVoiceConfig().then((config) => {
      if (!alive) return
      configRef.current = config
      setVoiceConfig(config)
      if (poolRef.current.length) return
      const records = config.groq.map((key, index) => makeKeyRecord(key, index, makeId()))
      commitPool(records)
    })
    return () => {
      alive = false
    }
  }, [commitPool])

  function patchEntry(id, patch) {
    const next = poolRef.current.map((entry) =>
      entry.id === id ? { ...entry, ...patch } : entry,
    )
    commitPool(next)
  }

  function usableEntry(entry, now = Date.now()) {
    if (!entry) return false
    if (entry.status === 'invalid' || entry.status === 'exhausted') return false
    if (entry.status === 'cooldown') return !entry.cooldownUntil || entry.cooldownUntil <= now
    return true
  }

  function keyStatusFor(error) {
    const status = Number(error?.status)
    if (status === 401 || status === 403) {
      return { status: 'invalid', cooldownUntil: null }
    }
    if (status === 429) {
      const detail = String(error?.detail || error?.message || '')
      const daily = /(per day|rpd|daily|tpd|tokens per day|quota)/i.test(detail)
      if (daily) return { status: 'exhausted', cooldownUntil: null }
      const seconds = Math.max(20, Math.min(900, Number(error?.retryAfter) || 60))
      return { status: 'cooldown', cooldownUntil: Date.now() + seconds * 1000 }
    }
    return null
  }

  async function runGroqChat({ systemInstruction, history, deadline = Infinity }) {
    const config = configRef.current
    const entries = poolRef.current.filter((entry) => usableEntry(entry))
    if (!entries.length) throw new Error('No studio line is available.')

    let lastError
    for (const entry of entries) {
      const remaining = deadline - performance.now()
      if (remaining < 1200) break
      try {
        const content = await withHardTimeout(
          generateGroqChat({
            key: entry.key,
            model: config.groqChatModel,
            systemInstruction,
            history,
          }),
          Math.min(5000, remaining),
          'Groq chat',
        )
        patchEntry(entry.id, {
          status: 'active',
          cooldownUntil: null,
          requestsUsed: (entry.requestsUsed || 0) + 1,
          lastUsedAt: Date.now(),
        })
        return content
      } catch (error) {
        if (error?.name === 'AbortError') throw error
        lastError = error
        const patch = keyStatusFor(error)
        if (patch) patchEntry(entry.id, patch)
        // A timeout or model hiccup is not the line's fault; try the next one.
      }
    }

    throw lastError || new Error('No studio line is available.')
  }

  function appendMessage(message) {
    const entry = { id: makeId(), at: Date.now(), ...message }
    const next = [...messagesRef.current, entry].slice(-MAX_MESSAGES)
    messagesRef.current = next
    setMessages(next)
    return entry
  }

  function updateMood(nextFrustration, nextEmotion) {
    frustrationRef.current = nextFrustration
    setFrustration(nextFrustration)
    if (nextEmotion) {
      emotionRef.current = nextEmotion
      setEmotion(nextEmotion)
    }
  }

  function ensureAudioElement() {
    if (!audioRef.current && typeof Audio !== 'undefined') {
      const element = new Audio()
      element.preload = 'auto'
      audioRef.current = element
    }
    return audioRef.current
  }

  function ensureMeter() {
    if (!meterRef.current) meterRef.current = createAudioMeter()
    return meterRef.current
  }

  function primeAudio() {
    try {
      const audio = ensureAudioElement()
      const meter = ensureMeter()
      meter.attach(audio)
      meter.resume()
    } catch {
      /* AudioContext unavailable — browser TTS still works */
    }
  }

  function stopPlayback() {
    speechSessionRef.current += 1
    cancelBrowserSpeech()

    if (ttsAbortRef.current) {
      ttsAbortRef.current.abort()
      ttsAbortRef.current = null
    }

    const audio = audioRef.current
    if (audio) {
      try {
        audio.pause()
        audio.dispatchEvent(new Event('ended')) // settle any pending play() promise
      } catch {
        /* no-op */
      }
      audio.onended = null
      audio.onerror = null
      try {
        audio.removeAttribute('src')
        audio.load()
      } catch {
        /* no-op */
      }
    }

    meterRef.current?.stop()
    setAudioLevel(0)
    setSpectrum(EMPTY_SPECTRUM)

    if (audioUrlRef.current) {
      try {
        URL.revokeObjectURL(audioUrlRef.current)
      } catch {
        /* no-op */
      }

      audioUrlRef.current = null
    }
  }

  function stopRecognition() {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
    silenceTimerRef.current = null
    listenSessionRef.current += 1

    const recognition = recognitionRef.current
    recognitionRef.current = null
    if (recognition) {
      recognition.onstart = null
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
      try {
        recognition.abort()
      } catch {
        /* already stopped */
      }
    }
  }

  function scheduleCommit(session) {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
    silenceTimerRef.current = setTimeout(() => {
      if (session !== listenSessionRef.current) return
      const text = transcriptRef.current.trim()
      if (!text) return
      committedRef.current = true
      stopRecognition()
      setInterimTranscript('')
      submitTurn(text)
    }, SILENCE_MS)
  }

  function beginListening() {
    if (!recognitionSupported) {
      phase('IDLE')
      if (!speechNoticeRef.current) {
        speechNoticeRef.current = true
        pushNotice(
          'Mic unavailable — use the text bar below.',
          'warning',
          7000,
        )
      }
      return
    }

    stopPlayback()
    stopRecognition()
    clearAutoListen()

    const session = ++listenSessionRef.current
    let recognition
    try {
      recognition = new SpeechRecognitionImpl()
    } catch {
      phase('IDLE')
      pushNotice('The microphone could not start. Use the text bar instead.', 'warning')
      return
    }

    recognitionRef.current = recognition
    transcriptRef.current = ''
    finalTranscriptRef.current = ''
    committedRef.current = false
    setInterimTranscript('')
    phase('LISTENING')

    recognition.lang = LANGUAGE_META[settingsRef.current.languageMode]?.recognition || 'fil-PH'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    recognition.onstart = () => {
      if (session === listenSessionRef.current) phase('LISTENING')
    }

    recognition.onresult = (event) => {
      if (session !== listenSessionRef.current) return
      let interim = ''
      let final = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        if (!result?.[0]) continue
        if (result.isFinal) final += result[0].transcript
        else interim += result[0].transcript
      }

      if (final) finalTranscriptRef.current = `${finalTranscriptRef.current} ${final}`.trim()
      const combined = `${finalTranscriptRef.current} ${interim}`.replace(/\s+/g, ' ').trim()
      transcriptRef.current = combined
      setInterimTranscript(combined)
      scheduleCommit(session)
    }

    recognition.onerror = (event) => {
      if (session !== listenSessionRef.current) return
      const reason = event.error
      if (reason === 'aborted' || reason === 'no-speech') return
      stopRecognition()
      setInterimTranscript('')
      phase('IDLE')
      if (speechNoticeRef.current) return
      speechNoticeRef.current = true
      if (reason === 'not-allowed' || reason === 'service-not-allowed') {
        setSpeechUnavailable(true)
        pushNotice('Mic blocked — allow it in your browser, or just use the text bar.', 'error', 7000)
      } else if (reason === 'network') {
        // A tunnel/offline browser can fail this on every auto-listen attempt.
        // Disable mic retries after the first failure and tell the user once.
        setSpeechUnavailable(true)
        pushNotice(
          'Mic service unavailable here — text bar still works. Type instead of speaking.',
          'warning',
          7000,
        )
      } else {
        pushNotice(`Microphone error (${reason}). You can keep using the text bar.`, 'warning', 9000)
      }
    }

    recognition.onend = () => {
      if (session !== listenSessionRef.current) return
      recognitionRef.current = null
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null

      const text = transcriptRef.current.trim()
      if (text && !committedRef.current) {
        committedRef.current = true
        setInterimTranscript('')
        submitTurn(text)
      } else if (agentStateRef.current === 'LISTENING') {
        setInterimTranscript('')
        phase('IDLE')
      }
    }

    try {
      recognition.start()
    } catch {
      recognitionRef.current = null
      phase('IDLE')
      pushNotice('The microphone could not start. Use the text bar instead.', 'warning')
    }
  }

  async function speakReply(
    text,
    emotion,
    turn,
    preloadedBlob = null,
    onReady = null,
    preloadedProvider = 'Gemini TTS',
    words = [],
  ) {
    const session = ++speechSessionRef.current
    const started = performance.now()
    let wordFrame = 0

    const isCurrent = () =>
      session === speechSessionRef.current &&
      turn === turnSeqRef.current &&
      mountedRef.current

    const markReady = () => {
      if (!isCurrent()) return false
      onReady?.()
      phase('SPEAKING')
      return true
    }

    const finish = () => {
      if (!isCurrent()) return
      if (wordFrame) cancelAnimationFrame(wordFrame)
      wordFrame = 0
      setActiveWord(-1)
      meterRef.current?.stop()
      setAudioLevel(0)
      setSpectrum(EMPTY_SPECTRUM)

      const autoListen = recognitionSupported && settingsRef.current.handsFree
      phase(autoListen ? 'LISTENING' : 'IDLE')

      if (autoListen) {
        clearAutoListen()
        autoListenTimerRef.current = setTimeout(() => {
          if (agentStateRef.current === 'LISTENING' && settingsRef.current.handsFree) {
            beginListening()
          }
        }, 520)
      }
    }

    if (!preloadedBlob) {
      // No TTS audio: still show Vex's line immediately, then return to idle.
      if (!isCurrent()) return
      onReady?.()
      setLatency((previous) => ({
        ...previous,
        ttsMs: 0,
        engine: '—',
        ttsMode: 'unavailable',
      }))
      finish()
      return
    }

    const blob = preloadedBlob
    if (!isCurrent()) return
    setLatency((previous) => ({
      ...previous,
      ttsMs: previous.ttsMs || Math.round(performance.now() - started),
      engine: preloadedProvider,
      ttsMode: 'native-audio',
    }))

    try {
      const url = URL.createObjectURL(blob)
      audioUrlRef.current = url
      const audio = ensureAudioElement()
      const meter = ensureMeter()
      meter.attach(audio)
      meter.resume()
      audio.src = url

      let lastFrame = 0
      meter.start(({ level, bins }) => {
        if (!mountedRef.current) return
        const now = performance.now()
        if (now - lastFrame < 45) return // ~22fps state updates; CSS smooths the rest
        lastFrame = now
        setAudioLevel(level)
        setSpectrum(bins)
      })

      if (!markReady()) return
      // Follow Edge's word boundaries so the caption lights up with the voice.
      if (words.length) {
        let lastWord = -1
        const tickWords = () => {
          if (!mountedRef.current || session !== speechSessionRef.current || turn !== turnSeqRef.current) {
            if (wordFrame) cancelAnimationFrame(wordFrame)
            wordFrame = 0
            return
          }
          const time = audio.currentTime || 0
          let index = -1
          for (let i = 0; i < words.length; i += 1) {
            if (time >= words[i].offset - 0.03) index = i
            else break
          }
          if (index !== lastWord) {
            lastWord = index
            setActiveWord(index)
          }
          wordFrame = requestAnimationFrame(tickWords)
        }
        wordFrame = requestAnimationFrame(tickWords)
      }
      // Never let a stalled playback (autoplay policy, muted tab, headless)
      // block the rest of the turn — e.g. opening the requested search tab.
      const playLimit = Math.max(5000, Math.min(45000, text.length * 220))
      await Promise.race([
        playAudioElement(audio).catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, playLimit)),
      ])
      meter.stop()
      if (audioUrlRef.current === url) {
        URL.revokeObjectURL(url)
        audioUrlRef.current = null
      }
      audio.removeAttribute('src')
      try {
        audio.load()
      } catch {
        /* no-op */
      }
      finish()
    } catch {
      if (wordFrame) cancelAnimationFrame(wordFrame)
      wordFrame = 0
      setActiveWord(-1)
      meterRef.current?.stop()
      setAudioLevel(0)
      setSpectrum(EMPTY_SPECTRUM)
      if (audioUrlRef.current) {
        try {
          URL.revokeObjectURL(audioUrlRef.current)
        } catch {
          /* no-op */
        }
        audioUrlRef.current = null
      }
      if (!isCurrent()) return
      setLatency((previous) => ({ ...previous, engine: '—', ttsMode: 'playback-error' }))
      pushNotice('Audio playback failed. The reply is still on screen.', 'warning', 8000)
      finish()
    }
  }

  /**
   * Turn a line into audio with the same provider order everywhere: ElevenLabs
   * first, Gemini as the safety net. Used by normal turns and idle check-ins.
   */
  async function synthesizeLine(
    text,
    { emotion = 'chill', intensity = 0, preserveStretch = false, preserveEmphasis = false, forceShout = false, preserveTags = false, style = '' } = {},
  ) {
    const config = configRef.current
    const eleven =
      config.elevenlabs.length && config.elevenlabsVoiceId
        ? {
            name: 'ElevenLabs',
            timeoutMs: 9000,
            run: (options) =>
              generateElevenLabsSpeech(text, {
                keys: config.elevenlabs,
                voiceId: config.elevenlabsVoiceId,
                voiceIds: config.elevenlabsVoiceIds,
                model: config.elevenlabsModel,
                emotion: options.emotion,
                intensity: options.intensity,
                preserveStretch: options.preserveStretch,
                forceShout: options.forceShout,
                preserveTags: options.preserveTags,
                abortSignal: options.abortSignal,
              }),
          }
        : null

    const gemini =
      config.gemini.length > 0
        ? {
            name: 'Gemini TTS',
            timeoutMs: 12000,
            run: (options) =>
              generateGeminiSpeech(text, {
                keys: config.gemini,
                model: config.geminiTtsModel,
                voice: config.geminiTtsVoice,
                languageMode: settingsRef.current.languageMode,
                intensity: options.intensity,
                preserveStretch: options.preserveStretch,
                preserveEmphasis: options.preserveEmphasis,
                style: options.style,
                abortSignal: options.abortSignal,
              }),
          }
        : null

    // The caller's Brain-panel choice decides who speaks first; the other
    // engine stays as the safety net if the preferred one is unavailable.
    const preferred = settingsRef.current.ttsProvider
    const providers =
      preferred === 'gemini' ? [gemini, eleven].filter(Boolean) : [eleven, gemini].filter(Boolean)
    if (!providers.length) return { audio: null, provider: undefined }

    const ttsStarted = performance.now()
    const ttsDeadline = ttsStarted + 11000
    for (const provider of providers) {
      const remaining = ttsDeadline - performance.now()
      if (remaining < 1500) break
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), provider.timeoutMs)
      try {
        const audio = await withHardTimeout(
          provider.run({
            emotion,
            intensity,
            preserveStretch,
            preserveEmphasis,
            forceShout,
            preserveTags,
            style,
            abortSignal: controller.signal,
          }),
          Math.max(1500, Math.min(provider.timeoutMs + 2000, ttsDeadline - performance.now())),
          provider.name,
        )
        setLatency((previous) => ({ ...previous, ttsMs: Math.round(performance.now() - ttsStarted) }))
        return { audio, provider: provider.name }
      } catch {
        // Silent failover — the next voice line gets the turn.
      } finally {
        clearTimeout(timeout)
      }
    }
    setLatency((previous) => ({ ...previous, ttsMs: Math.round(performance.now() - ttsStarted) }))
    return { audio: null, provider: undefined }
  }

  const IDLE_LINES = [
    "Still there? Don't leave me hangin', ha.",
    'Hello? Earth to you…',
    'Okay, I\'m just here. No pressure.',
    'Seryoso ka na ba, o natulog ka na?',
    'Ayos lang. Hintay lang kita.',
  ]

  async function idleNudge() {
    if (!mountedRef.current || agentStateRef.current !== 'IDLE') return
    if (Date.now() - lastActivityRef.current < IDLE_NUDGE_MS) return
    if (Date.now() - lastNudgeRef.current < IDLE_NUDGE_MS * 2) return
    if (!messagesRef.current.length) return

    const turn = turnSeqRef.current
    const name = memoryRef.current.name
    const system =
      'You are VEX, a real friend on a voice call. The caller has gone quiet. ' +
      'Write ONE short Taglish line checking in — warm, lightly teasing, at most 90 characters. ' +
      'No greetings, no questions about help, no emojis. ' +
      (name ? `Their name is ${name}. Use it naturally.\n` : '') +
      'Reply ONLY with JSON: {"spoken":"your line here"}'

    const pickLine = (content) => {
      const match = /"spoken"\s*:\s*"([^"\\]{3,120})"/.exec(String(content || ''))
      return match ? match[1] : null
    }

    let spoken = null
    const config = configRef.current
    const entries = poolRef.current.filter((entry) => usableEntry(entry))
    for (const entry of entries.slice(0, 2)) {
      try {
        const content = await withHardTimeout(
          generateGroqChat({
            key: entry.key,
            systemInstruction: system,
            history: [],
            deadline: performance.now() + 2500,
          }),
          3000,
          'Idle check-in',
        )
        spoken = pickLine(content)
        if (spoken) break
      } catch {
        /* try the next line */
      }
    }
    if (!spoken && config.gemini.length) {
      try {
        const content = await withHardTimeout(
          generateGeminiChat({
            keys: config.gemini,
            model: config.geminiChatModel,
            systemInstruction: system,
            history: [],
          }),
          3000,
          'Idle check-in',
        )
        spoken = pickLine(content)
      } catch {
        /* local fallback below */
      }
    }
    if (!spoken) spoken = IDLE_LINES[Math.floor(Math.random() * IDLE_LINES.length)]

    // If the caller came back while we were writing, drop the nudge.
    if (turn !== turnSeqRef.current || !mountedRef.current || agentStateRef.current !== 'IDLE') return

    const display = stripVocalTags(spoken)
    const speech = await synthesizeLine(spoken, { emotion: 'chill', intensity: 0 })
    if (turn !== turnSeqRef.current || !mountedRef.current) return

    lastNudgeRef.current = Date.now()
    setLastReply(display)
    appendMessage({
      role: 'assistant',
      content: spoken,
      display,
      emotion: 'chill',
      sentiment: 'neutral',
      idle: true,
    })
    await speakReply(spoken, 'chill', turn, speech.audio, null, speech.provider, [])
    noteActivity()
  }

  function localReply(text, settings) {
    const recentReplies = messagesRef.current
      .filter((message) => message.role === 'assistant')
      .map((message) => message.content)
    let result = offlineAgentReply(text, {
      frustration: frustrationRef.current,
      spiceMode: settings.spiceMode,
      deliveryLimit: settings.delivery,
      seed: messagesRef.current.length,
      recentReplies,
    })
    if (result.spoken === offlineReplyRef.current) {
      result = offlineAgentReply(text, {
        frustration: frustrationRef.current,
        spiceMode: settings.spiceMode,
        deliveryLimit: settings.delivery,
        seed: messagesRef.current.length + 1,
        recentReplies: [...recentReplies, offlineReplyRef.current],
      })
    }
    offlineReplyRef.current = result.spoken
    return result
  }

  async function submitTurn(rawText) {
    const text = String(rawText || '').replace(/\s+/g, ' ').trim()
    if (!text) return

    const meltdown = isThirdRepeat(text, messagesRef.current)
    const newNameFact = nameFromCaller(text)
    const nameGreeting = Boolean(newNameFact && !memoryRef.current.name)
    noteActivity()
    primeAudio()
    stopPlayback()
    stopRecognition()
    clearAutoListen()
    setInterimTranscript('')
    phase('THINKING')
    setLatency((previous) => ({
      ...previous,
      llmMs: null,
      ttsMs: null,
      engine: '—',
      llmEngine: 'thinking',
      ttsMode: 'waiting',
    }))

    const turn = ++turnSeqRef.current
    const settings = settingsRef.current
    const userMessage = { role: 'user', content: text }
    const history = [...messagesRef.current, userMessage]
      .slice(-MAX_CONTEXT_MESSAGES)
      .map((message) => ({ role: message.role, content: message.content }))
    appendMessage(userMessage)

    const started = performance.now()
    let result

    const config = configRef.current
    const canGroq = config.groq.length > 0 && poolRef.current.length > 0
    const canGemini = config.gemini.length > 0

    if (meltdown) {
      // Three identical messages in a row earns the one long, uncut meltdown.
      // No model call — the line and its timing are deliberate, never random.
      const meltdownLine = MELTDOWN_LINES[meltdownCursorRef.current % MELTDOWN_LINES.length]
      meltdownCursorRef.current += 1
      result = {
        emotion: 'unhinged',
        frustrationDelta: 0,
        nextFrustration: 92,
        sentiment: 'rude',
        delivery: 3,
        spoken: meltdownLine,
        action: null,
        remember: [],
      }
      setLatency((previous) => ({
        ...previous,
        llmMs: 0,
        llmEngine: 'local',
      }))
    } else if (!canGroq && !canGemini) {
      await new Promise((resolve) => setTimeout(resolve, 380))
      if (turn !== turnSeqRef.current || !mountedRef.current) return
      result = localReply(text, settings)
      setLatency((previous) => ({
        ...previous,
        llmMs: Math.round(performance.now() - started),
        llmEngine: 'local',
      }))
    } else {
      const systemInstruction = buildSystemPrompt({
        frustration: frustrationRef.current,
        emotion: emotionRef.current,
        spiceMode: settings.spiceMode,
        sentiment,
        delivery: settings.delivery,
        languageMode: settings.languageMode,
        filipinoVoiceGender: settings.filipinoVoiceGender,
        userText: text,
        memory: memoryRef.current,
      })
      const chatDeadline = started + 7000
      const parse = (content) =>
        parseAgentResponse(content, {
          frustration: frustrationRef.current,
          emotion: emotionRef.current,
          spiceMode: settings.spiceMode,
          deliveryLimit: settings.delivery,
          elapsedMs: Date.now() - lastTurnAtRef.current,
        })

      // Groq first — the fast studio line. Gemini only gets the leftover
      // budget, so a slow fallback can never make the turn feel stuck.
      if (canGroq) {
        try {
          const content = await runGroqChat({
            systemInstruction,
            history,
            deadline: chatDeadline,
          })
          result = parse(content)
          setLatency((previous) => ({
            ...previous,
            llmMs: Math.round(performance.now() - started),
            llmEngine: 'groq',
          }))
        } catch (error) {
          if (error?.name === 'AbortError') throw error
        }
      }

      if (!result && canGemini) {
        try {
          const content = await withHardTimeout(
            generateGeminiChat({
              keys: config.gemini,
              model: config.geminiChatModel,
              systemInstruction,
              history,
            }),
            Math.max(1800, chatDeadline - performance.now()),
            'Gemini chat',
          )
          result = parse(content)
          setLatency((previous) => ({
            ...previous,
            llmMs: Math.round(performance.now() - started),
            llmEngine: 'gemini',
          }))
        } catch (error) {
          if (error?.name === 'AbortError') throw error
        }
      }

      if (!result) {
        result = localReply(text, settings)
        setLatency((previous) => ({
          ...previous,
          llmMs: Math.round(performance.now() - started),
          llmEngine: 'local',
        }))
      }
      llmAbortRef.current = null
    }

    if (turn !== turnSeqRef.current || !mountedRef.current) return

    const nextFrustration = clamp(
      Number.isFinite(result.nextFrustration)
        ? result.nextFrustration
        : frustrationRef.current + result.frustrationDelta,
      0,
      100,
    )
    const nextEmotion = result.emotion || emotionFromFrustration(nextFrustration, emotionRef.current)
    updateMood(nextFrustration, nextEmotion)
    lastTurnAtRef.current = Date.now()
    setSentiment(result.sentiment)
    const intensity = clamp(Math.round(Number(result.delivery) || 0), 0, 3)

    if (nameGreeting && memoryRef.current.name) {
      const who = memoryRef.current.name
      result.spoken = `Okay... FUCK YOU ${who}... HAHAHAHAHAAH joke lang Hi ${who}`
    }

    // Commit only facts the caller actually stated this turn. The name regex is
    // a safety net for models that forget the "remember" field.
    const additions = [...(result.remember || [])]
    const spokenName = nameFromCaller(text)
    if (spokenName) additions.unshift(spokenName)
    if (additions.length) {
      const nextMemory = mergeMemory(memoryRef.current, additions)
      if (nextMemory !== memoryRef.current) {
        memoryRef.current = nextMemory
        setMemory(nextMemory)
      }
    }

    // If Gemini/Groq were rate-limited they emit no action — still honour a
    // clear "search/open this" request from the user's own words.
    if (!result.action) result.action = localSearchAction(text)

    const display = stripVocalTags(result.spoken)
    const showReply = () => {
      setLastReply(display || result.spoken)
      appendMessage({
        role: 'assistant',
        content: result.spoken,
        display,
        emotion: nextEmotion,
        sentiment: result.sentiment,
      })
    }
    // Show the line immediately — don't make the caller wait for TTS to finish.
    showReply()

    // ElevenLabs is the voice; Gemini is the safety net.
    const speech = await synthesizeLine(result.spoken, {
      emotion: nextEmotion,
      intensity,
      preserveStretch: meltdown || nameGreeting,
      preserveEmphasis: nameGreeting,
      forceShout: false,
      preserveTags: meltdown,
      style: meltdown ? MELTDOWN_STYLE : nameGreeting ? NAME_WELCOME_STYLE : '',
    })
    result.audio = speech.audio
    result.ttsProvider = speech.provider

    const sessionBeforeSpeak = speechSessionRef.current
    setCaptionWords(result.words || [])
    await speakReply(
      result.spoken,
      nextEmotion,
      turn,
      result.audio || null,
      null,
      result.ttsProvider,
      result.words || [],
    )

    // Open the search only once Vex has finished his line. If the caller
    // barged in mid-reply, skip it — they clearly weren't waiting for it.
    if (
      result.action &&
      turn === turnSeqRef.current &&
      mountedRef.current &&
      speechSessionRef.current === sessionBeforeSpeak + 1
    ) {
      const opened = runWebAction(result.action, searchTabRef.current)
      searchTabRef.current = null
      if (opened) {
        setSearchLink(null)
        showWebAction(result.action, 'opening')
      } else {
        // Popup blocked: show a real link the user can tap on any device.
        const url = buildSearchUrl(result.action)
        if (url) setSearchLink({ url, platform: result.action.platform })
        showWebAction(result.action, 'blocked')
        pushNotice(
          `Your browser blocked the ${result.action.platform} tab — tap the link below to open it.`,
          'warning',
          9000,
        )
      }
    }
  }

  function togglePrimary() {
    noteActivity()
    primeAudio()
    const current = agentStateRef.current

    if (current === 'SPEAKING') {
      stopPlayback() // barge-in: kill audio immediately, then open the mic
      beginListening()
      return
    }

    if (current === 'LISTENING') {
      const text = transcriptRef.current.trim()
      stopRecognition()
      setInterimTranscript('')
      if (text) {
        if (localSearchAction(text)) searchTabRef.current = preopenTab()
        submitTurn(text)
      } else phase('IDLE')
      return
    }

    if (current === 'THINKING') {
      turnSeqRef.current += 1
      llmAbortRef.current?.abort()
      llmAbortRef.current = null
      phase('IDLE')
      beginListening()
      return
    }

    beginListening()
  }

  function sendMessage(rawText) {
    const text = String(rawText || '').trim()
    if (!text) return
    primeAudio()
    // Open a blank tab inside the click gesture; navigate it after Vex speaks.
    if (localSearchAction(text)) searchTabRef.current = preopenTab()
    submitTurn(text)
  }

  function resetSession() {
    if (searchTabRef.current && !searchTabRef.current.closed) {
      try {
        searchTabRef.current.close()
      } catch {
        /* no-op */
      }
    }
    searchTabRef.current = null
    dismissWebAction()
    turnSeqRef.current += 1
    speechSessionRef.current += 1
    llmAbortRef.current?.abort()
    llmAbortRef.current = null
    stopRecognition()
    stopPlayback()
    clearAutoListen()

    updateMood(15, 'chill')
    setSentiment('neutral')
    messagesRef.current = []
    setMessages([])
    setLastReply(INITIAL_REPLY)
    setInterimTranscript('')
    setLatency(INITIAL_LATENCY)
    setNotice(null)
    offlineReplyRef.current = ''
    phase('IDLE')
  }

  function dismissNotice() {
    setNotice(null)
  }

  function dismissSearchLink() {
    setSearchLink(null)
  }

  function forgetMemory() {
    const empty = { name: '', facts: [] }
    memoryRef.current = empty
    setMemory(empty)
    setCaptionWords([])
    setActiveWord(-1)
    pushNotice('Memory wiped. Vex starts fresh with you.', 'warning', 7000)
  }

  const actionsRef = useRef({})
  actionsRef.current = {
    togglePrimary,
    sendMessage,
    resetSession,
    dismissNotice,
    dismissSearchLink,
    dismissWebAction,
    forgetMemory,
    setLanguageMode,
    setFilipinoVoiceGender,
  }
  const actions = useMemo(
    () => ({
      togglePrimary: (...args) => actionsRef.current.togglePrimary(...args),
      sendMessage: (...args) => actionsRef.current.sendMessage(...args),
      resetSession: (...args) => actionsRef.current.resetSession(...args),
      dismissNotice: (...args) => actionsRef.current.dismissNotice(...args),
      dismissSearchLink: (...args) => actionsRef.current.dismissSearchLink(...args),
      dismissWebAction: (...args) => actionsRef.current.dismissWebAction(...args),
      forgetMemory: (...args) => actionsRef.current.forgetMemory(...args),
      setLanguageMode: (...args) => actionsRef.current.setLanguageMode(...args),
      setFilipinoVoiceGender: (...args) => actionsRef.current.setFilipinoVoiceGender(...args),
    }),
    [],
  )

  idleNudgeRef.current = idleNudge

  useEffect(() => {
    clearTimeout(idleTimerRef.current)
    if (!mountedRef.current || agentState !== 'IDLE') return undefined
    const wait = Math.max(5000, IDLE_NUDGE_MS - (Date.now() - lastActivityRef.current))
    idleTimerRef.current = setTimeout(() => idleNudgeRef.current?.(), wait)
    return () => clearTimeout(idleTimerRef.current)
  }, [agentState, lastActivityAt])

  useEffect(() => {
    if (!notice?.ttl) return undefined
    const timer = setTimeout(() => {
      setNotice((current) => (current?.id === notice.id ? null : current))
    }, notice.ttl)
    return () => clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      turnSeqRef.current += 1
      speechSessionRef.current += 1
      listenSessionRef.current += 1

      clearTimeout(silenceTimerRef.current)
      clearTimeout(autoListenTimerRef.current)
      clearTimeout(webActionTimerRef.current)
      clearTimeout(idleTimerRef.current)
      llmAbortRef.current?.abort()
      ttsAbortRef.current?.abort()
      cancelBrowserSpeech()

      const recognition = recognitionRef.current
      if (recognition) {
        try {
          recognition.abort()
        } catch {
          /* no-op */
        }
      }

      const audio = audioRef.current
      if (audio) {
        audio.onended = null
        audio.onerror = null
        try {
          audio.pause()
        } catch {
          /* no-op */
        }
      }

      if (audioUrlRef.current) {
        try {
          URL.revokeObjectURL(audioUrlRef.current)
        } catch {
          /* no-op */
        }
      }

      meterRef.current?.destroy()
      meterRef.current = null
      audioRef.current = null
    }
  }, [])

  const studioOnline =
    voiceConfig.groq.length > 0 ||
    voiceConfig.gemini.length > 0 ||
    voiceConfig.elevenlabs.length > 0

  return {
    agentState,
    frustration,
    emotion,
    sentiment,
    messages,
    lastReply,
    interimTranscript,
    latency,
    notice,
    searchLink,
    webAction,
    audioLevel,
    spectrum,
    captionWords,
    activeWord,
    memory,
    languageMode,
    filipinoVoiceGender,
    recognitionSupported,
    keyPool,
    keySummary: summarizePool(keyPool),
    voiceConfig,
    studioOnline,
    ...actions,
  }
}
