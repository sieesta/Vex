import { useEffect, useState } from 'react'
import { Brain, RotateCcw } from 'lucide-react'

const STATE_LABEL = {
  IDLE: 'standby',
  LISTENING: 'mic open',
  THINKING: 'processing',
  SPEAKING: 'on air',
}

function BrandDial() {
  return (
    <div className="brand-dial size-10 shrink-0" aria-hidden="true">
      <span className="brand-dial__needle" />
      <span className="brand-dial__core" />
    </div>
  )
}

export default function Header({ brainOpen, onToggleBrain, onReset, state = 'IDLE' }) {
  const [confirming, setConfirming] = useState(false)
  const live = state !== 'IDLE'

  useEffect(() => {
    if (!confirming) return undefined
    const timer = setTimeout(() => setConfirming(false), 3400)
    return () => clearTimeout(timer)
  }, [confirming])

  const handleReset = () => {
    if (!confirming) {
      setConfirming(true)
      return
    }
    setConfirming(false)
    onReset()
  }

  return (
    <header className="sticky top-0 z-40 border-b hairline bg-[#0d0a08]/90 backdrop-blur-md">
      <div className="mx-auto w-full max-w-[58rem] px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-3 py-3 md:grid md:grid-cols-[1fr_auto_1fr]">
          <div className="flex min-w-0 items-center gap-3">
            <BrandDial />
            <div className="min-w-0">
              <h1 className="flex items-baseline gap-2 whitespace-nowrap">
                <span className="font-display text-[27px] italic leading-none text-cream">vex</span>
                <span className="hidden font-mono text-[8.5px] uppercase tracking-[0.24em] text-ember min-[360px]:inline">
                  after hours
                </span>
                <span
                  className={`ml-0.5 size-1.5 shrink-0 rounded-full sm:hidden ${
                    live ? 'state-dot bg-ember' : 'bg-faint'
                  }`}
                  aria-hidden="true"
                />
              </h1>
              <p className="mt-1 hidden font-mono text-[8px] uppercase tracking-[0.22em] text-faint sm:block">
                affective voice transmission · studio b
              </p>
            </div>
          </div>

          <div className="hidden items-center gap-3 border border-cream/10 bg-[#14100d]/75 px-3.5 py-2 md:flex">
            <span
              className={`size-1.5 rounded-full ${live ? 'state-dot bg-ember' : 'bg-faint'}`}
              aria-hidden="true"
            />
            <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-cream/85">
              {STATE_LABEL[state] || STATE_LABEL.IDLE}
            </span>
            <span className="h-3 w-px bg-cream/10" aria-hidden="true" />
            <span className="font-mono text-[8px] uppercase tracking-[0.18em] text-faint">88.7 fm</span>
          </div>

          <div className="flex shrink-0 items-center justify-end gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={onToggleBrain}
              aria-expanded={brainOpen}
              aria-controls="agent-brain"
              title="Toggle studio telemetry"
              className={`flex h-9 items-center gap-2 rounded-[3px] border px-2.5 font-mono text-[9px] uppercase tracking-[0.16em] transition-colors sm:px-3 ${
                brainOpen
                  ? 'border-ember/40 bg-ember/10 text-ember'
                  : 'border-cream/10 text-muted hover:border-cream/25 hover:text-cream'
              }`}
            >
              <Brain size={13} strokeWidth={1.75} />
              <span className="hidden md:inline">telemetry</span>
              <span
                className={`size-1 rounded-full ${brainOpen ? 'state-dot bg-ember' : 'bg-faint'}`}
                aria-hidden="true"
              />
            </button>

            <button
              type="button"
              onClick={handleReset}
              title="Clear the conversation and reset the mood"
              className={`flex h-9 items-center gap-2 rounded-[3px] border px-2.5 font-mono text-[9px] uppercase tracking-[0.14em] transition-colors sm:px-3 ${
                confirming
                  ? 'border-[#ff5a45]/50 bg-[#ff5a45]/10 text-[#ff9b83]'
                  : 'border-cream/10 text-muted hover:border-cream/25 hover:text-cream'
              }`}
            >
              <RotateCcw size={12} />
              <span className={confirming ? 'inline' : 'hidden lg:inline'}>
                {confirming ? 'sure?' : 'reset'}
              </span>
            </button>
          </div>
        </div>

        <div className="hidden items-center justify-between border-t hairline py-1.5 font-mono text-[7.5px] uppercase tracking-[0.2em] text-faint lg:flex">
          <span>recorded live · no audience</span>
          <span className="flex items-center gap-4">
            <span>00:00 — 05:00</span>
            <span className="text-cream/15">/</span>
            <span>manila · 14.5995° n</span>
          </span>
        </div>
      </div>
    </header>
  )
}
