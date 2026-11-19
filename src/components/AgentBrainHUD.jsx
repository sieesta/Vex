import {
  Activity,
  Clock,
  Cpu,
  Database,
  Flame,
  Gauge,
  Heart,
  Languages,
  Minus,
  Smile,
  Sparkles,
  Waves,
} from 'lucide-react'
import { AGENT_STATES, SENTIMENT_META, STATE_META } from '../lib/emotions'

const SENTIMENT_ICONS = {
  friendly: Heart,
  teasing: Smile,
  rude: Flame,
  nonsense: Sparkles,
  neutral: Minus,
}

function formatLatency(value) {
  if (!Number.isFinite(value)) return '—'
  if (value < 1000) return `${Math.round(value)}ms`
  return `${(value / 1000).toFixed(1)}s`
}

function Chips({ children }) {
  return <div className="mt-3 flex flex-wrap items-center gap-1.5">{children}</div>
}

function MiniChip({ children, color = '#a8967d' }) {
  return (
    <span
      className="inline-flex items-center rounded-[2px] border px-1.5 py-1 font-mono text-[8px] uppercase tracking-[0.12em]"
      style={{
        borderColor: `${color}33`,
        backgroundColor: `${color}10`,
        color,
      }}
    >
      {children}
    </span>
  )
}

function llmMeta(llmEngine) {
  if (llmEngine === 'gemini') return { label: 'gemini desk', color: '#c8e06a' }
  if (llmEngine === 'groq') return { label: 'groq desk', color: '#f6c177' }
  if (llmEngine === 'local' || llmEngine === 'offline' || llmEngine === 'offline-fallback') {
    return { label: 'local desk', color: '#a8967d' }
  }
  if (llmEngine === 'thinking') return { label: 'thinking…', color: '#f6c177' }
  return { label: 'waiting', color: '#6f5d4b' }
}

