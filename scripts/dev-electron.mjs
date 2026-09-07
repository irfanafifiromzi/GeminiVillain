// Starts Vite, then launches Electron pointed at it.
// Uses Vite's JS API so no extra dev dependencies are needed.

import { createServer } from 'vite'
import { spawn } from 'node:child_process'
import electron from 'electron'

const server = await createServer({ server: { port: 5173, strictPort: true } })
await server.listen()

const url = server.resolvedUrls?.local?.[0] ?? 'http://localhost:5173'
server.printUrls()

// Some hosts (VS Code integrated terminals, CI runners) export
// ELECTRON_RUN_AS_NODE=1, which would boot Electron as plain Node and leave
// require('electron') returning the CLI shim instead of the API.
const env = { ...process.env, GV_DEV_URL: url }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(electron, ['.'], { stdio: 'inherit', env })

const shutdown = async (code) => {
  await server.close().catch(() => {})
  process.exit(code ?? 0)
}

child.on('close', (code) => shutdown(code ?? 0))
process.on('SIGINT', () => {
  child.kill()
  void shutdown(0)
})
