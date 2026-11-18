import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { clamp, EMOTION_KEYS, emotionFromFrustration, SENTIMENT_KEYS } from '../lib/emotions'
import { buildSystemPrompt, offlineAgentReply, parseAgentResponse } from '../lib/persona'
import { createAudioMeter } from '../lib/audioMeter'
import { generateGroqChat } from '../lib/groq'
import { EMPTY_VOICE_CONFIG, loadVoiceConfig } from '../lib/keySource'
import { makeKeyRecord, summarizePool } from '../lib/keyPool'
import { generateGeminiChat, generateGeminiSpeech } from '../lib/geminiTts'
import { generateElevenLabsSpeech, generateGroqSpeech } from '../lib/voiceProviders'
import { cancelBrowserSpeech, stripVocalTags } from '../lib/speech'
import { useLocalStorageState } from './useLocalStorage'
import { buildSearchUrl, localSearchAction, preopenTab, runWebAction } from '../lib/webActions'

const MAX_MESSAGES = 40
const MAX_CONTEXT_MESSAGES = 12
const SILENCE_MS = 1400
const INITIAL_REPLY = "You're on the air. Say something worth the static."
const INITIAL_LATENCY = {
  llmMs: null,
  ttsMs: null,
  engine: '—',
  llmEngine: 'idle',
  ttsMode: 'idle',
}
const EMPTY_SPECTRUM = Array(32).fill(0)
const TAGALOG_MARKERS =
  /\b(ang|ng|mga|hindi|oo|sige|ikaw|ako|mo|ka|na|ba|lang|naman|kasi|pero|talaga|grabe|ano|saan|bakit|paano|kuya|ate|po|opo|wala|meron|yung|ito|iyan|diyan|salamat|maganda|gago|tangina|puta|bwisit|bes)\b/i
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
export function useBanterAgent({ voice, spiceMode, handsFree, delivery = 0 }) {
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
  const [lastReply, setLastReply] = useLocalStorageState('vex.v1.lastReply', INITIAL_REPLY)
  const [interimTranscript, setInterimTranscript] = useState('')
  const [latency, setLatency] = useState(INITIAL_LATENCY)
  const [notice, setNotice] = useState(null)
  const [audioLevel, setAudioLevel] = useState(0)
  const [spectrum, setSpectrum] = useState(EMPTY_SPECTRUM)
  const [searchLink, setSearchLink] = useState(null)
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
  const settingsRef = useRef({ voice, spiceMode, handsFree, delivery, languageMode, filipinoVoiceGender })
  settingsRef.current = { voice, spiceMode, handsFree, delivery, languageMode, filipinoVoiceGender }
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
  const silenceTimerRef = useRef(null)
  const autoListenTimerRef = useRef(null)
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

  function noteKeySuccess(key) {
    const entry = poolRef.current.find((item) => item.key === key)
    if (!entry) return
    patchEntry(entry.id, {
      status: 'active',
      cooldownUntil: null,
      requestsUsed: (entry.requestsUsed || 0) + 1,
      lastUsedAt: Date.now(),
    })
  }

  function noteKeyError(key, error) {
    if (error?.name === 'AbortError') return
    const entry = poolRef.current.find((item) => item.key === key)
    if (!entry) return
    const patch = keyStatusFor(error)
    if (patch) patchEntry(entry.id, patch)
  }

  function usableGroqKeys() {
    const now = Date.now()
    return poolRef.current
      .filter((entry) => usableEntry(entry, now))
      .map((entry) => entry.key)
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
  ) {
    const session = ++speechSessionRef.current
    const started = performance.now()

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
      // Never let a stalled playback (autoplay policy, muted tab, headless)
      // block the rest of the turn — e.g. opening the requested search tab.
      const playLimit = Math.max(3000, Math.min(12000, text.length * 110))
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

    if (!canGroq && !canGemini) {
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

    const eleven =
      config.elevenlabs.length && config.elevenlabsVoiceId
        ? {
            name: 'ElevenLabs',
            timeoutMs: 9000,
            run: (options) =>
              generateElevenLabsSpeech(result.spoken, {
                keys: config.elevenlabs,
                voiceId: config.elevenlabsVoiceId,
                voiceIds: config.elevenlabsVoiceIds,
                model: config.elevenlabsModel,
                emotion: options.emotion,
                intensity: options.intensity,
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
              generateGeminiSpeech(result.spoken, {
                keys: config.gemini,
                model: config.geminiTtsModel,
                voice: config.geminiTtsVoice,
                languageMode: options.languageMode,
                intensity: options.intensity,
                abortSignal: options.abortSignal,
              }),
          }
        : null

    const orpheus =
      config.groq.length > 0
        ? {
            name: 'Orpheus',
            timeoutMs: 9000,
            run: (options) =>
              generateGroqSpeech(result.spoken, {
                keys: usableGroqKeys(),
                model: config.groqTtsModel,
                abortSignal: options.abortSignal,
                onKeySuccess: noteKeySuccess,
                onKeyError: noteKeyError,
              }),
          }
        : null

    // Orpheus is the English line. Taglish and other languages need the
    // multilingual voices first, with Orpheus as the last-resort voice.
    const mostlyEnglish = !TAGALOG_MARKERS.test(stripVocalTags(result.spoken))
    const speechProviders = (
      mostlyEnglish ? [orpheus, eleven, gemini] : [eleven, gemini, orpheus]
    ).filter(Boolean)

    if (speechProviders.length) {
      const ttsStarted = performance.now()
      const ttsDeadline = ttsStarted + 11000
      for (const provider of speechProviders) {
        const remaining = ttsDeadline - performance.now()
        if (remaining < 1500) break
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), provider.timeoutMs)
        try {
          result.audio = await withHardTimeout(
            provider.run({
              languageMode: settings.languageMode,
              emotion: nextEmotion,
              intensity,
              abortSignal: controller.signal,
            }),
            Math.max(1500, Math.min(provider.timeoutMs + 2000, ttsDeadline - performance.now())),
            provider.name,
          )
          result.ttsProvider = provider.name
          break
        } catch {
          // Silent provider failover. The next voice line gets the turn.
        } finally {
          clearTimeout(timeout)
        }
      }
      setLatency((previous) => ({
        ...previous,
        ttsMs: Math.round(performance.now() - ttsStarted),
      }))
    }

    const sessionBeforeSpeak = speechSessionRef.current
    await speakReply(
      result.spoken,
      nextEmotion,
      turn,
      result.audio || null,
      null,
      result.ttsProvider,
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
      } else {
        // Popup blocked: show a real link the user can tap on any device.
        const url = buildSearchUrl(result.action)
        if (url) setSearchLink({ url, platform: result.action.platform })
        pushNotice(
          `Your browser blocked the ${result.action.platform} tab — tap the link below to open it.`,
          'warning',
          9000,
        )
      }
    }
  }

  function togglePrimary() {
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

  const actionsRef = useRef({})
  actionsRef.current = {
    togglePrimary,
    sendMessage,
    resetSession,
    dismissNotice,
    dismissSearchLink,
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
      setLanguageMode: (...args) => actionsRef.current.setLanguageMode(...args),
      setFilipinoVoiceGender: (...args) => actionsRef.current.setFilipinoVoiceGender(...args),
    }),
    [],
  )

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
    audioLevel,
    spectrum,
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
