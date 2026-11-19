import { useState } from 'react'
import AgentBrainHUD from './components/AgentBrainHUD'
import { NoticeBanner, SearchLinkCard } from './components/Banners'
import ControlsPanel from './components/ControlsPanel'
import VexMascot from './components/VexMascot'
import { useBanterAgent } from './hooks/useBanterAgent'
import { useLocalStorageState } from './hooks/useLocalStorage'
import { emotionMeta } from './lib/emotions'
import { stripVocalTags } from './lib/speech'

const FIXED_VOICE = 'fil-PH-AngeloNeural'
const FIXED_SPICE_MODE = 'barkada'
const FIXED_HANDS_FREE = true

const buttonClass =
  'rounded-full border border-white/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400 transition-colors hover:border-white/25 hover:text-zinc-100'

function BrandMark({ accent }) {
  return (
    <span
      aria-hidden="true"
      className="relative size-7 shrink-0 rounded-full ring-1 ring-white/10"
      style={{
        background:
          'radial-gradient(circle at 32% 26%, #ecfeff 0%, #67e8f9 14%, #22d3ee 34%, #1e1b4b 70%, #09090b 100%)',
        boxShadow: `0 0 18px -4px ${accent}80`,
      }}
    >
      <span className="absolute inset-0 rounded-full bg-[radial-gradient(ellipse_at_28%_22%,rgba(255,255,255,.75),transparent_38%)]" />
      <span className="absolute inset-0 rounded-full ring-1 ring-inset ring-white/25" />
      <span className="absolute inset-[2px] rounded-full bg-[radial-gradient(circle_at_70%_76%,rgba(79,70,229,.55),transparent_55%)]" />
    </span>
  )
}

