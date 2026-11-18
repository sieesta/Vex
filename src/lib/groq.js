import { USE_PROXY, proxyCall } from './proxy'

const DEFAULT_MODEL = 'openai/gpt-oss-120b'

export class GroqRequestError extends Error {
  constructor(status, detail, retryAfter = null) {
    super(`Groq request failed (${status}): ${detail}`)
    this.name = 'GroqRequestError'
    this.status = status
    this.detail = detail
    this.retryAfter = retryAfter
  }
}

async function responseDetail(response) {
  try {
    const body = await response.text()
    return body.slice(0, 400) || response.statusText
  } catch {
    return response.statusText || 'Unknown Groq error'
  }
}

/**
 * One request, one line. The caller owns rotation, cooldowns and retries so a
 * rate-limited key can rest without the conversation ever noticing.
 */
export async function generateGroqChat({
  key,
  model = DEFAULT_MODEL,
  systemInstruction,
  history,
  abortSignal,
} = {}) {
  if (USE_PROXY) {
    const data = await proxyCall('groq-chat', { model, systemInstruction, history }, { abortSignal })
    return data.content
  }
  if (!key) throw new Error('No studio line is available.')

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: String(systemInstruction || '') },
        ...(history || []).map((message) => ({
          role: message.role === 'assistant' ? 'assistant' : 'user',
          content: String(message.content || ''),
        })),
      ],
      temperature: 0.8,
      max_tokens: 220,
      reasoning_effort: 'low',
    }),
    signal: abortSignal,
  })

  if (!response.ok) {
    const retryAfter = Number(response.headers.get('retry-after'))
    throw new GroqRequestError(
      response.status,
      await responseDetail(response),
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    )
  }

  let payload
  try {
    payload = await response.json()
  } catch {
    throw new Error('Groq returned an unreadable response.')
  }

  const content = payload.choices?.[0]?.message?.content?.trim()
  if (!content) throw new Error('Groq returned an empty completion.')
  return content
}
