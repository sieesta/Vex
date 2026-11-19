/**
 * Microsoft Edge "Read Aloud" speech synthesis.
 *
 * Edge exposes a keyless neural TTS endpoint that browsers use for Read Aloud.
 * We use it for the mascot because its Filipino voice (Blessica) pronounces
 * Taglish like a real person instead of an American narrator reading Filipino.
 *
 * The WebSocket protocol and the Sec-MS-GEC request token are adapted from the
 * MIT-licensed `msedge-tts` project. No Microsoft account or API key is used.
 */
import { randomUUID, webcrypto } from 'node:crypto'
import { WebSocket } from 'ws'

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
const EDGE_COPYRIGHT = 'Copyright (C) Microsoft Corporation. All rights reserved.'
const SEC_MS_GEC_VERSION = '2-143.0.3650.96'
const EDGE_ORIGIN = 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold'
const EDGE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0'
const AUDIO_DELIM = Buffer.from('Path:audio\r\n')
const JSON_DELIM = '\r\n\r\n'
const OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3'

const SWAP_FIRST_WORD = { swappedWord: 0xef0569fb, swappedSum: 0x76f50f34, swappedProduct: 0xc3efea97 }
const SWAP_SECOND_WORD = { swappedWord: 0xc31713db, swappedSum: 0x1881ce3c, swappedProduct: 0x35bd1ec9 }
const MIX_FIRST_WORD = [0xcf98b111, 0x87085b9f, 0x12ceb96d, 0x257e1d83]
const MIX_SECOND_WORD = [0xa27416f5, 0xd38396ff, 0x7c932b89, 0xbfa49f69]

function swapHalves(value) {
  return ((value << 16) | (value >>> 16)) >>> 0
}

function swapTerm(word, key, multipliers) {
  const sum = Math.imul(word, key) + Math.imul(swapHalves(word), multipliers.swappedWord)
  const product = Math.imul(swapHalves(sum), multipliers.swappedSum) >>> 0
  return (Math.imul(swapHalves(product), multipliers.swappedProduct) + product) >>> 0
}

function swapAndMultiply(value, multipliers) {
  let next = value
  for (const multiplier of multipliers) next = Math.imul(swapHalves(next), multiplier) >>> 0
  return next
}

function toUpperHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase()
}

function cs64(message, digest) {
  const digestView = new DataView(digest.buffer, digest.byteOffset, digest.byteLength)
  const firstKey = (digestView.getUint32(0, true) | 1) >>> 0
  const secondKey = (digestView.getUint32(4, true) | 1) >>> 0
  const padded = new Uint8Array(Math.ceil(message.length / 8) * 8)
  padded.set(message)
  const words = new DataView(padded.buffer)
  let swapSum = 0
  let lastSwap = 0
  let mix = 0
  let mixSum = 0

  for (let offset = 0; offset < padded.length; offset += 8) {
    const firstWord = words.getUint32(offset, true)
    const secondWord = words.getUint32(offset + 4, true)
    const firstSwap = swapTerm(firstWord, firstKey, SWAP_FIRST_WORD)
    lastSwap = swapTerm(secondWord, secondKey, SWAP_SECOND_WORD)
    swapSum = (swapSum + firstSwap + lastSwap) >>> 0
    mix = swapAndMultiply(Math.imul(mix + firstWord, firstKey), MIX_FIRST_WORD)
    mixSum = (mixSum + mix) >>> 0
    mix = swapAndMultiply(Math.imul(mix + secondWord, secondKey), MIX_SECOND_WORD)
    mixSum = (mixSum + mix) >>> 0
  }

  const checksum = new Uint8Array(8)
  const view = new DataView(checksum.buffer)
  view.setUint32(0, lastSwap ^ mix, true)
  view.setUint32(4, swapSum ^ mixSum, true)
  return checksum
}

