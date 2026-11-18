import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import voiceHandler from './api/voice.js'

const ENV_FILE = fileURLToPath(new URL('./.env', import.meta.url))

/** Load .env values into process.env for the local preview proxy. */
function loadLocalEnv() {
  if (!fs.existsSync(ENV_FILE)) return
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (match && !match[1].startsWith('VITE_')) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '')
    }
  }
}

/** Emulate the Vercel function locally so the production path is testable. */
function localProxy() {
  return {
    name: 'vex-local-proxy',
    configurePreviewServer(server) {
      loadLocalEnv()
      server.middlewares.use('/api/voice', async (req, res) => {
        const url = new URL(req.url, 'http://localhost')
        const wrapped = {
          method: req.method,
          query: Object.fromEntries(url.searchParams),
          body: undefined,
        }
        if (req.method === 'POST') {
          const chunks = []
          for await (const chunk of req) chunks.push(chunk)
          try {
            wrapped.body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
          } catch {
            wrapped.body = {}
          }
        }
        try {
          await voiceHandler(wrapped, res)
        } catch (error) {
          console.error('[local proxy]', error)
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: error.message }))
        }
      })
    },
  }
}

// OneDrive sync kept restoring index.html with the legacy /src/vex/ entry.
// Force the correct entry at serve/build time so a stale HTML file can't
// bring back the old UI.
const forceAdvancedEntry = {
  name: 'force-advanced-entry',
  transformIndexHtml(html) {
    return html.replace(/\/src\/vex\/main\.jsx/g, '/src/main.jsx')
  },
}

export default defineConfig({
  plugins: [react(), tailwindcss(), forceAdvancedEntry, localProxy()],
  build: {
    chunkSizeWarningLimit: 900,
  },
})
