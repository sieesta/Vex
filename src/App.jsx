import { useState } from 'react'
import AgentBrainHUD from './components/AgentBrainHUD'
import { NoticeBanner, SearchLinkCard } from './components/Banners'
import ControlsPanel from './components/ControlsPanel'
import VexMascot from './components/VexMascot'
import { useBanterAgent } from './hooks/useBanterAgent'
import { useLocalStorageState } from './hooks/useLocalStorage'
import { emotionMeta } from './lib/emotions'

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
  const [debugOpen, setDebugOpen] = useState(false)
  const [delivery, setDelivery] = useLocalStorageState(
    'vex.v1.delivery',
    0,
    (value) => Number.isInteger(value) && value >= 0 && value <= 3,
  )

  const agent = useBanterAgent({
    voice: FIXED_VOICE,
    spiceMode: FIXED_SPICE_MODE,
    handsFree: FIXED_HANDS_FREE,
    delivery,
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
              onClick={() => setDebugOpen((open) => !open)}
              aria-pressed={debugOpen}
              className={buttonClass}
            >
              debug
            </button>
            <button type="button" onClick={agent.resetSession} className={buttonClass}>
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
          handsFree={FIXED_HANDS_FREE}
          languageMode={agent.languageMode}
          studioOnline={agent.studioOnline}
          accent={meta.accent}
        />

        <main className="flex flex-1 flex-col items-center justify-center gap-5 py-6">
          <p
            className="font-mono text-[9px] uppercase tracking-[0.32em]"
            style={{ color: meta.accent }}
          >
            {meta.label}
          </p>

          <VexMascot
            state={agent.agentState}
            emotion={agent.emotion}
            audioLevel={agent.audioLevel}
            accent={meta.accent}
            debug={debugOpen}
            webAction={agent.webAction}
            onPress={agent.togglePrimary}
          />

          <p className="min-h-12 max-w-md px-2 text-center text-sm leading-relaxed text-zinc-300">
            {agent.interimTranscript || agent.lastReply}
          </p>

          <SearchLinkCard link={agent.searchLink} onDismiss={agent.dismissSearchLink} />
        </main>

        <footer className="pb-5">
          <ControlsPanel
            showSettings={false}
            showDelivery
            delivery={delivery}
            onDeliveryChange={setDelivery}
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
            {agent.studioOnline ? 'elevenlabs · gemini · groq' : 'offline · local vex'}
          </p>
        </footer>
      </div>
    </div>
  )
}
