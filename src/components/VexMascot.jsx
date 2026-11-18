import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import Mascot from './mascot/Mascot'
import MascotDebugBar, { useSimulatedSpeech } from './mascot/MascotDebugBar'

const EMOTION_TO_MASCOT = {
  chill: 'neutral',
  amused: 'happy',
  sarcastic: 'agree',
  annoyed: 'angry',
  frustrated: 'angry',
  unhinged: 'angry',
}

const DEMO_PLATFORMS = ['youtube', 'google', 'tiktok', 'github']

function mascotEmotion(state, emotion) {
  if (state === 'THINKING') return 'thinking'
  if (state === 'SPEAKING') return EMOTION_TO_MASCOT[emotion] ?? 'neutral'
  return 'neutral'
}

function ariaLabelFor(state) {
  if (state === 'SPEAKING' || state === 'THINKING') return 'Interrupt Vex and start talking'
  if (state === 'LISTENING') return 'Stop listening and send your message'
  return 'Talk to Vex'
}

export default function VexMascot({ state, emotion, audioLevel, accent, debug, webAction, onPress }) {
  const [forced, setForced] = useState(null)
  const [simulating, setSimulating] = useState(false)
  const [manualLevel, setManualLevel] = useState(0)
  const [demoAction, setDemoAction] = useState(null)
  const simulatedLevel = useSimulatedSpeech(debug && simulating)

  useEffect(() => {
    if (!demoAction) return undefined
    const timer = setTimeout(() => setDemoAction(null), 2000)
    return () => clearTimeout(timer)
  }, [demoAction])

  function simulateSite() {
    setDemoAction((current) => {
      const index = current ? (DEMO_PLATFORMS.indexOf(current.platform) + 1) % DEMO_PLATFORMS.length : 0
      return { platform: DEMO_PLATFORMS[index], phase: 'opening', id: Date.now() }
    })
  }

  const liveLevel = state === 'SPEAKING' ? audioLevel : 0
  const level = !debug ? liveLevel : simulating ? simulatedLevel : manualLevel > 0 ? manualLevel : liveLevel
  const shownEmotion = debug && forced ? forced : mascotEmotion(state, emotion)
  const shownAction = debug && demoAction ? demoAction : webAction
  const label = ariaLabelFor(state)

  return (
    <div className="flex w-full flex-col items-center gap-5">
      <div className="relative w-full max-w-[19rem] sm:max-w-[22rem]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-[6%] rounded-full blur-2xl transition-opacity duration-500"
          style={{
            background: `radial-gradient(closest-side, ${accent}33, transparent)`,
            opacity: state === 'SPEAKING' ? 0.5 + Math.min(1, level) * 0.5 : 0.35,
          }}
        />
        {state === 'LISTENING' && (
          <motion.span
            aria-hidden="true"
            className="pointer-events-none absolute inset-[10%] rounded-full border"
            style={{ borderColor: accent }}
            initial={{ scale: 0.9, opacity: 0.5 }}
            animate={{ scale: 1.15, opacity: 0 }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
          />
        )}
        <button
          type="button"
          onClick={onPress}
          aria-label={label}
          title={label}
          className="relative block w-full rounded-[2.5rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
        >
          <Mascot
            emotion={shownEmotion}
            audioLevel={level}
            webAction={shownAction}
            label={`Vex looks ${shownEmotion}`}
          />
        </button>
      </div>

      {debug && (
        <MascotDebugBar
          forced={forced}
          onForcedChange={setForced}
          simulating={simulating}
          onSimulatingChange={setSimulating}
          manualLevel={manualLevel}
          onManualLevelChange={setManualLevel}
          level={simulatedLevel}
          onSimulateSite={simulateSite}
        />
      )}
    </div>
  )
}
