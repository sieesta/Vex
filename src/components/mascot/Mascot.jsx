import { useEffect, useId, useState } from 'react'
import {
  animate,
  motion,
  MotionConfig,
  useAnimationControls,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'framer-motion'
import LaptopScene from './LaptopScene'

export const MASCOT_EMOTIONS = ['neutral', 'agree', 'angry', 'happy', 'thinking']

const INK = '#1f4d55'
const EYE = '#173a42'
const BERRY = '#4a1626'
const MOUTH_Y = 196
const EYE_Y = 150
const BROW_Y = 117

const CENTERED_GAZE = { x: 0, y: 0 }

const clamp01 = (value) => Math.min(1, Math.max(0, value))

/**
 * One row per emotion. Everything the face does is derived from these numbers,
 * so adding an emotion is a data change, not a rendering change.
 */
const FACE = {
  neutral: {
    smile: 0.6, width: 27, open: 0, mouthX: 0,
    eyeOpen: 1, tilt: 0, crescent: 0, crescentScale: 1, gazeX: 0, gazeY: 0,
    browL: { x: 0, y: 0, rotate: -4 }, browR: { x: 0, y: 0, rotate: 4 },
    cheek: '#ff9bb0', cheekOpacity: 0.5, cheekScale: 1, cheekShift: 0,
    puff: 0, marks: 0, flush: 0,
  },
  agree: {
    smile: 0.9, width: 30, open: 0.03, mouthX: -3,
    eyeOpen: 0.78, tilt: -3, crescent: 0, crescentScale: 1, gazeX: -3, gazeY: 1,
    browL: { x: 0, y: -6, rotate: -8 }, browR: { x: -4, y: 7, rotate: 14 },
    cheek: '#ff8fa6', cheekOpacity: 0.68, cheekScale: 1.08, cheekShift: 0,
    puff: 0, marks: 0, flush: 0,
  },
  angry: {
    smile: -0.68, width: 20, open: 0.06, mouthX: 0,
    eyeOpen: 0.62, tilt: 12, crescent: 0, crescentScale: 1, gazeX: 0, gazeY: 2,
    browL: { x: 7, y: 9, rotate: 26 }, browR: { x: -7, y: 9, rotate: -26 },
    cheek: '#ff4d5e', cheekOpacity: 0.85, cheekScale: 1.16, cheekShift: 8,
    puff: 1, marks: 1, flush: 0,
  },
  happy: {
    smile: 1, width: 34, open: 0.58, mouthX: 0,
    eyeOpen: 1, tilt: 0, crescent: 1, crescentScale: 1.2, gazeX: 0, gazeY: 0,
    browL: { x: 0, y: -9, rotate: -7 }, browR: { x: 0, y: -9, rotate: 7 },
    cheek: '#ff8aa3', cheekOpacity: 0.92, cheekScale: 1.2, cheekShift: 0,
    puff: 0, marks: 0, flush: 0,
  },
  thinking: {
    smile: 0.12, width: 17, open: 0, mouthX: 9,
    eyeOpen: 1, tilt: 0, crescent: 0, crescentScale: 1, gazeX: 5, gazeY: -8,
    browL: { x: 0, y: 4, rotate: 6 }, browR: { x: 0, y: -14, rotate: -14 },
    cheek: '#ff9bb0', cheekOpacity: 0.35, cheekScale: 0.95, cheekShift: 0,
    puff: 0, marks: 0, flush: 0,
  },
}

const REST = { x: 0, y: 0, rotate: 0, scale: 1, scaleY: 1 }

/** `pose` is where the body settles; `loop` is the repeating motion on top. */
const BODY = {
  neutral: { pose: REST },
  agree: {
    pose: { ...REST, rotate: -2.5, x: -3 },
    loop: {
      rotate: [-2.5, -3.5, -2.5],
      transition: { duration: 4.2, ease: 'easeInOut', repeat: Infinity },
    },
  },
  angry: {
    pose: { ...REST, scale: 1.03 },
    loop: {
      x: [0, -2.5, 2.5, -2, 2, 0],
      rotate: [0, -0.8, 0.8, -0.8, 0.8, 0],
      transition: { duration: 0.34, ease: 'linear', repeat: Infinity },
    },
  },
  happy: {
    pose: REST,
    loop: {
      y: [0, -13, 0, 0],
      scaleY: [1, 1.03, 0.96, 1],
      transition: { duration: 0.75, times: [0, 0.4, 0.8, 1], ease: 'easeOut', repeat: Infinity },
    },
  },
  thinking: {
    pose: { ...REST, rotate: -6, x: -6 },
    loop: {
      rotate: [-6, -8.5, -6],
      transition: { duration: 2.8, ease: 'easeInOut', repeat: Infinity },
    },
  },
}

/**
 * Arm poses are rotations around the shoulder. At 0 the arm points straight
 * out sideways; positive angles swing it down, negative lifts it up.
 */
const ARMS = {
  neutral: {
    right: { rotate: -58, x: 3, y: -2 },
    left: { rotate: 63, x: 0, y: 2 },
    wave: {
      rotate: [-58, -46, -58],
      transition: { duration: 1.5, ease: 'easeInOut', repeat: Infinity, repeatDelay: 0.6 },
    },
  },
  agree: {
    right: { rotate: 108, x: -6, y: 14 },
    left: { rotate: 72, x: 0, y: 2 },
  },
  angry: {
    right: { rotate: 126, x: -46, y: 18 },
    left: { rotate: 126, x: -46, y: 18 },
    tremble: {
      rotate: [126, 123.5, 126],
      transition: { duration: 0.3, ease: 'linear', repeat: Infinity },
    },
  },
  happy: {
    right: { rotate: -66, x: 6, y: -2 },
    left: { rotate: -66, x: 6, y: -2 },
    wave: {
      rotate: [-66, -58, -66],
      transition: { duration: 0.9, ease: 'easeInOut', repeat: Infinity },
    },
  },
  thinking: {
    right: { rotate: 136, x: -22, y: 24 },
    left: { rotate: 76, x: 0, y: 4 },
  },
}

const HOLD = {
  right: { rotate: 112, x: -28, y: 16 },
  left: { rotate: 112, x: -28, y: 16 },
  tremble: {
    rotate: [112, 109, 112],
    transition: { duration: 0.5, ease: 'linear', repeat: Infinity },
  },
}

const SETTLE = { type: 'spring', stiffness: 170, damping: 19 }

/**
 * Builds the mouth outline. Corners sit on a smile line; opening drops a rounder
 * lower lip and narrows the mouth so loud syllables read as an "o".
 */
function mouthGeometry(smile, width, baseOpen, mouthX, level) {
  const open = clamp01(baseOpen + level * (1 - baseOpen))
  const hw = width * (1 - 0.28 * open)
  const cx = 150 + mouthX
  const cornerY = MOUTH_Y - smile * 9 * (1 - open * 0.4)
  const topMid = MOUTH_Y + smile * 3 - open * 3
  const gap = open * 40
  const bottomMid = topMid + gap
  const topCtrl = 2 * topMid - cornerY
  const bottomCtrl = cornerY + (bottomMid - cornerY) / 0.75
  const roundness = 0.667 - 0.5 * open
  const left = cx - hw
  const right = cx + hw

  return {
    open,
    cx,
    hw,
    gap,
    topMid,
    d: `M ${left} ${cornerY} Q ${cx} ${topCtrl} ${right} ${cornerY} C ${right - roundness * hw} ${bottomCtrl} ${left + roundness * hw} ${bottomCtrl} ${left} ${cornerY} Z`,
  }
}

function useBlink() {
  const [blinking, setBlinking] = useState(false)

  useEffect(() => {
    let wait = 0
    let close = 0
    const schedule = () => {
      wait = window.setTimeout(() => {
        setBlinking(true)
        close = window.setTimeout(() => {
          setBlinking(false)
          schedule()
        }, 120)
      }, 3000 + Math.random() * 2000)
    }
    schedule()
    return () => {
      window.clearTimeout(wait)
      window.clearTimeout(close)
    }
  }, [])

  return blinking
}

function useIdleGaze(active) {
  const [gaze, setGaze] = useState({ x: 0, y: 0 })

  useEffect(() => {
    if (!active) return undefined
    let timer = 0
    const drift = () => {
      timer = window.setTimeout(() => {
        setGaze({ x: (Math.random() - 0.5) * 7, y: (Math.random() - 0.5) * 4 })
        drift()
      }, 1800 + Math.random() * 1800)
    }
    drift()
    return () => window.clearTimeout(timer)
  }, [active])

  return active ? gaze : CENTERED_GAZE
}

/** Two long antennae with a soft static glow at the tips. */
function Antenna({ side, reduceMotion }) {
  const controls = useAnimationControls()

  useEffect(() => {
    if (reduceMotion) return undefined
    controls.start({
      rotate: [0, side * 3.5, 0, side * -2, 0],
      transition: { duration: 5.4, ease: 'easeInOut', repeat: Infinity, delay: side === 1 ? 0.7 : 0 },
    })
    return () => controls.stop()
  }, [controls, reduceMotion, side])

  return (
    <g transform={`translate(${side === 1 ? 182 : 118} 88)`}>
      <motion.g animate={controls} initial={false}>
        <g transform={`scale(${-side} 1)`}>
          <path
            d="M 0 0 C -9 -17 -16 -30 -23 -41"
            fill="none"
            stroke={INK}
            strokeWidth="6"
            strokeLinecap="round"
          />
          <path
            d="M -1 0 C -9 -17 -16 -30 -23 -41"
            fill="none"
            stroke="#7fe3d5"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <circle cx="-23" cy="-47" r="15" fill="#8ef2e6" opacity="0.16" />
          <ellipse
            cx="-23"
            cy="-47"
            rx="8"
            ry="11.5"
            transform="rotate(-18 -23 -47)"
            fill="#a9f0e4"
            stroke={INK}
            strokeWidth="3.5"
          />
          <ellipse cx="-25" cy="-50" rx="2.6" ry="3.4" fill="#eafffb" opacity="0.85" />
        </g>
      </motion.g>
    </g>
  )
}

function Eye({ cx, side, face, blinking, gaze }) {
  return (
    <g transform={`translate(${cx} ${EYE_Y})`}>
      <motion.g
        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        initial={false}
        animate={{
          opacity: 1 - face.crescent,
          scaleY: blinking ? 0.08 : face.eyeOpen,
          x: face.gazeX + gaze.x,
          y: face.gazeY + gaze.y,
          rotate: -side * face.tilt,
        }}
        transition={{ duration: 0.24, ease: 'easeInOut', scaleY: { duration: blinking ? 0.07 : 0.22 } }}
      >
        <ellipse rx="14" ry="18" fill={EYE} />
        <circle cx="-4.5" cy="-6.5" r="5.6" fill="#fff" />
        <circle cx="5" cy="6" r="2.7" fill="#fff" opacity="0.9" />
        <circle cx="-5" cy="6.5" r="1.5" fill="#b8f5e9" opacity="0.55" />
      </motion.g>
      <motion.path
        d="M -16 5 Q 0 -16 16 5"
        fill="none"
        stroke={EYE}
        strokeWidth="6.5"
        strokeLinecap="round"
        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        initial={false}
        animate={{ opacity: face.crescent, scaleY: face.crescentScale }}
      />
    </g>
  )
}

function Brow({ cx, brow }) {
  return (
    <g transform={`translate(${cx} ${BROW_Y})`}>
      <motion.g
        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        initial={false}
        animate={brow}
        transition={{ type: 'spring', stiffness: 260, damping: 20 }}
      >
        <path d="M -14 1 Q 0 -5 14 1" fill="none" stroke={INK} strokeWidth="5.5" strokeLinecap="round" />
      </motion.g>
    </g>
  )
}

function Cheek({ cx, side, face }) {
  return (
    <motion.g
      style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
      initial={false}
      animate={{ x: side * face.cheekShift, scale: face.cheekScale, opacity: face.cheekOpacity }}
    >
      <motion.ellipse cx={cx} cy="184" rx="16" ry="10" initial={false} animate={{ fill: face.cheek }} />
      <path
        d={`M ${cx - 6} 179 l 4 7 M ${cx + 2} 178 l 4 7`}
        fill="none"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinecap="round"
        opacity="0.55"
      />
      <motion.path
        d={`M ${cx - 10} 181 l 5 9 M ${cx - 2} 180 l 5 9 M ${cx + 6} 181 l 5 9`}
        fill="none"
        stroke="#ff3d55"
        strokeWidth="3"
        strokeLinecap="round"
        initial={false}
        animate={{ opacity: face.marks }}
      />
    </motion.g>
  )
}

function Arm({ side, pose, loop, reduceMotion, skin }) {
  const controls = useAnimationControls()

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      await controls.start({ ...pose, transition: SETTLE })
      if (!cancelled && loop && !reduceMotion) controls.start(loop)
    }
    run()
    return () => {
      cancelled = true
      controls.stop()
    }
  }, [controls, pose, loop, reduceMotion])

  return (
    <g transform={`translate(${side === 1 ? 244 : 56} 178) scale(${side} 1)`}>
      <motion.g
        initial={false}
        animate={controls}
        style={{ originX: '15px', originY: '14px' }}
      >
        <circle cx="0" cy="0" r="15" fill={`url(#${skin})`} stroke={INK} strokeWidth="4" />
        <path
          d="M 0 -14 Q 10 -18 21 -15 Q 33 -12 34 -2 Q 35 9 23 13 Q 11 17 0 13 Z"
          fill={`url(#${skin})`}
          stroke={INK}
          strokeWidth="4"
          strokeLinejoin="round"
        />
        <circle cx="29" cy="-8" r="5.5" fill="#a9f0e4" stroke={INK} strokeWidth="3.5" />
        <circle cx="34" cy="1" r="12" fill="#a9f0e4" stroke={INK} strokeWidth="4" />
        <circle cx="30.5" cy="-2.5" r="3.2" fill="#eafffb" opacity="0.75" />
      </motion.g>
    </g>
  )
}

