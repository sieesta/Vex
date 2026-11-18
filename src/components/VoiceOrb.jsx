import { useEffect, useRef, useState } from 'react'
import { emotionMeta, LISTENING_PALETTE, THINKING_PALETTE } from '../lib/emotions'

const BAR_COUNT = 32
const RING_RADIUS = 94
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

/** Lerp toward the analyser level so the sphere moves with weight, not jitter. */
function useSmoothedLevel(target, active) {
  const [level, setLevel] = useState(0)
  const currentRef = useRef(0)
  const targetRef = useRef(target)
  const activeRef = useRef(active)

  useEffect(() => {
    targetRef.current = target
    activeRef.current = active
  }, [target, active])

  useEffect(() => {
    let frame = 0
    let last = 0
    const tick = (time) => {
      frame = requestAnimationFrame(tick)
      if (time - last < 30) return
      last = time
      const goal = activeRef.current ? targetRef.current : 0
      const next = currentRef.current + (goal - currentRef.current) * 0.34
      currentRef.current = Math.abs(next - goal) < 0.004 ? goal : next
      setLevel((previous) =>
        Math.abs(previous - currentRef.current) < 0.002 ? previous : currentRef.current,
      )
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  return level
}

export default function VoiceOrb({ state, emotion, audioLevel, spectrum, onPress }) {
  const isSpeaking = state === 'SPEAKING'
  const isListening = state === 'LISTENING'
  const isThinking = state === 'THINKING'

  const level = useSmoothedLevel(audioLevel, isSpeaking)

  const base = emotionMeta(emotion)
  const palette = isListening
    ? LISTENING_PALETTE
    : isThinking
      ? THINKING_PALETTE
      : base

  const scale = isSpeaking ? 1 + level * 0.16 : isListening ? 1.03 : 1
  const lift = isSpeaking ? level * 2 : 0
  const auraScale = 1 + (isSpeaking ? level * 0.42 : 0.04)
  const bars = Array.isArray(spectrum) && spectrum.length ? spectrum : new Array(BAR_COUNT).fill(0)

  const ariaLabel =
    state === 'SPEAKING'
      ? 'Interrupt Vex and start talking'
      : state === 'LISTENING'
        ? 'Stop listening and send your message'
        : state === 'THINKING'
          ? 'Interrupt Vex and start talking'
          : 'Talk to Vex'

  const stageStyle = {
    '--orb-1': palette.colors[0],
    '--orb-2': palette.colors[1],
    '--orb-3': palette.colors[2],
    '--orb-accent': palette.accent,
  }

  return (
    <div
      className="orb-stage relative mx-auto aspect-square w-full max-w-[20.5rem] select-none sm:max-w-[23.5rem]"
      style={stageStyle}
      data-state={state}
    >
      <div
        className="orb-aura pointer-events-none absolute inset-[9%] rounded-full"
        style={{
          transform: `scale(${auraScale})`,
          opacity: isSpeaking ? 0.6 + level * 0.38 : isThinking ? 0.6 : isListening ? 0.58 : 0.4,
          transition: 'transform 110ms linear, opacity 400ms ease',
        }}
      />

      <span className="orb-dial" aria-hidden="true" />

      {isThinking && <span className="orb-thinking-ring" aria-hidden="true" />}

      {isSpeaking && (
        <>
          <span className="orb-ripple orb-ripple-speaking" aria-hidden="true" />
          <span
            className="orb-ripple orb-ripple-speaking"
            aria-hidden="true"
            style={{ animationDelay: '0.7s' }}
          />
          <span
            className="orb-ripple orb-ripple-speaking"
            aria-hidden="true"
            style={{ animationDelay: '1.4s' }}
          />
        </>
      )}

      {isListening && (
        <>
          <span className="orb-ripple" aria-hidden="true" />
          <span className="orb-ripple orb-ripple-delayed" aria-hidden="true" />
        </>
      )}

      <div className="orb-orbit" aria-hidden="true">
        <svg viewBox="0 0 200 200" fill="none">
          <circle cx="100" cy="100" r="97" stroke="rgba(242,230,208,0.07)" strokeWidth="0.5" />
          <circle
            cx="100"
            cy="100"
            r="99"
            stroke={palette.accent}
            strokeOpacity="0.26"
            strokeWidth="0.6"
            strokeDasharray="0.6 8"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <div className="orb-orbit orb-orbit-reverse" aria-hidden="true">
        <svg viewBox="0 0 200 200" fill="none">
          <circle
            cx="100"
            cy="100"
            r="93.5"
            stroke={palette.accent}
            strokeOpacity="0.14"
            strokeWidth="0.6"
            strokeDasharray="2 13"
            strokeLinecap="round"
          />
        </svg>
      </div>

      {/* Frequency halo: outer spectrum bars plus a quieter inner reflection. */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        {bars.slice(0, BAR_COUNT).map((value, index) => {
          const angle = (index / BAR_COUNT) * 360
          const radians = (angle * Math.PI) / 180
          const energy = isSpeaking ? Math.min(1, Math.max(0, value || 0)) : 0
          const height = isSpeaking ? 4 + energy * 30 : 2
          const innerHeight = isSpeaking ? 3 + energy * 12 : 1.5

          return (
            <span key={index}>
              <span
                className="absolute rounded-full"
                style={{
                  left: `${50 + 46.5 * Math.sin(radians)}%`,
                  top: `${50 - 46.5 * Math.cos(radians)}%`,
                  width: '2px',
                  height: `${height}px`,
                  transform: `translate(-50%, -50%) rotate(${angle}deg)`,
                  backgroundColor: index % 5 === 0 ? palette.colors[0] : palette.colors[1],
                  opacity: isSpeaking ? 0.28 + energy * 0.72 : 0.1,
                  boxShadow: energy > 0.22 ? `0 0 8px ${palette.accent}` : 'none',
                  transition: 'height 90ms linear, opacity 160ms linear',
                }}
              />
              <span
                className="absolute rounded-full"
                style={{
                  left: `${50 + 40 * Math.sin(radians)}%`,
                  top: `${50 - 40 * Math.cos(radians)}%`,
                  width: '1.5px',
                  height: `${innerHeight}px`,
                  transform: `translate(-50%, -50%) rotate(${angle}deg)`,
                  backgroundColor: palette.colors[2],
                  opacity: isSpeaking ? 0.16 + energy * 0.5 : 0.08,
                  transition: 'height 90ms linear, opacity 160ms linear',
                }}
              />
            </span>
          )
        })}
      </div>

      <svg
        className="orb-progress"
        viewBox="0 0 200 200"
        fill="none"
        aria-hidden="true"
        style={{ inset: '12.5%', width: '75%', height: '75%' }}
      >
        <circle cx="100" cy="100" r={RING_RADIUS} stroke="rgba(242,230,208,0.07)" strokeWidth="1" />
        <circle
          cx="100"
          cy="100"
          r={RING_RADIUS}
          stroke={palette.accent}
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={RING_CIRCUMFERENCE * (1 - level)}
          transform="rotate(-90 100 100)"
          style={{ transition: 'stroke-dashoffset 90ms linear' }}
        />
      </svg>

      <button
        type="button"
        onClick={onPress}
        aria-label={ariaLabel}
        title={ariaLabel}
        className="orb-trigger left-1/2 top-1/2"
        style={{
          transform: `translate(-50%, calc(-50% - ${lift}px)) scale(${scale})`,
          transition: 'transform 100ms linear',
        }}
      >
        <span
          className="orb-wave"
          aria-hidden="true"
          style={{ transform: `scale(${1 + level * 0.22})` }}
        />
        <span
          className="orb-body"
          style={{
            filter: `brightness(${1 + level * 0.18}) saturate(${1 + level * 0.35})`,
            transition: 'filter 120ms linear, box-shadow 700ms ease',
          }}
        >
          <span className="orb-swirl" />
          <span className="orb-blob orb-blob-a" />
          <span className="orb-blob orb-blob-b" />
          <span className="orb-blob orb-blob-c" />
          <span className="orb-filament" aria-hidden="true" />
          <span
            className="orb-core"
            aria-hidden="true"
            style={{ opacity: isSpeaking ? 0.35 + level * 0.55 : 0 }}
          />
          <span className="orb-specular" />
          <span className="orb-rim" />
          <span className="orb-grille" />
          <span className="orb-noise" />
        </span>
      </button>
    </div>
  )
}
