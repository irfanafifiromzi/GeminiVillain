import * as pty from '@/lib/pty'

/** Everything needed to launch one command, local or remote. */
export interface ExecSpec {
  shell?: string
  args: string[]
  cwd?: string
}

export interface ExecOptions {
  /** Called with each decoded, ANSI-stripped chunk as it arrives. */
  onData?: (chunk: string) => void
  /** Receives the pty id before the process starts, so it can be killed. */
  onStart?: (id: string) => void
}

export interface ExecResult {
  code: number
  output: string
}

/** CSI/OSC escape sequences: useful in a terminal, noise in a log. */
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][0-9A-B]/g
export const stripAnsi = (s: string) => s.replace(ANSI, '')

/**
 * Run one command to completion and resolve with its exit code and output.
 *
 * Deliberately not a terminal tab: callers here want a result, not a session.
 * Each ConPTY session clears the screen when it starts, so sharing one xterm
 * across sequential commands would erase what came before.
 */
export const execOnce = (spec: ExecSpec, options: ExecOptions = {}): Promise<ExecResult> =>
  new Promise((resolve) => {
    const id = crypto.randomUUID()
    const decoder = new TextDecoder()
    let output = ''
    let unlistenOut: (() => void) | null = null
    let unlistenExit: (() => void) | null = null

    const finish = (code: number) => {
      unlistenOut?.()
      unlistenExit?.()
      resolve({ code, output })
    }

    void (async () => {
      unlistenOut = await pty.onOutput((outId, bytes) => {
        if (outId !== id) return
        const chunk = stripAnsi(decoder.decode(bytes, { stream: true }))
        output += chunk
        options.onData?.(chunk)
      })
      unlistenExit = await pty.onExit((exitId, code) => {
        if (exitId === id) finish(code ?? 0)
      })

      try {
        // Announced before spawning: a fast command can exit before it resolves.
        options.onStart?.(id)
        await pty.spawn({ id, ...spec, cols: 120, rows: 40 })
      } catch (e) {
        output += `\n${String(e)}\n`
        finish(1)
      }
    })()
  })

/** A local PowerShell one-shot. */
export const localSpec = (command: string, cwd: string): ExecSpec => ({
  // -NoProfile keeps a slow or noisy profile out of the output.
  args: ['-NoLogo', '-NoProfile', '-Command', command],
  cwd,
})
