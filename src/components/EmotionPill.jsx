import { emotionMeta } from '../lib/emotions'

export default function EmotionPill({ emotion }) {
  const meta = emotionMeta(emotion)

  return (
    <div
      key={emotion}
      className="animate-fade-in inline-flex items-stretch border border-cream/10 bg-[#17110d]/80"
    >
      <span
        className="w-[3px] shrink-0"
        style={{ backgroundColor: meta.accent }}
        aria-hidden="true"
      />
      <div className="flex items-center gap-2.5 px-3 py-1.5">
        <span className="label-mono text-faint">mood</span>
        <span
          className="font-display text-[16px] italic leading-none"
          style={{ color: meta.accent }}
        >
          {meta.label}
        </span>
        <span className="h-3 w-px bg-cream/10" aria-hidden="true" />
        <span className="hidden font-mono text-[8px] uppercase tracking-[0.16em] text-muted sm:inline">
          {meta.blurb}
        </span>
        <span
          className="state-dot ml-0.5 size-1 rounded-full"
          style={{ backgroundColor: meta.accent }}
          aria-hidden="true"
        />
      </div>
    </div>
  )
}
