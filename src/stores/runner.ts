import { reactive } from 'vue'
import * as pty from '@/lib/pty'
import {
  oneLine,
  scriptCwd,
  type Project,
  type Workflow,
  type WorkflowStep,
} from '@/stores/projects'
import { sshExecArgs, sshExecPreview, type Server } from '@/stores/servers'

export type StepStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'started'

/** Everything needed to launch one step, local or remote. */
interface SpawnSpec {
  shell?: string
  args: string[]
  cwd?: string
}

export interface RunStep {
  key: string
  scriptId: string
  label: string
  command: string
  cwd: string
  mode: WorkflowStep['mode']
  /** Name of the server this runs on, or null for local. */
  serverName: string | null
  /** The command line as it will actually be run, shown in the log. */
  preview: string
  status: StepStatus
  exitCode: number | null
  /** Wall-clock start, so the UI can tick a live elapsed time. */
  startedAt: number | null
  /** Console output, ANSI stripped — these steps are logs, not live terminals. */
  output: string
  ms: number
}

export interface Run {
  workflowId: string
  workflowName: string
  projectId: string
  steps: RunStep[]
  status: 'running' | 'passed' | 'failed'
  startedAt: number
  ms: number
}

export interface PlannedStep {
  scriptId: string
  label: string
  command: string
  cwd: string
  mode: WorkflowStep["mode"]
  serverId: string | null
  serverName: string | null
  /** True when the target server is flagged production. */
  guarded: boolean
  /** The literal command line that will run. */
  preview: string
}

/**
 * Work out exactly what a workflow will do, without doing any of it.
 *
 * Preflight renders this and the runner executes from it, so what you are
 * shown and what runs cannot drift apart.
 */
export const planWorkflow = (
  project: Project,
  workflow: Workflow,
  servers: Server[],
): PlannedStep[] => {
  const scriptById = new Map(project.scripts.map((s) => [s.id, s]))
  const serverById = new Map(servers.map((s) => [s.id, s]))

  return workflow.steps
    .filter((step) => scriptById.has(step.scriptId))
    .map((step) => {
      const script = scriptById.get(step.scriptId)!
      const server = step.serverId ? (serverById.get(step.serverId) ?? null) : null
      const flat = oneLine(script.command)
      return {
        scriptId: script.id,
        label: script.name,
        command: script.command,
        cwd: scriptCwd(project, script),
        mode: step.mode,
        serverId: step.serverId,
        serverName: server?.name ?? (step.serverId ? "(missing server)" : null),
        guarded: server?.production === true,
        preview: server ? sshExecPreview(server, flat) : flat,
      }
    })
}

const uid = () => crypto.randomUUID()

const state = reactive({
  run: null as Run | null,
  /** Set while a run is in flight so the UI can offer Stop. */
  cancelling: false,
  /** The pty currently executing, so Stop can kill it. */
  activeId: null as string | null,
})

/** CSI/OSC escape sequences: useful in a terminal, noise in a log view. */
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][0-9A-B]/g
const stripAnsi = (s: string) => s.replace(ANSI, '')

const decoder = new TextDecoder()

/**
 * Run one command to completion and resolve with its exit code.
 *
 * Deliberately not a terminal tab: these steps are non-interactive, and each
 * ConPTY session clears the screen when it starts, so sharing one xterm across
 * steps would erase the previous step's output.
 */
const runToCompletion = (step: RunStep, spec: SpawnSpec): Promise<number> =>
  new Promise((resolve) => {
    const id = uid()
    let unlistenOut: (() => void) | null = null
    let unlistenExit: (() => void) | null = null
    const started = Date.now()

    const finish = (code: number) => {
      unlistenOut?.()
      unlistenExit?.()
      step.ms = Date.now() - started
      state.activeId = null
      resolve(code)
    }

    void (async () => {
      unlistenOut = await pty.onOutput((outId, bytes) => {
        if (outId !== id) return
        step.output += stripAnsi(decoder.decode(bytes, { stream: true }))
      })
      unlistenExit = await pty.onExit((exitId, code) => {
        if (exitId === id) finish(code ?? 0)
      })

      try {
        // Set before spawning: a fast step can exit before spawn resolves.
        state.activeId = id
        await pty.spawn({ id, ...spec, cols: 120, rows: 40 })
      } catch (e) {
        step.output += `\n${String(e)}\n`
        finish(1)
      }
    })()
  })