function Sparkles({ active, reduceMotion }) {
  const stars = [
    { x: 48, y: 92, size: 11, delay: 0 },
    { x: 253, y: 106, size: 8, delay: 0.35 },
    { x: 38, y: 158, size: 6, delay: 0.7 },
    { x: 262, y: 172, size: 9, delay: 0.15 },
  ]

  return (
    <g>
      {stars.map((star) => (
        <g key={`${star.x}-${star.y}`} transform={`translate(${star.x} ${star.y})`}>
          <motion.g
            style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
            initial={false}
            animate={
              active
                ? reduceMotion
                  ? { opacity: 0.55, scale: 0.7 }
                  : { opacity: [0.15, 0.95, 0.15], scale: [0.45, 1, 0.45] }
                : { opacity: 0, scale: 0.2 }
            }
            transition={
              active && !reduceMotion
                ? { duration: 1.8, delay: star.delay, repeat: Infinity, ease: 'easeInOut' }
                : { duration: 0.3 }
            }
          >
            <path
              d={`M 0 ${-star.size} C 1.5 ${-star.size * 0.25} 2.5 -1.5 ${star.size} 0 C 2.5 1.5 1.5 ${star.size * 0.25} 0 ${star.size} C -1.5 ${star.size * 0.25} -2.5 1.5 ${-star.size} 0 C -2.5 -1.5 -1.5 ${-star.size * 0.25} 0 ${-star.size} Z`}
              fill="#c9fff3"
            />
          </motion.g>
        </g>
      ))}
    </g>
  )
}

