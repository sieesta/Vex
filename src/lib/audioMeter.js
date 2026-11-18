/**
 * Thin wrapper around one MediaElementAudioSourceNode + AnalyserNode.
 * fftSize = 64 keeps the visualiser cheap and honest for a voice signal.
 */
export function createAudioMeter() {
  let ctx = null
  let analyser = null
  let source = null
  let attachedEl = null
  let frequency = null
  let frame = 0
  let level = 0

  function ensureContext() {
    if (ctx) return ctx
    if (typeof window === 'undefined') return null
    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    if (!AudioContextClass) return null

    try {
      ctx = new AudioContextClass()
      analyser = ctx.createAnalyser()
      analyser.fftSize = 64
      analyser.smoothingTimeConstant = 0.74
      analyser.minDecibels = -92
      analyser.maxDecibels = -22
      frequency = new Uint8Array(analyser.frequencyBinCount)
    } catch {
      ctx = null
      analyser = null
    }
    return ctx
  }

  function attach(mediaElement) {
    const audioContext = ensureContext()
    if (!audioContext || !analyser || !mediaElement || attachedEl === mediaElement) return false
    try {
      source = audioContext.createMediaElementSource(mediaElement)
      source.connect(analyser)
      analyser.connect(audioContext.destination)
      attachedEl = mediaElement
      return true
    } catch {
      return false
    }
  }

  function resume() {
    const audioContext = ensureContext()
    if (audioContext?.state === 'suspended') {
      audioContext.resume().catch(() => {})
    }
  }

  function start(onFrame) {
    if (!ensureContext() || !analyser) return
    stop()

    const tick = () => {
      analyser.getByteFrequencyData(frequency)
      const bins = Array.from(frequency, (value) => Math.pow(value / 255, 1.25))

      let sum = 0
      for (let i = 1; i < frequency.length; i += 1) sum += frequency[i]
      const average = sum / Math.max(1, frequency.length - 1) / 255
      const target = Math.min(1, Math.max(0, average * 2.3))
      level += (target - level) * 0.32

      onFrame({ level, bins })
      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
  }

  function stop() {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
  }

  function destroy() {
    stop()
    level = 0
    try {
      source?.disconnect()
      analyser?.disconnect()
      ctx?.close()
    } catch {
      /* no-op */
    }
    source = null
    analyser = null
    attachedEl = null
    frequency = null
    ctx = null
  }

  return { attach, resume, start, stop, destroy }
}
