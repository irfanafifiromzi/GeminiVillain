import { reactive } from 'vue'
import { execOnce, localSpec } from '@/lib/exec'
import type { Deployment, Project } from '@/stores/projects'
import { sshExecArgs, type Server } from '@/stores/servers'

export type SyncState =
  | 'checking'
  | 'current'
  | 'behind'
  | 'ahead'
  | 'diverged'
  | 'unknown'
  | 'error'

export interface DeployStatus {
  id: string
  serverName: string
  path: string
  state: SyncState
  /** Commits you have that the server does not. */
  behind: number
  /** Commits the server has that you do not. */
  ahead: number
  localHead: string
  remoteHead: string
  message: string
}

export interface LocalGit {
  ok: boolean
  branch: string
  head: string
  /** Uncommitted changes here, which no deploy can carry across. */
  dirty: number
  message: string
}

const state = reactive({
  local: {} as Record<string, LocalGit>,
  targets: {} as Record<string, DeployStatus[]>,
  running: {} as Record<string, boolean>,
  checkedAt: {} as Record<string, number>,
})

/** Commands print one useful line; take it and ignore the rest. */
const firstLine = (out: string) =>
  out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)[0] ?? ''

const countLines = (out: string) => out.split(/\r?\n/).filter((l) => l.trim()).length

const runLocal = (project: Project, command: string) =>
  execOnce(localSpec(command, project.path))

const runRemote = (server: Server, command: string) =>
  execOnce({ shell: 'ssh', args: sshExecArgs(server, command, false) })

/** `cd` first, and fail loudly if the directory is not there. */
const remoteGit = (path: string, git: string) =>
  `cd '${path.replace(/'/g, "'\\''")}' 2>/dev/null || { echo "NO_SUCH_PATH"; exit 9; }; ${git}`

export const useSync = () => {
  const localOf = (projectId: string): LocalGit | null => state.local[projectId] ?? null
  const targetsOf = (projectId: string): DeployStatus[] => state.targets[projectId] ?? []
  const isRunning = (projectId: string) => state.running[projectId] === true
  const checkedAt = (projectId: string) => state.checkedAt[projectId] ?? 0

  /**
   * Compare this checkout against every server it is deployed to.
   *
   * The counting is done locally with `git rev-list`, so the server only ever
   * has to answer one question: which commit are you on.
   */
  const check = async (project: Project, servers: Server[]) => {
    if (state.running[project.id]) return
    const serverById = new Map(servers.map((s) => [s.id, s]))

    state.running[project.id] = true
    state.targets[project.id] = project.deployments.map((d): DeployStatus => ({
      id: d.id,
      serverName: serverById.get(d.serverId)?.name ?? '(missing server)',
      path: d.path,
      state: 'checking',
      behind: 0,
      ahead: 0,
      localHead: '',
      remoteHead: '',
      message: '',
    }))
    const live = state.targets[project.id]

    // 1. Where are we locally?
    const [headRes, branchRes, dirtyRes] = await Promise.all([
      runLocal(project, 'git rev-parse HEAD'),
      runLocal(project, 'git rev-parse --abbrev-ref HEAD'),
      runLocal(project, 'git status --porcelain'),
    ])

    const local: LocalGit = {
      ok: headRes.code === 0,
      head: firstLine(headRes.output),
      branch: firstLine(branchRes.output),
      dirty: countLines(dirtyRes.output),
      message: headRes.code === 0 ? '' : 'This folder is not a git repository.',
    }
    state.local[project.id] = local

    if (!local.ok) {
      for (const row of live) {
        row.state = 'error'
        row.message = local.message
      }
      state.running[project.id] = false
      state.checkedAt[project.id] = Date.now()
      return
    }

    await Promise.all(
      project.deployments.map(async (deployment: Deployment, i) => {
        const row = live[i]
        const server = serverById.get(deployment.serverId)
        if (!server) {
          row.state = 'error'
          row.message = 'That server profile no longer exists.'
          return
        }

        const res = await runRemote(server, remoteGit(deployment.path, 'git rev-parse HEAD'))
        const out = firstLine(res.output)

        if (res.code === 9 || /NO_SUCH_PATH/.test(res.output)) {
          row.state = 'error'
          row.message = `${deployment.path} does not exist on ${server.name}.`
          return
        }
        if (res.code !== 0 || !/^[0-9a-f]{7,40}$/i.test(out)) {
          row.state = 'error'
          row.message = firstLine(res.output) || `ssh failed (exit ${res.code}).`
          return
        }

        row.localHead = local.head
        row.remoteHead = out

        if (out === local.head) {
          row.state = 'current'
          row.message = 'running your current commit'
          return
        }

        // Does this checkout even know the commit the server is on?
        const known = await runLocal(project, `git cat-file -e ${out}^{commit}`)
        if (known.code !== 0) {
          row.state = 'unknown'
          row.message = 'on a commit this checkout has never seen — fetch, or it was built elsewhere'
          return
        }

        const [behindRes, aheadRes] = await Promise.all([
          runLocal(project, `git rev-list --count ${out}..HEAD`),
          runLocal(project, `git rev-list --count HEAD..${out}`),
        ])
        row.behind = Number(firstLine(behindRes.output)) || 0
        row.ahead = Number(firstLine(aheadRes.output)) || 0

        if (row.behind && row.ahead) {
          row.state = 'diverged'
          row.message = `${row.behind} commit${row.behind === 1 ? '' : 's'} not deployed, ${row.ahead} you do not have`
        } else if (row.behind) {
          row.state = 'behind'
          row.message = `${row.behind} commit${row.behind === 1 ? '' : 's'} behind you`
        } else {
          row.state = 'ahead'
          row.message = `${row.ahead} commit${row.ahead === 1 ? '' : 's'} ahead of you`
        }
      }),
    )

    state.running[project.id] = false
    state.checkedAt[project.id] = Date.now()
  }

  return { state, localOf, targetsOf, isRunning, checkedAt, check }
}
