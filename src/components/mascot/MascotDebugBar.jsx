import { useEffect, useState } from 'react'
import { MASCOT_EMOTIONS } from './Mascot'

/** Fake syllable-shaped loudness so the lip-sync can be tested without any audio. */
export function useSimulatedSpeech(active) {
  const [level, setLevel] = useState(0)

  useEffect(() => {
    if (!active) return undefined

    let frame = 0
    let syllables = 0
    let sentenceLength = 6
    const next = (from) => {
      syllables += 1
      const endsSentence = syllables >= sentenceLength
      if (endsSentence) {
        syllables = 0
        sentenceLength = 5 + Math.floor(Math.random() * 5)
      }
      const gap = endsSentence ? 450 + Math.random() * 400 : Math.random() < 0.25 ? 90 + Math.random() * 120 : 0
      const start = from + gap
      return { start, end: start + 110 + Math.random() * 120, peak: 0.35 + Math.random() * 0.65 }
    }

    let segment = next(performance.now())
    const tick = (now) => {
      frame = requestAnimationFrame(tick)
      if (now >= segment.end) segment = next(segment.end)
      const value =
        now < segment.start
          ? 0.02
          : segment.peak * Math.pow(Math.sin((Math.PI * (now - segment.start)) / (segment.end - segment.start)), 0.8)
      setLevel(value)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [active])

  return active ? level : 0
}

const pill =
  'rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40'
const pillIdle = 'border-white/10 text-zinc-400 hover:border-white/25 hover:text-zinc-100'
const pillActive = 'border-amber-300/60 bg-amber-300/10 text-amber-200'

export default function MascotDebugBar({
  forced,
  onForcedChange,
  simulating,
  onSimulatingChange,
  manualLevel,
  onManualLevelChange,
  level,
  onSimulateSite,
}) {
  return (
    <div
      role="group"
      aria-label="Mascot debug controls"
      className="flex w-full max-w-md flex-col gap-2.5 rounded-2xl border border-white/10 bg-white/[0.03] p-3"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          aria-pressed={forced === null}
          onClick={() => onForcedChange(null)}
          className={`${pill} ${forced === null ? pillActive : pillIdle}`}
        >
          live
        </button>
        {MASCOT_EMOTIONS.map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={forced === name}
            onClick={() => onForcedChange(name)}
            className={`${pill} ${forced === name ? pillActive : pillIdle}`}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-pressed={simulating}
          onClick={() => onSimulatingChange(!simulating)}
          className={`${pill} shrink-0 ${simulating ? pillActive : pillIdle}`}
        >
          {simulating ? 'stop talking' : 'simulate talk'}
        </button>
        <button
          type="button"
          onClick={onSimulateSite}
          className={`${pill} shrink-0 ${pillIdle}`}
        >
          simulate site
        </button>
        <label className="flex min-w-0 flex-1 items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
          <span className="shrink-0">level</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={simulating ? level : manualLevel}
            disabled={simulating}
            onChange={(event) => onManualLevelChange(Number(event.target.value))}
            className="h-1 min-w-0 flex-1 accent-amber-300 disabled:opacity-60"
          />
          <span className="w-8 shrink-0 text-right tabular-nums text-zinc-400">
            {(simulating ? level : manualLevel).toFixed(2)}
          </span>
        </label>
      </div>
    </div>
  )
}
