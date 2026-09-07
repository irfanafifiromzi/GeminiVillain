import { invoke, listen, type Unlisten } from '@/lib/backend'

export interface SpawnOptions {
  /** Caller-assigned, so listeners can filter before the shell speaks. */
  id: string
  shell?: string
  /** Left empty, the host picks sensible defaults for the shell it chose. */
  args?: string[]
  cwd?: string
  cols: number
  rows: number
}

export interface SpawnResult {
  id: string
  shell: string
  cwd: string
}

interface OutputEvent {
  id: string
  /** base64-encoded pty bytes */
  data: string
}

interface ExitEvent {
  id: string
  code: number | null
}

export const spawn = (opts: SpawnOptions) => invoke<SpawnResult>('pty_spawn', { ...opts })
export const write = (id: string, data: string) => invoke<void>('pty_write', { id, data })
export const resize = (id: string, cols: number, rows: number) =>
  invoke<void>('pty_resize', { id, cols, rows })
export const kill = (id: string) => invoke<void>('pty_kill', { id })

const decodeBase64 = (b64: string): Uint8Array => {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * Output arrives on one global channel; each terminal filters by its own id.
 * Raw bytes are handed to xterm so multi-byte characters split across reads
 * are reassembled by its own decoder.
 */
export const onOutput = (
  handler: (id: string, bytes: Uint8Array) => void,
): Promise<Unlisten> =>
  listen<OutputEvent>('pty://output', (p) => handler(p.id, decodeBase64(p.data)))

export const onExit = (handler: (id: string, code: number | null) => void): Promise<Unlisten> =>
  listen<ExitEvent>('pty://exit', (p) => handler(p.id, p.code))