function ThoughtBubble({ active, reduceMotion }) {
  return (
    <g transform="translate(232 104)">
      {[0, 1, 2].map((index) => (
        <motion.circle
          key={index}
          cx={index * 8}
          cy={-index * 9}
          r={2.4 + index * 1.3}
          fill="#c9fff3"
          stroke={INK}
          strokeWidth="1.8"
          initial={false}
          animate={
            active
              ? reduceMotion
                ? { opacity: 0.8 }
                : { opacity: [0.25, 1, 0.25] }
              : { opacity: 0 }
          }
          transition={
            active && !reduceMotion
              ? { duration: 1.8, delay: index * 0.25, repeat: Infinity, ease: 'easeInOut' }
              : { duration: 0.2 }
          }
        />
      ))}
    </g>
  )
}

function AngerVein({ active, reduceMotion }) {
  return (
    <g transform="translate(240 78)">
      <motion.g
        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        initial={false}
        animate={active ? { opacity: 1, scale: reduceMotion ? 1 : [1, 1.2, 1] } : { opacity: 0, scale: 0.5 }}
        transition={
          active && !reduceMotion
            ? { opacity: { duration: 0.2 }, scale: { duration: 0.5, repeat: Infinity, ease: 'easeInOut' } }
            : { duration: 0.2 }
        }
      >
        <g fill="none" stroke="#ff4d5e" strokeWidth="4" strokeLinecap="round">
          <path d="M -13 -4 Q -4 -4 -4 -13" />
          <path d="M 4 -13 Q 4 -4 13 -4" />
          <path d="M -13 4 Q -4 4 -4 13" />
          <path d="M 4 13 Q 4 4 13 4" />
        </g>
      </motion.g>
    </g>
  )
}

