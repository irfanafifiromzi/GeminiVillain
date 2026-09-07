import { reactive } from 'vue'

export interface TerminalTab {
  id: string
  /** Stable key for the Vue component; survives the pty id being assigned late. */
  key: string
  title: string
  cwd: string | null
  shell: string | null
  /** Forces a specific program instead of the host's default shell (e.g. ssh). */
  shellOverride: string | null
  args: string[] | null
  projectId: string | null
  serverId: string | null
  /** Replaces the wordmark's tagline — used to label an SSH target. */
  subtitle: string | null
  /** Command typed into the shell as soon as it is ready. */
  pendingCommand: string | null
  /** Kept after it is sent, so the process can be restarted as it was. */
  originCommand: string | null
  startedAt: number
  status: 'starting' | 'running' | 'exited'
  exitCode: number | null
}

export interface OpenOptions {
  title?: string
  cwd?: string | null
  shellOverride?: string | null
  args?: string[] | null
  projectId?: string | null
  serverId?: string | null
  subtitle?: string | null
  command?: string | null
}

const uid = () => crypto.randomUUID()

const state = reactive({
  tabs: [] as TerminalTab[],
  activeKey: null as string | null,
})

export const useTerminals = () => {
  const open = (opts: OpenOptions = {}) => {
    const tab: TerminalTab = {
      id: '',
      key: uid(),
      title: opts.title ?? 'Terminal',
      cwd: opts.cwd ?? null,
      shell: null,
      shellOverride: opts.shellOverride ?? null,
      args: opts.args ?? null,
      projectId: opts.projectId ?? null,
      serverId: opts.serverId ?? null,
      subtitle: opts.subtitle ?? null,
      pendingCommand: opts.command ?? null,
      originCommand: opts.command ?? null,
      startedAt: Date.now(),
      status: 'starting',
      exitCode: null,
    }
    state.tabs.push(tab)
    state.activeKey = tab.key
    return tab
  }

  const close = (key: string) => {
    const index = state.tabs.findIndex((t) => t.key === key)
    if (index === -1) return
    state.tabs.splice(index, 1)
    if (state.activeKey === key) {
      // Focus the neighbour that slid into this slot, else the last tab.
      const next = state.tabs[index] ?? state.tabs[index - 1] ?? null
      state.activeKey = next?.key ?? null
    }
  }

  const activate = (key: string) => {
    state.activeKey = key
  }

  const find = (key: string) => state.tabs.find((t) => t.key === key) ?? null

  /** Every terminal this project has open, newest last. */
  const forProject = (projectId: string) =>
    state.tabs.filter((t) => t.projectId === projectId)

  const running = (projectId: string) =>
    state.tabs.filter((t) => t.projectId === projectId && t.status === 'running')

  return { state, open, close, activate, find, forProject, running }
}
