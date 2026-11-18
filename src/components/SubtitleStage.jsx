import { Mic } from 'lucide-react'

const HINTS = {
  IDLE: 'the line is open',
  LISTENING: 'mic open — speak freely',
  THINKING: 'the desk is thinking',
  SPEAKING: 'voice out — interrupt any time',
}

export default function SubtitleStage({ state, interimTranscript, reply, accent }) {
  const hint = HINTS[state] || HINTS.IDLE
  const speaking = state === 'SPEAKING'

  return (
    <section className="mx-auto mt-5 w-full max-w-[46rem] text-center sm:mt-7">
      <div className="flex min-h-[2.1rem] items-center justify-center px-2">
        {interimTranscript ? (
          <p className="animate-fade-in inline-flex items-start justify-center gap-2 border-b border-ember/30 pb-1 text-[13px] italic leading-relaxed text-cream/85 sm:text-sm">
            <Mic size={12} className="mt-1 shrink-0 text-ember/80" />
            <span className="text-pretty">{interimTranscript}</span>
          </p>
        ) : (
          <p className="flex items-center gap-2 font-mono text-[8.5px] uppercase tracking-[0.24em] text-faint">
            <span
              className={`size-1 rounded-full ${speaking ? 'state-dot' : ''}`}
              style={{ backgroundColor: speaking ? accent : '#6f5d4b' }}
              aria-hidden="true"
            />
            {hint}
          </p>
        )}
      </div>

      <div className="mt-3 flex items-center justify-center gap-3">
        <span
          className="h-px w-10 bg-gradient-to-r from-transparent to-cream/20"
          aria-hidden="true"
        />
        <span
          className="inline-flex items-center gap-2 font-mono text-[8.5px] uppercase tracking-[0.3em]"
          style={{ color: speaking ? accent : '#a8967d' }}
        >
          {speaking && (
            <span className="speak-eq" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
              <span />
            </span>
          )}
          vex / out
        </span>
        <span
          className="h-px w-10 bg-gradient-to-l from-transparent to-cream/20"
          aria-hidden="true"
        />
      </div>

      <div className="mt-3 flex min-h-[5.8rem] items-start justify-center sm:min-h-[6.8rem]">
        <p
          key={reply}
          aria-live="polite"
          className="animate-fade-up text-pretty px-1 font-display text-[27px] leading-[1.14] tracking-[-0.01em] text-cream sm:text-[34px] lg:text-[37px]"
        >
          <span className="mr-1 align-top font-display text-[0.68em] text-ember/55">“</span>
          {reply}
          <span className="ml-1 align-top font-display text-[0.68em] text-ember/55">”</span>
        </p>
      </div>
    </section>
  )
}