/**
 * Mint-and-teal SVG mascot. Drives its mouth from `audioLevel` (0..1), its whole
 * face from `emotion`, and pulls out a laptop while a web action fires.
 */
export default function Mascot({ emotion = 'neutral', audioLevel = 0, webAction = null, className = '', label }) {
  const reduceMotion = useReducedMotion()
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const face = FACE[emotion] ?? FACE.neutral
  const key = FACE[emotion] ? emotion : 'neutral'

  const blinking = useBlink()
  const gaze = useIdleGaze(key === 'neutral' && !reduceMotion)

  const smile = useMotionValue(face.smile)
  const width = useMotionValue(face.width)
  const baseOpen = useMotionValue(face.open)
  const mouthX = useMotionValue(face.mouthX)

  const rawLevel = useMotionValue(0)
  const level = useSpring(rawLevel, { stiffness: 420, damping: 30, mass: 0.6 })

  useEffect(() => {
    rawLevel.set(Math.min(1, Math.pow(Math.max(0, audioLevel) * 1.25, 0.85)))
  }, [audioLevel, rawLevel])

  useEffect(() => {
    const spring = { type: 'spring', stiffness: 210, damping: 22 }
    const controls = [
      animate(smile, face.smile, spring),
      animate(width, face.width, spring),
      animate(baseOpen, face.open, spring),
      animate(mouthX, face.mouthX, spring),
    ]
    return () => controls.forEach((control) => control.stop())
  }, [face, smile, width, baseOpen, mouthX])

  const inputs = [smile, width, baseOpen, mouthX, level]
  const mouthPath = useTransform(inputs, (values) => mouthGeometry(...values).d)
  const tonguePath = useTransform(inputs, (values) => {
    const m = mouthGeometry(...values)
    const rx = m.hw * 0.5
    const ry = Math.max(0.1, m.gap * 0.34)
    const cy = m.topMid + m.gap * 0.86
    return `M ${m.cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${rx * 2} 0 a ${rx} ${ry} 0 1 0 ${-rx * 2} 0`
  })
  const tongueOpacity = useTransform(inputs, (values) => clamp01((mouthGeometry(...values).open - 0.15) * 4))

  const idle = useAnimationControls()
  const body = useAnimationControls()

  useEffect(() => {
    if (reduceMotion) return undefined
    idle.start({
      y: [0, -6, 0],
      scaleY: [1, 1.016, 1],
      transition: { duration: 4.2, ease: 'easeInOut', repeat: Infinity },
    })
    return () => idle.stop()
  }, [idle, reduceMotion])

  useEffect(() => {
    let cancelled = false
    const config = BODY[key]
    const run = async () => {
      await body.start({ ...config.pose, transition: SETTLE })
      if (!cancelled && config.loop && !reduceMotion) body.start(config.loop)
    }
    run()
    return () => {
      cancelled = true
      body.stop()
    }
  }, [key, body, reduceMotion])

  const arms = webAction ? HOLD : ARMS[key]
  const skin = `${uid}skin`
  const belly = `${uid}belly`
  const tint = `${uid}tint`
  const clip = `${uid}clip`

  return (
    <div
      className={`relative aspect-square w-full select-none ${className}`}
      role="img"
      aria-label={label ?? `Mascot feeling ${key}`}
    >
      <div
        className="pointer-events-none absolute bottom-[3%] left-1/2 h-[5%] w-[56%] -translate-x-1/2 rounded-full"
        style={{ background: 'radial-gradient(closest-side, rgba(0,0,0,0.42), transparent)' }}
      />
      <motion.div className="absolute inset-0" style={{ transformOrigin: '50% 92%' }} animate={idle}>
        <motion.div className="absolute inset-0" style={{ transformOrigin: '50% 88%' }} initial={REST} animate={body}>
          <MotionConfig transition={{ duration: 0.3, ease: 'easeInOut' }}>
            <svg viewBox="0 0 300 300" className="size-full overflow-visible" fill="none" aria-hidden="true">
              <defs>
                <linearGradient id={skin} gradientUnits="userSpaceOnUse" x1="150" y1="58" x2="150" y2="268">
                  <stop offset="0" stopColor="#c9f9ef" />
                  <stop offset="0.45" stopColor="#8fe9dc" />
                  <stop offset="1" stopColor="#4bc8c0" />
                </linearGradient>
                <linearGradient id={belly} gradientUnits="userSpaceOnUse" x1="150" y1="176" x2="150" y2="252">
                  <stop offset="0" stopColor="#e6fffa" stopOpacity="0.9" />
                  <stop offset="1" stopColor="#b6f3e8" stopOpacity="0.25" />
                </linearGradient>
                <radialGradient id={tint} cx="150" cy="176" r="112" gradientUnits="userSpaceOnUse">
                  <stop offset="0.35" stopColor="#ff5a70" stopOpacity="0.18" />
                  <stop offset="1" stopColor="#ff2d46" stopOpacity="0.8" />
                </radialGradient>
                <clipPath id={clip}>
                  <motion.path d={mouthPath} />
                </clipPath>
              </defs>

              <Antenna side={-1} reduceMotion={reduceMotion} />
              <Antenna side={1} reduceMotion={reduceMotion} />

              {/* Leaf tuft */}
              <g stroke={INK} strokeWidth="3.5" strokeLinejoin="round">
                <path d="M 140 84 C 128 70 124 56 128 46 C 140 54 146 68 148 82 Z" fill="#8fe9dc" />
                <path d="M 160 84 C 172 70 176 56 172 46 C 160 54 154 68 152 82 Z" fill="#8fe9dc" />
                <path d="M 150 82 C 144 64 146 48 153 36 C 161 50 160 68 156 82 Z" fill="#a9f0e4" />
              </g>

              {/* Feet */}
              <g stroke={INK} strokeWidth="4">
                <ellipse cx="113" cy="259" rx="25" ry="13" fill="#63d8cd" />
                <ellipse cx="187" cy="259" rx="25" ry="13" fill="#63d8cd" />
              </g>
              <path d="M 102 258 h 8 M 187 258 h 8" stroke={INK} strokeWidth="2.5" strokeLinecap="round" opacity="0.45" />

              {/* Body */}
              <path
                d="M 150 68 C 205 68 246 112 246 168 C 246 226 208 266 150 266 C 92 266 54 226 54 168 C 54 112 95 68 150 68 Z"
                fill={`url(#${skin})`}
                stroke={INK}
                strokeWidth="4.5"
              />
              <motion.path
                d="M 150 68 C 205 68 246 112 246 168 C 246 226 208 266 150 266 C 92 266 54 226 54 168 C 54 112 95 68 150 68 Z"
                fill={`url(#${tint})`}
                initial={false}
                animate={{ opacity: face.flush }}
              />
              <ellipse cx="150" cy="226" rx="46" ry="28" fill={`url(#${belly})`} opacity="0.55" />
              <ellipse cx="106" cy="101" rx="36" ry="14" fill="#fff" opacity="0.3" transform="rotate(-24 106 101)" />

              {/* Puffed cheeks when annoyed */}
              <motion.ellipse
                cx="58" cy="190" rx="26" ry="26" fill={`url(#${skin})`} stroke={INK} strokeWidth="4"
                style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                initial={false}
                animate={{ scale: face.puff ? 1 : 0.4, opacity: face.puff }}
              />
              <motion.ellipse
                cx="242" cy="190" rx="26" ry="26" fill={`url(#${skin})`} stroke={INK} strokeWidth="4"
                style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                initial={false}
                animate={{ scale: face.puff ? 1 : 0.4, opacity: face.puff }}
              />

              <Cheek cx={86} side={-1} face={face} />
              <Cheek cx={214} side={1} face={face} />

              <LaptopScene action={webAction} uid={uid} />

              <Arm side={1} pose={arms.right} loop={arms.wave ?? arms.tremble} reduceMotion={reduceMotion} skin={skin} />
              <Arm side={-1} pose={arms.left} loop={arms.tremble} reduceMotion={reduceMotion} skin={skin} />

              <Eye cx={111} side={-1} face={face} blinking={blinking} gaze={gaze} />
              <Eye cx={189} side={1} face={face} blinking={blinking} gaze={gaze} />

              <Brow cx={111} brow={face.browL} />
              <Brow cx={189} brow={face.browR} />

              <motion.path d={mouthPath} fill={BERRY} stroke={BERRY} strokeWidth="5" strokeLinejoin="round" />
              <g clipPath={`url(#${clip})`}>
                <motion.path d={tonguePath} fill="#ff7a93" style={{ opacity: tongueOpacity }} />
              </g>

              <Sparkles active={key === 'happy' || key === 'thinking'} reduceMotion={reduceMotion} />
              <ThoughtBubble active={key === 'thinking'} reduceMotion={reduceMotion} />
              <AngerVein active={face.marks > 0} reduceMotion={reduceMotion} />
            </svg>
          </MotionConfig>
        </motion.div>
      </motion.div>
    </div>
  )
}