export interface OpenTabRequest {
  title: string
  cwd: string | null
  shellOverride: string | null
  args: string[] | null
  subtitle: string
  command: string | null
}

export interface RunnerHooks {
  /** Long-running steps become ordinary terminal tabs. */
  openTab: (request: OpenTabRequest) => void
}

export const useRunner = () => {
  /**
   * Servers are passed in rather than reached for, so the runner stays a
   * function of what it is handed.
   */
  const start = async (
    project: Project,
    workflow: Workflow,
    servers: Server[],
    hooks: RunnerHooks,
  ) => {
    if (state.run?.status === 'running') return

    const scriptById = new Map(project.scripts.map((s) => [s.id, s]))
    const serverById = new Map(servers.map((s) => [s.id, s]))

    // Steps whose command still exists, kept in lockstep with the run log.
    const plan = workflow.steps.filter((s) => scriptById.has(s.scriptId))

    const steps: RunStep[] = plan.map((step): RunStep => {
      const script = scriptById.get(step.scriptId)!
      const server = step.serverId ? (serverById.get(step.serverId) ?? null) : null
      const flat = oneLine(script.command)
      return {
        key: uid(),
        scriptId: script.id,
        label: script.name,
        command: script.command,
        cwd: scriptCwd(project, script),
        mode: step.mode,
        serverName: server?.name ?? (step.serverId ? '(missing server)' : null),
        preview: server ? sshExecPreview(server, flat) : flat,
        status: 'pending',
        exitCode: null,
        startedAt: null,
        output: '',
        ms: 0,
      }
    })

    const run: Run = {
      workflowId: workflow.id,
      workflowName: workflow.name,
      projectId: project.id,
      steps,
      status: 'running',
      startedAt: Date.now(),
      ms: 0,
    }
    state.run = run
    state.cancelling = false

    // Drive the loop through the reactive copy. Mutating the raw objects built
    // above would update the values but never notify Vue, so the run log would
    // freeze on whatever it happened to render first.
    const live = state.run

    const abort = (step: RunStep, message?: string) => {
      if (message) step.output += message
      step.status = 'failed'
      for (const later of live.steps) {
        if (later.status === 'pending') later.status = 'skipped'
      }
      live.status = 'failed'
      live.ms = Date.now() - live.startedAt
    }

    for (let i = 0; i < live.steps.length; i++) {
      const step = live.steps[i]
      const definition = plan[i]
      const script = scriptById.get(step.scriptId)!
      const server = definition.serverId ? (serverById.get(definition.serverId) ?? null) : null

      if (state.cancelling) {
        step.status = 'skipped'
        continue
      }

      if (definition.serverId && !server) {
        abort(step, 'That server profile no longer exists.\n')
        return
      }

      if (step.mode === 'background') {
        // Hand it to a real terminal tab and move on immediately.
        hooks.openTab(
          server
            ? {
                title: `${server.name}: ${script.name}`,
                cwd: null,
                shellOverride: 'ssh',
                args: sshExecArgs(server, oneLine(script.command), true),
                subtitle: `${server.user ? server.user + '@' : ''}${server.host}`,
                command: null,
              }
            : {
                title: `${project.name}: ${script.name}`,
                cwd: step.cwd,
                shellOverride: null,
                args: null,
                subtitle: step.cwd,
                command: oneLine(script.command),
              },
        )
        step.status = 'started'
        continue
      }

      step.startedAt = Date.now()
      step.status = 'running'

      const spec: SpawnSpec = server
        ? // `ssh host "cmd"` exits with the remote status, so stop-on-failure
          // works across machines exactly as it does locally.
          { shell: 'ssh', args: sshExecArgs(server, oneLine(step.command), false) }
        : { args: ['-NoLogo', '-NoProfile', '-Command', step.command], cwd: step.cwd }

      const code = await runToCompletion(step, spec)
      step.exitCode = code
      step.status = code === 0 ? 'passed' : 'failed'

      if (code !== 0) {
        abort(step)
        return
      }
    }

    live.status = state.cancelling ? 'failed' : 'passed'
    live.ms = Date.now() - live.startedAt
  }

  const stop = () => {
    state.cancelling = true
    if (state.activeId) void pty.kill(state.activeId).catch(() => {})
  }

  const clear = () => {
    if (state.run?.status !== 'running') state.run = null
  }

  return { state, start, stop, clear }
}
