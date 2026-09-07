import { reactive } from 'vue'
import { invoke } from '@/lib/backend'
import type { Run } from '@/stores/runner'

/** One finished run, trimmed to what is worth keeping. */
export interface HistoryEntry {
  id: string
  workflowName: string
  projectId: string
  projectName: string
  status: 'passed' | 'failed'
  startedAt: number
  ms: number
  steps: Array<{
    label: string
    state: string
    ms: number
    exitCode: number | null
    serverName: string | null
  }>
}

/** Enough to answer "what happened lately" without becoming a database. */
const KEEP = 60

const state = reactive({
  entries: [] as HistoryEntry[],
  loaded: false,
})

const persist = async () => {
  try {
    await invoke('runs_save', { runs: state.entries })
  } catch (e) {
    console.error('failed to save run history', e)
  }
}

export const useHistory = () => {
  const load = async () => {
    if (state.loaded) return
    try {
      const raw = await invoke<HistoryEntry[]>('runs_load')
      state.entries = Array.isArray(raw) ? raw : []
    } catch (e) {
      console.error('failed to load run history', e)
      state.entries = []
    }
    state.loaded = true
  }

  /** Called once a run reaches a terminal state. */
  const record = async (run: Run, projectName: string) => {
    if (run.status === 'running') return
    state.entries.unshift({
      id: crypto.randomUUID(),
      workflowName: run.workflowName,
      projectId: run.projectId,
      projectName,
      status: run.status,
      startedAt: run.startedAt,
      ms: run.ms,
      steps: run.steps.map((s) => ({
        label: s.label,
        state: s.status,
        ms: s.ms,
        exitCode: s.exitCode,
        serverName: s.serverName,
      })),
    })
    state.entries = state.entries.slice(0, KEEP)
    await persist()
  }

  const forProject = (projectId: string) =>
    state.entries.filter((e) => e.projectId === projectId)

  const clear = async () => {
    state.entries = []
    await persist()
  }

  return { state, load, record, forProject, clear }
}

/** "3m ago", "2h ago", "yesterday" — precise enough for a run log. */
export const ago = (at: number): string => {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  const d = Math.round(s / 86400)
  return d === 1 ? 'yesterday' : `${d}d ago`
}