export default function AgentBrainHUD({
  open,
  state,
  sentiment,
  frustration,
  latency = {},
  messages = [],
  memory = { name: '', facts: [] },
  handsFree,
  languageMode = 'taglish',
  studioOnline = false,
  accent = '#ff6b35',
  ttsProvider = 'elevenlabs',
  onTtsProviderChange = () => {},
  onClose = () => {},
}) {
  const sentimentInfo = SENTIMENT_META[sentiment] || SENTIMENT_META.neutral
  const SentimentIcon = SENTIMENT_ICONS[sentimentInfo.icon] || Minus
  const engine = latency.engine || '—'
  const engineColor = engine === 'Browser' ? '#f6c177' : engine === '—' ? '#6f5d4b' : accent
  const engineLabel = engine === 'Browser' ? 'browser voice' : engine === '—' ? 'awaiting signal' : engine
  const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant')
  const llm = llmMeta(latency.llmEngine)

  return (
    <div
      id="agent-brain"
      aria-hidden={!open}
      className={`grid transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
        open ? 'mt-3 grid-rows-[1fr] opacity-100' : 'mt-0 grid-rows-[0fr] opacity-0'
      }`}
    >
      <div className="overflow-hidden">
        <section className="panel overflow-hidden rounded-[10px]">
          <div className="flex items-center justify-between gap-2 border-b hairline px-3 py-1.5">
            <div className="flex min-w-0 items-center gap-1.5">
              <Activity size={11} className="shrink-0 text-ember" />
              <span className="label-mono text-cream/80">agent brain</span>
              <span className="hidden font-mono text-[7px] tracking-[0.12em] text-faint sm:inline">
                / telemetry
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="state-dot size-1 rounded-full bg-acid" aria-hidden="true" />
              <span className="hidden font-mono text-[7px] uppercase tracking-[0.12em] text-faint sm:inline">
                live · local
              </span>
              <button
                type="button"
                onClick={onClose}
                aria-label="Minimize agent brain"
                title="Minimize"
                className="rounded-[2px] border border-white/10 px-1.5 py-0.5 text-faint transition-colors hover:border-white/25 hover:text-cream"
              >
                <Minus size={10} />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-px bg-cream/[0.07] lg:grid-cols-4">
            <div className="bg-[#120d0a] p-3">
              <div className="flex items-center justify-between">
                <span className="label-mono">state machine</span>
                <Cpu size={12} className="text-faint" />
              </div>
              <Chips>
                {AGENT_STATES.map((item) => {
                  const active = item === state
                  const meta = STATE_META[item]
                  return (
                    <span
                      key={item}
                      className={`inline-flex items-center rounded-[2px] border px-1.5 py-1 font-mono text-[8px] tracking-[0.12em] transition-all ${
                        active ? 'font-semibold' : 'border-cream/[0.07] text-faint'
                      }`}
                      style={
                        active
                          ? {
                              borderColor: `${meta.color}55`,
                              backgroundColor: `${meta.color}14`,
                              color: meta.color,
                              boxShadow: `0 0 16px -8px ${meta.color}`,
                            }
                          : undefined
                      }
                    >
                      {item}
                    </span>
                  )
                })}
              </Chips>
              <p className="mt-2 font-mono text-[8px] uppercase tracking-[0.12em] text-faint">
                {handsFree ? '↻ auto-loop armed' : '→ returns to idle'}
              </p>
            </div>

            <div className="bg-[#120d0a] p-3">
              <div className="flex items-center justify-between">
                <span className="label-mono">sentiment</span>
                <Smile size={12} className="text-faint" />
              </div>
              <div className="mt-3 flex items-center gap-2">
                <SentimentIcon size={15} style={{ color: sentimentInfo.color }} strokeWidth={1.8} />
                <span
                  className="font-display text-[18px] capitalize leading-none tracking-[-0.01em]"
                  style={{ color: sentimentInfo.color }}
                >
                  {sentiment}
                </span>
              </div>
              <p className="mt-2 font-mono text-[8px] uppercase tracking-[0.12em] text-faint">
                classified · {sentimentInfo.note}
              </p>
            </div>

            <div className="bg-[#120d0a] p-3">
              <div className="flex items-center justify-between">
                <span className="label-mono">turn latency</span>
                <Clock size={12} className="text-faint" />
              </div>
              <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-[13px] tabular-nums text-cream/90">
                <span>
                  <span className="mr-1 text-[8px] uppercase tracking-[0.14em] text-faint">llm</span>
                  {formatLatency(latency.llmMs)}
                </span>
                <span className="text-cream/20">/</span>
                <span>
                  <span className="mr-1 text-[8px] uppercase tracking-[0.14em] text-faint">tts</span>
                  {formatLatency(latency.ttsMs)}
                </span>
              </div>
              <Chips>
                <span
                  className="inline-flex items-center gap-1 rounded-[2px] border px-1.5 py-1 font-mono text-[8px] uppercase tracking-[0.12em]"
                  style={{
                    borderColor: `${engineColor}40`,
                    backgroundColor: `${engineColor}12`,
                    color: engineColor,
                  }}
                >
                  <Waves size={8} />
                  {engineLabel}
                </span>
                <MiniChip color={llm.color}>{llm.label}</MiniChip>
              </Chips>
              <div className="mt-2 flex flex-col items-start gap-1">
                <span className="label-mono">voice</span>
                <div className="flex flex-wrap items-center gap-1">
                  {[
                  { id: 'elevenlabs', label: 'ElevenLabs', color: '#c8e06a' },
                  { id: 'gemini', label: 'Gemini', color: '#8ab4ff' },
                ].map((option) => {
                  const active = ttsProvider === option.id
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => onTtsProviderChange(option.id)}
                      aria-pressed={active}
                      className="rounded-[2px] border px-1.5 py-1 font-mono text-[8px] uppercase tracking-[0.1em] transition-colors"
                      style={{
                        borderColor: active ? `${option.color}80` : '#ffffff1a',
                        backgroundColor: active ? `${option.color}18` : 'transparent',
                        color: active ? option.color : '#a8967d',
                      }}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
            </div>
            </div>

            <div className="bg-[#120d0a] p-3">
              <div className="flex items-center justify-between">
                <span className="label-mono">frustration</span>
                <Gauge size={12} className="text-faint" />
              </div>
              <div className="mt-2.5 flex items-baseline gap-1">
                <span className="font-mono text-[22px] leading-none tabular-nums text-cream">
                  {Math.round(frustration)}
                </span>
                <span className="font-mono text-[10px] text-faint">/100</span>
              </div>
              <div
                className="relative mt-3 h-1.5 overflow-hidden rounded-full bg-cream/[0.08]"
                role="progressbar"
                aria-label="Vex frustration"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(frustration)}
              >
                <div
                  className="frustration-fill h-full rounded-full transition-[width] duration-700 ease-out"
                  style={{ width: `${Math.max(2, frustration)}%` }}
                />
                <span className="absolute left-1/3 top-0 h-full w-px bg-black/30" />
                <span className="absolute left-2/3 top-0 h-full w-px bg-black/30" />
              </div>
              <div className="mt-2 flex justify-between font-mono text-[7.5px] uppercase tracking-[0.14em] text-faint">
                <span>calm</span>
                <span>vexed</span>
                <span>done</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 border-t hairline bg-cream/[0.02] px-3 py-1.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <Database size={10} className="shrink-0 text-faint" />
              <span className="label-mono shrink-0">memory</span>
              <span className="whitespace-nowrap font-mono text-[8px] text-muted">{messages.length}/40 msgs</span>
              <span className="whitespace-nowrap font-mono text-[8px] text-faint">
                · knows {memory.name || 'no name'}
                {memory.facts.length ? ` · ${memory.facts.length}f` : ''}
              </span>
              <span className="hidden h-3 w-px bg-cream/10 sm:block" aria-hidden="true" />
              <span className="hidden min-w-0 truncate font-mono text-[9px] text-faint sm:block">
                last: {lastAssistant?.display ? `“${lastAssistant.display}”` : 'empty tape'}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <MiniChip color="#a8967d">
                <span className="flex items-center gap-1">
                  <Languages size={8} /> {languageMode}
                </span>
              </MiniChip>
              <MiniChip color={studioOnline ? '#c8e06a' : '#6f5d4b'}>
                <span className="flex items-center gap-1">
                  <Waves size={8} /> {studioOnline ? 'voice desk online' : 'local desk'}
                </span>
              </MiniChip>
              <MiniChip color={handsFree ? '#c8e06a' : '#6f5d4b'}>
                hands-free · {handsFree ? 'on' : 'off'}
              </MiniChip>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
