import { useEffect } from 'react'
import { motion, useSpring } from 'framer-motion'
import Mascot from './mascot/Mascot'

const EMOTION_TO_MASCOT = {
  chill: 'neutral',
  amused: 'happy',
  sarcastic: 'agree',
  annoyed: 'angry',
  frustrated: 'angry',
  unhinged: 'angry',
}

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

export default function VexMascot({ state, emotion, audioLevel, spectrum, accent, webAction, onPress }) {
  const level = state === 'SPEAKING' ? audioLevel : 0
  const shownEmotion = mascotEmotion(state, emotion)
  const label = ariaLabelFor(state)

  // The spectrum is already measured for the mouth. Reuse it so the whole
  // creature breathes with his own voice, not just the lips.
  const energy = spectrum?.length
    ? spectrum.reduce((sum, bin) => sum + bin, 0) / spectrum.length
    : 0
  const haloScale = useSpring(1, { stiffness: 140, damping: 18 })
  const haloOpacity = useSpring(0.24, { stiffness: 140, damping: 18 })
  useEffect(() => {
    haloScale.set(1 + energy * 0.17)
    haloOpacity.set(0.22 + energy * 0.55)
  }, [energy, haloScale, haloOpacity])

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

        {/* Audio-reactive halo: scales and brightens with the voice spectrum. */}
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-[3%] rounded-full"
          style={{
            scale: haloScale,
            opacity: haloOpacity,
            background: `radial-gradient(closest-side, ${accent}66, transparent 72%)`,
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
            webAction={webAction}
            label={`Vex looks ${shownEmotion}`}
          />
        </button>
      </div>
    </div>
  )
}
