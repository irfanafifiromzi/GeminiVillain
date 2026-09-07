import { reactive, computed } from 'vue'
import { invoke } from '@/lib/backend'

export interface Server {
  id: string
  name: string
  host: string
  user: string
  port: number
  /** Path to a private key. Empty means "let ssh pick" (agent, default keys). */
  keyPath: string
  description: string
  /** Marks a server you cannot afford to break. Guarded before every run. */
  production: boolean
}

const uid = () => crypto.randomUUID()

export const blankServer = (): Omit<Server, 'id'> => ({
  name: '',
  host: '',
  user: '',
  port: 22,
  keyPath: '',
  description: '',
  production: false,
})

const state = reactive({
  servers: [] as Server[],
  selectedId: null as string | null,
  loaded: false,
})

const persist = async () => {
  try {
    await invoke('servers_save', { servers: state.servers })
  } catch (e) {
    console.error('failed to save servers', e)
  }
}

/**
 * Build the ssh argument list for a profile.
 *
 * GeminiVillain does not implement SSH — it shells out to the OpenSSH client
 * that ships with Windows, inside the same pty as every other terminal.
 */
export const sshArgs = (server: Server): string[] => {
  const args: string[] = []
  if (server.port && server.port !== 22) args.push('-p', String(server.port))
  if (server.keyPath.trim()) args.push('-i', server.keyPath.trim())
  // Ask for a pty explicitly; without it ssh gives a dumb terminal when the
  // client's own stdin is not a console.
  args.push('-t')
  args.push(server.user.trim() ? `${server.user.trim()}@${server.host.trim()}` : server.host.trim())
  return args
}

/** The command line as the user would have typed it, for display. */
export const sshCommand = (server: Server): string => `ssh ${sshArgs(server).join(' ')}`

/** Connection flags shared by every ssh invocation. */
const baseArgs = (server: Server): string[] => {
  const args: string[] = []
  if (server.port && server.port !== 22) args.push('-p', String(server.port))
  if (server.keyPath.trim()) args.push('-i', server.keyPath.trim())
  return args
}

const targetOf = (server: Server) =>
  server.user.trim() ? `${server.user.trim()}@${server.host.trim()}` : server.host.trim()

/**
 * Run one command on a server.
 *
 * `ssh host "cmd"` exits with the *remote* command's status, which is what
 * makes stop-on-failure work across machines.
 *
 * Non-interactive steps get BatchMode, so a host that wants a password fails
 * with a clear message instead of hanging forever on a prompt nobody can see.
 * Run such a step as "Keep running" instead — that opens a real tab you can
 * type into.
 */
export const sshExecArgs = (server: Server, command: string, interactive: boolean): string[] => {
  const args = baseArgs(server)
  args.push('-o', 'ConnectTimeout=10')
  if (interactive) {
    args.push('-t')
  } else {
    args.push('-o', 'BatchMode=yes')
  }
  args.push(targetOf(server), command)
  return args
}

/** What the run log shows for a remote step. */
export const sshExecPreview = (server: Server, command: string) =>
  `ssh ${targetOf(server)} "${command.replace(/\s*\r?\n\s*/g, '; ')}"`

export const useServers = () => {
  const selected = computed(() => state.servers.find((s) => s.id === state.selectedId) ?? null)

  const load = async () => {
    if (state.loaded) return
    try {
      const raw = await invoke<Server[]>('servers_load')
      // Older profiles predate the production flag.
      state.servers = Array.isArray(raw)
        ? raw.map((s) => ({ ...s, production: s.production ?? false }))
        : []
    } catch (e) {
      console.error('failed to load servers', e)
      state.servers = []
    }
    state.loaded = true
  }

  const add = async (input: Omit<Server, 'id'>) => {
    const server: Server = { ...input, id: uid() }
    state.servers.push(server)
    state.selectedId = server.id
    await persist()
    return server
  }

  const update = async (id: string, patch: Partial<Omit<Server, 'id'>>) => {
    const server = state.servers.find((s) => s.id === id)
    if (!server) return
    Object.assign(server, patch)
    await persist()
  }

  const remove = async (id: string) => {
    const index = state.servers.findIndex((s) => s.id === id)
    if (index === -1) return
    state.servers.splice(index, 1)
    if (state.selectedId === id) state.selectedId = null
    await persist()
  }

  const select = (id: string | null) => {
    state.selectedId = id
  }

  return { state, selected, load, add, update, remove, select }
}
