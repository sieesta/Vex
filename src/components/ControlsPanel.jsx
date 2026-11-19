import { useState } from 'react'
import { ArrowUp, ChevronDown, Languages, Loader2, Mic, Square, Volume2 } from 'lucide-react'

const LANGUAGES = [
  { id: 'taglish', label: 'Taglish', hint: 'Filipino · PH' },
  { id: 'tagalog', label: 'Tagalog', hint: 'Filipino · PH' },
  { id: 'english', label: 'English', hint: 'English · US' },
  { id: 'japanese', label: 'Japanese', hint: '日本語 · JP' },
  { id: 'korean', label: 'Korean', hint: '한국어 · KR' },
  { id: 'spanish', label: 'Spanish', hint: 'Español · ES' },
]

export default function ControlsPanel({
  showSettings = false,
  languageMode = 'taglish',
  onLanguageModeChange = () => {},
  filipinoVoiceGender = 'male',
  onFilipinoVoiceGenderChange = () => {},
  handsFree = true,
  onHandsFreeChange = () => {},
  state,
  onSend,
  onMic,
  micSupported,
}) {
  const [text, setText] = useState('')

  const isListening = state === 'LISTENING'
  const isThinking = state === 'THINKING'
  const isSpeaking = state === 'SPEAKING'

  const placeholder = isListening
    ? 'Listening… speak, or type instead'
    : isSpeaking
      ? 'Interrupt with a message…'
      : isThinking
        ? 'Cut in with something else…'
        : 'Say something…'

  const micLabel = isListening
    ? 'Stop listening and send'
    : isSpeaking
      ? 'Interrupt Vex and speak'
      : isThinking
        ? 'Interrupt and speak'
        : 'Start listening'

  const handleSubmit = (event) => {
    event.preventDefault()
    const value = text.trim()
    if (!value) return
    onSend(value)
    setText('')
  }

  return (
    <div className="panel rounded-[10px] p-2.5 sm:p-3">
      {showSettings && (
        <>
          <div className="grid gap-3 md:grid-cols-3 md:items-end">
            <div>
              <div className="mb-1.5 flex items-center justify-between px-1">
                <span className="label-mono">Language</span>
                <span className="hidden font-mono text-[8px] uppercase tracking-[0.14em] text-faint sm:inline">
                  recognition + voice
                </span>
              </div>
              <div className="relative flex h-10 items-center rounded-[3px] border border-cream/10 bg-[#120d0a] pl-3 pr-8 transition-colors focus-within:border-ember/40">
                <Languages size={13} className="mr-2 shrink-0 text-muted" strokeWidth={1.75} />
                <select
                  value={languageMode}
                  onChange={(event) => onLanguageModeChange(event.target.value)}
                  aria-label="Language mode"
                  className="h-full min-w-0 flex-1 appearance-none bg-transparent text-[11px] font-medium text-cream outline-none"
                >
                  {LANGUAGES.map((option) => (
                    <option key={option.id} value={option.id} className="bg-[#1c1511] text-cream">
                      {option.label} — {option.hint}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={13}
                  className="pointer-events-none absolute right-3 text-muted"
                  strokeWidth={1.75}
                />
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between px-1">
                <span className="label-mono">Filipino Voice</span>
                <span className="hidden font-mono text-[8px] uppercase tracking-[0.14em] text-faint sm:inline">
                  browser fallback
                </span>
              </div>
              <div className="flex h-10 items-center gap-1 rounded-[3px] border border-cream/10 bg-[#120d0a] p-1">
                {['male', 'female'].map((gender) => {
                  const active = gender === filipinoVoiceGender
                  return (
                    <button
                      key={gender}
                      type="button"
                      onClick={() => onFilipinoVoiceGenderChange(gender)}
                      aria-pressed={active}
                      className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[2px] text-[10px] font-medium tracking-tight transition-colors ${
                        active ? 'bg-cream text-night' : 'text-muted hover:text-cream'
                      }`}
                    >
                      <Volume2 size={12} strokeWidth={active ? 2.2 : 1.75} />
                      {gender === 'male' ? 'Angelo' : 'Blessica'}
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between px-1">
                <span className="label-mono">Continuity</span>
                <span className="hidden font-mono text-[8px] uppercase tracking-[0.14em] text-faint sm:inline">
                  auto-loop
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={handsFree}
                aria-label="Hands-free auto-listen"
                onClick={() => onHandsFreeChange(!handsFree)}
                className={`flex h-10 w-full items-center justify-between rounded-[3px] border px-3 transition-colors ${
                  handsFree
                    ? 'border-acid/30 bg-acid/[0.07] text-[#e4f0a8]'
                    : 'border-cream/10 bg-[#120d0a] text-muted hover:text-cream'
                }`}
              >
                <span className="flex items-center gap-2 text-[10.5px] font-medium tracking-tight">
                  <Mic size={12} strokeWidth={1.75} />
                  Hands-free
                </span>
                <span
                  className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                    handsFree ? 'bg-acid/30 ring-1 ring-inset ring-acid/40' : 'bg-cream/10'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 size-4 rounded-full transition-all duration-300 ${
                      handsFree
                        ? 'translate-x-[18px] bg-acid shadow-[0_0_8px_#c8e06a]'
                        : 'translate-x-0.5 bg-faint'
                    }`}
                  />
                </span>
              </button>
            </div>
          </div>
          <div className="my-3 h-px bg-cream/[0.07]" />
        </>
      )}

      <form onSubmit={handleSubmit} className="flex items-stretch gap-2 sm:gap-2.5">
        <button
          type="button"
          onClick={onMic}
          disabled={!micSupported}
          aria-label={micLabel}
          title={micSupported ? micLabel : 'Speech recognition is unavailable in this browser'}
          className={`relative grid size-12 shrink-0 place-items-center rounded-full border transition-all active:scale-95 ${
            isListening
              ? 'border-acid/50 bg-acid/15 text-acid'
              : isThinking
                ? 'border-[#f6c177]/40 bg-[#f6c177]/10 text-[#f6c177]'
                : isSpeaking
                  ? 'border-ember/40 bg-ember/10 text-ember'
                  : 'border-cream/10 bg-cream/[0.03] text-cream/75 hover:border-cream/25 hover:text-cream'
          } disabled:cursor-not-allowed disabled:opacity-40`}
        >
          {isListening && (
            <span className="absolute inset-0 animate-ping rounded-full border border-acid/30" />
          )}
          {isThinking ? (
            <Loader2 size={15} className="animate-spin" />
          ) : isSpeaking ? (
            <Square size={12} className="fill-current" />
          ) : (
            <Mic size={16} strokeWidth={1.9} />
          )}
        </button>

        <div className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 transition-colors focus-within:border-white/25">
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={placeholder}
              aria-label="Message Vex"
              maxLength={800}
              enterKeyHint="send"
              autoComplete="off"
              spellCheck={false}
              className="h-full w-full bg-transparent text-[13px] tracking-tight text-zinc-100 outline-none placeholder:text-zinc-600"
            />
        </div>

        <button
          type="submit"
          disabled={!text.trim()}
          aria-label="Send message"
          className="grid size-12 shrink-0 place-items-center rounded-full bg-ember text-[#1c0d05] shadow-[0_8px_26px_-12px_#ff6b35] transition-all hover:brightness-110 active:scale-95 disabled:bg-cream/[0.06] disabled:text-faint disabled:shadow-none disabled:active:scale-100"
        >
          <ArrowUp size={17} strokeWidth={2.3} />
        </button>
      </form>

      <p className="mt-2 text-center font-mono text-[8px] uppercase tracking-[0.16em] text-zinc-600">
        {!micSupported ? 'text only' : 'tap Vex to talk'}
      </p>
    </div>
  )
}
