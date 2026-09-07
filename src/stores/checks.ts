import { reactive } from 'vue'
import { execOnce, localSpec, type ExecSpec } from '@/lib/exec'
import { oneLine, type Check, type Project } from '@/stores/projects'
import { sshExecArgs, type Server } from '@/stores/servers'

export type CheckStatus = 'idle' | 'running' | 'ok' | 'failed'

export interface CheckResult {
  id: string
  name: string
  /** Server name, or null when it asked this PC. */
  target: string | null
  status: CheckStatus
  /** The answer: the last meaningful line the command printed. */
  value: string
  /** Full output, for when the short answer is not enough. */
  output: string
  code: number | null
}

const state = reactive({
  /** Results per project id, so switching projects keeps what you saw. */
  byProject: {} as Record<string, CheckResult[]>,
  running: {} as Record<string, boolean>,
})

/**
 * Checks answer a question, so the interesting part is the last thing printed —
 * a branch name, a commit hash, a count. Errors are usually the last line too.
 */
const answerOf = (output: string): string => {
  const lines = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  return lines.length ? lines[lines.length - 1].slice(0, 120) : '(no output)'
}

const specFor = (project: Project, check: Check, server: Server | null): ExecSpec => {
  const flat = oneLine(check.command)
  if (server) {
    return { shell: 'ssh', args: sshExecArgs(server, flat, false) }
  }
  const sub = check.cwd?.trim().replace(/^[\\/]+/, '')
  const cwd = sub
    ? `${project.path.replace(/[\\/]+$/, '')}\\${sub.replace(/\//g, '\\')}`
    : project.path
  return localSpec(check.command, cwd)
}

export const useChecks = () => {
  const resultsFor = (projectId: string): CheckResult[] => state.byProject[projectId] ?? []

  const isRunning = (projectId: string) => state.running[projectId] === true

  /**
   * Run every check at once. They are independent and read-only, so there is
   * no reason to make you wait for them one at a time.
   */
  const refresh = async (project: Project, servers: Server[]) => {
    if (state.running[project.id]) return
    const serverById = new Map(servers.map((s) => [s.id, s]))

    const pending: CheckResult[] = project.checks.map((check) => ({
      id: check.id,
      name: check.name,
      target: check.serverId ? (serverById.get(check.serverId)?.name ?? '(missing)') : null,
      status: 'running',
      value: '',
      output: '',
      code: null,
    }))

    state.byProject[project.id] = pending
    state.running[project.id] = true

    // Mutate through the reactive copy, or the board never updates.
    const live = state.byProject[project.id]

    await Promise.all(
      project.checks.map(async (check, i) => {
        const row = live[i]
        const server = check.serverId ? (serverById.get(check.serverId) ?? null) : null

        if (check.serverId && !server) {
          row.status = 'failed'
          row.value = 'that server profile is gone'
          return
        }

        const { code, output } = await execOnce(specFor(project, check, server))
        row.code = code
        row.output = output
        row.value = answerOf(output)
        row.status = code === 0 ? 'ok' : 'failed'
      }),
    )

    state.running[project.id] = false
  }

  const clear = (projectId: string) => {
    delete state.byProject[projectId]
  }

  return { state, resultsFor, isRunning, refresh, clear }
}