export default function App() {
  const [brainOpen, setBrainOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [onboardSkipped, setOnboardSkipped] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [ttsProvider, setTtsProvider] = useLocalStorageState(
    'vex.v1.ttsProvider',
    'elevenlabs',
    (value) => value === 'elevenlabs' || value === 'gemini',
  )

  const agent = useBanterAgent({
    voice: FIXED_VOICE,
    spiceMode: FIXED_SPICE_MODE,
    handsFree: FIXED_HANDS_FREE,
    ttsProvider,
  })
  const meta = emotionMeta(agent.emotion)

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#08090b] text-zinc-100">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0"
        style={{
          background: `radial-gradient(60% 45% at 50% 42%, ${meta.accent}18, transparent 70%)`,
        }}
      />

      <div className="relative mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-5">
        <header className="flex items-center justify-between py-5">
          <div className="flex items-center gap-2.5">
            <BrandMark accent={meta.accent} />
            <span className="font-display text-2xl italic leading-none text-zinc-50">Vex</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setBrainOpen((open) => !open)}
              aria-expanded={brainOpen}
              className={buttonClass}
            >
              brain
            </button>
            <button
              type="button"
              onClick={() => setHistoryOpen((open) => !open)}
              aria-expanded={historyOpen}
              className={buttonClass}
            >
              history
            </button>
            <button type="button" onClick={() => setConfirmReset(true)} className={buttonClass}>
              reset
            </button>
          </div>
        </header>

        <NoticeBanner notice={agent.notice} onDismiss={agent.dismissNotice} />

        <AgentBrainHUD
          open={brainOpen}
          state={agent.agentState}
          sentiment={agent.sentiment}
          frustration={agent.frustration}
          latency={agent.latency}
          messages={agent.messages}
          memory={agent.memory}
          handsFree={FIXED_HANDS_FREE}
          languageMode={agent.languageMode}
          studioOnline={agent.studioOnline}
          accent={meta.accent}
          ttsProvider={ttsProvider}
          onTtsProviderChange={setTtsProvider}
          onClose={() => setBrainOpen(false)}
        />

        {historyOpen && (
          <section
            aria-label="Call transcript"
            className="mb-3 max-h-64 overflow-y-auto rounded-[10px] border border-white/10 bg-[#120d0a]/95 p-3 shadow-xl"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="label-mono">transcript · {agent.messages.length}</span>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                className="font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-500 hover:text-zinc-200"
              >
                close
              </button>
            </div>
            {agent.messages.length === 0 ? (
              <p className="py-4 text-center font-mono text-[10px] text-zinc-600">No lines yet. Say something.</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {[...agent.messages].reverse().map((message) => (
                  <li key={message.id} className="border-t border-white/5 pt-2 first:border-0 first:pt-0">
                    <div className="mb-0.5 flex items-center gap-2 font-mono text-[8px] uppercase tracking-[0.12em] text-zinc-600">
                      <span className={message.role === 'user' ? 'text-cyan-300/70' : 'text-amber-200/70'}>
                        {message.role === 'user' ? 'you' : 'vex'}
                      </span>
                      {message.idle && <span>spoke up</span>}
                      {message.at ? new Date(message.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                    </div>
                    <p className="text-[11px] leading-snug text-zinc-300">
                      {message.display || stripVocalTags(message.content)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}

        <main className="flex flex-1 flex-col items-center justify-center gap-5 py-6">
          <p
            className="font-mono text-[9px] uppercase tracking-[0.32em]"
            style={{ color: meta.accent }}
          >
            {meta.label}
          </p>

          {agent.messages.length === 0 && !onboardSkipped && (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                const name = nameDraft.trim()
                if (!name) return
                agent.sendMessage(`My name is ${name}`)
                setNameDraft('')
                setOnboardSkipped(true)
              }}
              className="w-full max-w-sm rounded-[10px] border border-white/10 bg-white/[0.03] px-4 py-3 text-center"
            >
              <p className="mb-2.5 text-[11px] leading-snug text-zinc-400">
                Tell Vex your name — he'll remember it next time.
              </p>
              <div className="flex items-stretch gap-2">
                <input
                  aria-label="Your name"
                  value={nameDraft}
                  onChange={(event) => setNameDraft(event.target.value)}
                  placeholder="Your name"
                  maxLength={24}
                  className="min-w-0 flex-1 rounded-[4px] border border-white/10 bg-black/30 px-2.5 py-1.5 text-[11px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-cyan-300/40"
                />
                <button
                  type="submit"
                  className="rounded-[4px] bg-cream px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-night"
                >
                  teach him
                </button>
              </div>
              <button
                type="button"
                onClick={() => setOnboardSkipped(true)}
                className="mt-2 font-mono text-[8px] uppercase tracking-[0.14em] text-zinc-600 hover:text-zinc-400"
              >
                skip
              </button>
            </form>
          )}

          <VexMascot
            state={agent.agentState}
            emotion={agent.emotion}
            audioLevel={agent.audioLevel}
            spectrum={agent.spectrum}
            accent={meta.accent}
            webAction={agent.webAction}
            onPress={agent.togglePrimary}
          />

          {agent.interimTranscript ? (
            <p className="min-h-12 max-w-md px-2 text-center text-sm leading-relaxed text-zinc-300">
              {agent.interimTranscript}
            </p>
          ) : (
            <p className="min-h-12 max-w-md px-2 text-center text-sm leading-relaxed text-zinc-300">
              {agent.spokenText}
            </p>
          )}

          <SearchLinkCard link={agent.searchLink} onDismiss={agent.dismissSearchLink} />
        </main>

        <footer className="pb-5">
          <ControlsPanel
            showSettings={false}
            languageMode={agent.languageMode}
            onLanguageModeChange={agent.setLanguageMode}
            filipinoVoiceGender={agent.filipinoVoiceGender}
            onFilipinoVoiceGenderChange={agent.setFilipinoVoiceGender}
            handsFree={FIXED_HANDS_FREE}
            state={agent.agentState}
            onSend={agent.sendMessage}
            onMic={agent.togglePrimary}
            micSupported={agent.recognitionSupported}
          />
          <p className="mt-3 text-center font-mono text-[8px] uppercase tracking-[0.18em] text-zinc-600">
            {agent.studioOnline ? 'elevenlabs · gemini' : 'offline · local vex'}
          </p>
        </footer>
      </div>

      {confirmReset && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-5 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Reset Vex"
        >
          <div className="w-full max-w-xs rounded-[12px] border border-white/10 bg-[#15100d] p-5 shadow-2xl">
            <p className="font-display text-xl italic text-zinc-50">Reset Vex?</p>
            <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">
              This erases your name, everything Vex remembers, and the whole conversation.
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className={buttonClass}
              >
                no
              </button>
              <button
                type="button"
                onClick={() => {
                  agent.resetSession()
                  setConfirmReset(false)
                }}
                className="rounded-full border border-[#ff5a45]/40 bg-[#ff5a45]/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[#ff8a7a] transition-colors hover:bg-[#ff5a45]/20"
              >
                yes, reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