async function secMsGec() {
  // Edge rotates the token every five minutes. BigInt keeps the Windows epoch
  // ticks exact; the server recomputes the same value from its own clock.
  const ticks = BigInt(Math.floor(Date.now() / 1000)) + 11644473600n
  const rounded = ticks - (ticks % 300n)
  const windowsTicks = rounded * 10000000n
  const input = `${windowsTicks}${TRUSTED_CLIENT_TOKEN}`
  const message = new TextEncoder().encode(`${EDGE_COPYRIGHT}${input}`)
  const digest = new Uint8Array(await webcrypto.subtle.digest('SHA-256', message))
  return `${toUpperHex(cs64(message, digest))}-${toUpperHex(digest)}`
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function ssml({ text, voice, lang, pitch, rate, volume }) {
  // The shaped text already carries the breath: "AHH, AHH!!". Edge reads the
  // comma as a short pause — an SSML <break> element closes the Read Aloud
  // socket, so punctuation is the reliable way to get the pause.
  const spoken = escapeXml(text)
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${escapeXml(lang)}"><voice name="${escapeXml(voice)}"><prosody pitch="${escapeXml(pitch)}" rate="${escapeXml(rate)}" volume="${escapeXml(volume)}">${spoken}</prosody></voice></speak>`
}

function parseWordTimings(message) {
  try {
    const split = message.indexOf(JSON_DELIM)
    if (split === -1) return []
    const parsed = JSON.parse(message.slice(split + JSON_DELIM.length))
    const events = parsed?.Metadata || []
    return events
      .filter((event) => event?.Type === 'WordBoundary' && event?.Data)
      .map((event) => {
        const data = event.Data
        const label = data.text?.Text ?? data.text ?? data.Text ?? ''
        return {
          text: String(label),
          // Edge reports offsets/durations in 100-nanosecond ticks.
          offset: Number(data.Offset || 0) / 10_000_000,
          duration: Number(data.Duration || 0) / 10_000_000,
        }
      })
      .filter((word) => word.text)
  } catch {
    return []
  }
}

/**
 * Synthesize one line and resolve with the MP3 bytes plus word timings.
 *
 * @param {object} options
 * @param {string} options.text
 * @param {string} options.voice  Edge ShortName, e.g. fil-PH-BlessicaNeural
 * @param {string} options.lang   e.g. fil-PH
 * @param {string} [options.pitch]
 * @param {string} [options.rate]
 * @param {string} [options.volume]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{audio: Buffer, words: Array<{text: string, offset: number, duration: number}>}>}
 *   offsets/durations are seconds relative to the start of the audio.
 */
export async function synthesizeEdgeSpeech({
  text,
  voice,
  lang,
  pitch = '+0Hz',
  rate = '+0%',
  volume = '+0%',
  timeoutMs = 12_000,
}) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 1200)
  if (!clean) throw new Error('Nothing to say.')

  const requestId = randomUUID().replace(/-/g, '')
  const token = await secMsGec()
  const url =
    `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1` +
    `?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
    `&Sec-MS-GEC=${encodeURIComponent(token)}` +
    `&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}` +
    `&ConnectionId=${requestId}`

  const config =
    `Content-Type:application/json; charset=utf-8\r\nPath:speech.config${JSON_DELIM}` +
    JSON.stringify({
      context: {
        synthesis: {
          audio: {
            metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'true' },
            outputFormat: OUTPUT_FORMAT,
          },
        },
      },
    })

  const request =
    `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml${JSON_DELIM}` +
    ssml({ text: clean, voice, lang, pitch, rate, volume })

  const socket = new WebSocket(url, {
    headers: { 'User-Agent': EDGE_USER_AGENT, Origin: EDGE_ORIGIN },
  })

  return new Promise((resolve, reject) => {
    const chunks = []
    const words = []
    let settled = false
    let sawEnd = false

    const timer = setTimeout(() => fail(new Error('Edge TTS timed out.')), timeoutMs)

    function cleanup() {
      clearTimeout(timer)
      try {
        socket.terminate()
      } catch {
        /* already closed */
      }
    }

    function fail(error) {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }

    function succeed() {
      if (settled) return
      if (!chunks.length) return fail(new Error('Edge TTS returned no audio.'))
      settled = true
      cleanup()
      resolve({ audio: Buffer.concat(chunks), words })
    }

    socket.on('open', () => {
      socket.send(config)
      socket.send(request)
    })

    socket.on('message', (data, isBinary) => {
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data)
      if (isBinary) {
        const marker = buffer.indexOf(AUDIO_DELIM)
        if (marker !== -1) chunks.push(buffer.subarray(marker + AUDIO_DELIM.length))
        return
      }

      const message = buffer.toString('utf8')
      if (message.includes('Path:audio.metadata')) {
        words.push(...parseWordTimings(message))
      } else if (message.includes('Path:turn.end')) {
        sawEnd = true
        succeed()
      }
    })

    socket.on('error', (error) => fail(error))
    socket.on('close', () => {
      if (settled) return
      if (sawEnd) succeed()
      else fail(new Error('Edge TTS closed before the line finished.'))
    })
  })
}
