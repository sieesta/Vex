import { useEffect } from 'react'
import { motion, useAnimationControls, useReducedMotion } from 'framer-motion'

const PLATFORM_TINT = {
  youtube: '#ff5a5a',
  facebook: '#5b8cff',
  tiktok: '#8ef2e6',
  instagram: '#ff8ac2',
  x: '#e7e7ea',
  reddit: '#ff8a5c',
  google: '#8ab4ff',
  github: '#d7d7de',
  spotify: '#7ee787',
  linkedin: '#6fb6ff',
}

const PLATFORM_LABEL = {
  youtube: 'YouTube',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  x: 'X',
  reddit: 'Reddit',
  google: 'Google',
  github: 'GitHub',
  spotify: 'Spotify',
  linkedin: 'LinkedIn',
}

const ENTER = { type: 'spring', stiffness: 170, damping: 18, mass: 0.7 }

/**
 * The little laptop Vex pulls in when a web action fires. Everything animates
 * with transform/opacity only — the SVG geometry itself never changes while the
 * scene plays, which keeps the whole mascot composited on the GPU.
 */
export default function LaptopScene({ action, uid }) {
  const reduceMotion = useReducedMotion()
  const controls = useAnimationControls()
  const platform = action?.platform
  const tint = PLATFORM_TINT[platform] || '#8ef2e6'
  const label = PLATFORM_LABEL[platform] || 'the web'
  const blocked = action?.phase === 'blocked'

  useEffect(() => {
    if (!action) return undefined
    let cancelled = false

    if (reduceMotion) {
      controls.set({ x: 0, y: 0, opacity: 1 })
      return () => {
        cancelled = true
        controls.stop()
      }
    }

    const play = async () => {
      controls.set({ x: 46, y: 54, opacity: 0 })
      await controls.start({
        x: 0,
        y: 0,
        opacity: 1,
        transition: { ...ENTER, opacity: { duration: 0.18 } },
      })
      if (cancelled) return
      await controls.start({
        y: blocked ? -2 : -6,
        transition: { duration: 0.35, ease: 'easeInOut' },
      })
      if (cancelled || blocked) return
      await controls.start({
        y: 62,
        opacity: 0,
        transition: { duration: 0.34, ease: 'easeIn' },
      })
    }
    play()

    return () => {
      cancelled = true
      controls.stop()
    }
  }, [action, blocked, controls, reduceMotion])

  const screen = `${uid}screen`
  const glow = `${uid}glow`
  const key = `${uid}key`

  return (
    <motion.g initial={{ x: 46, y: 54, opacity: 0 }} animate={controls}>
      <g transform="translate(150 262) scale(0.7)">
        {/* Soft aura so the laptop separates from the mint body. */}
        <ellipse cx="0" cy="-2" rx="66" ry="26" fill={`url(#${glow})`} opacity="0.55" />

        {/* Base + keyboard deck */}
        <path
          d="M -52 -8 L 52 -8 L 58 6 Q 58 12 51 12 L -51 12 Q -58 12 -58 6 Z"
          fill="#3c4a54"
          stroke="#1b2b31"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <rect x="-47" y="-3" width="94" height="9" rx="3" fill="#26343c" />
        {[-36, -18, 0, 18, 36].map((x) => (
          <path key={x} d={`M ${x - 6} 1 h 12`} stroke={`url(#${key})`} strokeWidth="2" strokeLinecap="round" />
        ))}
        <path d="M -20 8 h 40" stroke="#5d737e" strokeWidth="2.5" strokeLinecap="round" />

        {/* Lid, drawn from the hinge upward so scaleY reads as opening. */}
        <g transform="translate(0 -6)">
          <motion.g
            initial={false}
            animate={{ scaleY: action ? 1 : 0.1, opacity: action ? 1 : 0 }}
            transition={{ type: 'spring', stiffness: 150, damping: 17, delay: reduceMotion ? 0 : 0.16 }}
            style={{ transformBox: 'fill-box', transformOrigin: 'bottom' }}
          >
            <rect x="-54" y="-70" width="108" height="66" rx="7" fill="#2f3c44" stroke="#1b2b31" strokeWidth="3" />
            <rect x="-46" y="-63" width="92" height="52" rx="4" fill={`url(#${screen})`} />
            <rect x="-46" y="-63" width="92" height="52" rx="4" fill={tint} opacity="0.12" />

            {/* Browser chrome */}
            <path d="M -46 -52 h 92" stroke="#ffffff" strokeOpacity="0.22" strokeWidth="1.5" />
            <circle cx="-38" cy="-57.5" r="2.4" fill="#ff8a8a" />
            <circle cx="-29" cy="-57.5" r="2.4" fill="#ffce7a" />
            <circle cx="-20" cy="-57.5" r="2.4" fill="#8ef2a8" />

            {/* Address bar doubles as the platform tag, so nothing floats
                over Vex's face. */}
            <rect x="-12" y="-62" width="58" height="10" rx="5" fill="#071a20" stroke={blocked ? '#ffb35c' : tint} strokeWidth="1.2" />
            <circle cx="-5" cy="-57" r="2.2" fill={blocked ? '#ffb35c' : tint} />
            <text
              x="10"
              y="-54.2"
              textAnchor="middle"
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              fontSize="7.5"
              letterSpacing="0.4"
              fill="#dff7f1"
            >
              {blocked ? 'blocked' : label}
            </text>

            {/* Page skeleton + loading shimmer */}
            <rect x="-36" y="-43" width="28" height="6" rx="3" fill="#ffffff" opacity="0.5" />
            <rect x="-36" y="-31" width="62" height="4" rx="2" fill="#ffffff" opacity="0.28" />
            <rect x="-36" y="-23" width="48" height="4" rx="2" fill="#ffffff" opacity="0.22" />
            <motion.rect
              x="-36"
              y="-11"
              width="52"
              height="5"
              rx="2.5"
              fill={tint}
              initial={false}
              animate={action ? { scaleX: [0.1, 1] } : { scaleX: 0.1 }}
              transition={{ duration: reduceMotion ? 0 : 0.9, delay: reduceMotion ? 0 : 0.45, ease: 'easeInOut' }}
              style={{ transformBox: 'fill-box', transformOrigin: 'left' }}
            />

            {/* Screen sheen */}
            <path d="M -42 -63 L -18 -63 L -42 -34 Z" fill="#ffffff" opacity="0.05" />
          </motion.g>
        </g>

        {blocked && (
          <motion.g
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2 }}
            style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          >
            <circle cx="34" cy="-30" r="7.5" fill="#ffb35c" />
            <path d="M 34 -34.5 v 5" stroke="#3a2103" strokeWidth="2.2" strokeLinecap="round" />
            <circle cx="34" cy="-26" r="1.4" fill="#3a2103" />
          </motion.g>
        )}
      </g>

      <defs>
        <radialGradient id={glow} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#8ef2e6" stopOpacity="0.5" />
          <stop offset="1" stopColor="#8ef2e6" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={screen} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0d2a33" />
          <stop offset="1" stopColor="#071a20" />
        </linearGradient>
        <linearGradient id={key} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#7fe3d5" stopOpacity="0.25" />
          <stop offset="0.5" stopColor="#b8f5e9" stopOpacity="0.75" />
          <stop offset="1" stopColor="#7fe3d5" stopOpacity="0.25" />
        </linearGradient>
      </defs>
    </motion.g>
  )
}
