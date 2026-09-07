import { reactive, computed } from 'vue'
import * as api from '@/lib/api'

export interface Script {
  id: string
  name: string
  /** One or more shell commands. Newlines are allowed. */
  command: string
  /** Folder to run in, relative to the project root. Empty means the root. */
  cwd: string
}

/** How a workflow treats a step. */
export type StepMode = 'wait' | 'background'

export interface WorkflowStep {
  scriptId: string
  mode: StepMode
  /** null runs it locally; otherwise the server to run it on over SSH. */
  serverId: string | null
}

export interface Workflow {
  id: string
  name: string
  steps: WorkflowStep[]
}

/**
 * A read-only question about the project, answered on demand.
 *
 * Checks exist to answer "where does this project actually stand" — locally and
 * on each server — in one screen. They are never run automatically.
 */
export interface Check {
  id: string
  name: string
  command: string
  /** Local subfolder. Ignored for checks that target a server. */
  cwd: string
  /** null asks this PC; otherwise the server to ask over SSH. */
  serverId: string | null
}

/**
 * Where this project lives on a server.
 *
 * Enough to answer the question that actually matters day to day: is that
 * machine running the code I have here, or is it behind?
 */
export interface Deployment {
  id: string
  serverId: string
  /** Absolute path to the checkout on the server, e.g. /var/www/app. */
  path: string
}

export interface Project {
  id: string
  name: string
  path: string
  description: string
  scripts: Script[]
  workflows: Workflow[]
  checks: Check[]
  deployments: Deployment[]
}

const uid = () => crypto.randomUUID()

/** Every new project starts with the three commands the spec calls for. */
export const defaultScripts = (): Script[] => [
  { id: uid(), name: 'Dev', command: 'npm run dev', cwd: '' },
  { id: uid(), name: 'Build', command: 'npm run build', cwd: '' },
  { id: uid(), name: 'Test', command: 'npm test', cwd: '' },
]

/**
 * Older registries predate `cwd` and `workflows`; fill them in on load so the
 * rest of the app never has to test for their absence.
 */
const normalise = (raw: unknown): Project[] => {
  if (!Array.isArray(raw)) return []
  return raw.map((p) => ({
    id: p?.id ?? uid(),
    name: p?.name ?? 'Untitled',
    path: p?.path ?? '',
    description: p?.description ?? '',
    scripts: Array.isArray(p?.scripts)
      ? p.scripts.map((s: Script) => ({ ...s, cwd: s.cwd ?? '' }))
      : [],
    workflows: Array.isArray(p?.workflows)
      ? p.workflows.map((w: Workflow) => ({
          ...w,
          steps: (w.steps ?? []).map((step) => ({ ...step, serverId: step.serverId ?? null })),
        }))
      : [],
    checks: Array.isArray(p?.checks) ? p.checks : [],
    deployments: Array.isArray(p?.deployments) ? p.deployments : [],
  }))
}

/** Suggested starting points, all read-only. */
export const defaultChecks = (): Check[] => [
  { id: uid(), name: "Branch", command: "git rev-parse --abbrev-ref HEAD", cwd: "", serverId: null },
  { id: uid(), name: "Uncommitted", command: "git status --porcelain | Measure-Object -Line | ForEach-Object { $_.Lines }", cwd: "", serverId: null },
]

const state = reactive({
  projects: [] as Project[],
  selectedId: null as string | null,
  loaded: false,
  /** Paths that no longer exist on disk, so the sidebar can mark them. */
  missing: new Set<string>(),
})

const persist = async () => {
  try {
    await api.saveProjects(state.projects)
  } catch (e) {
    console.error('failed to save projects', e)
  }
}

export const useProjects = () => {
  const selected = computed(
    () => state.projects.find((p) => p.id === state.selectedId) ?? null,
  )

  const load = async () => {
    if (state.loaded) return
    try {
      state.projects = normalise(await api.loadProjects<unknown>())
    } catch (e) {
      console.error('failed to load projects', e)
      state.projects = []
    }
    state.loaded = true
    void refreshMissing()
  }

  const refreshMissing = async () => {
    const results = await Promise.all(
      state.projects.map(async (p) => [p.path, await api.pathExists(p.path)] as const),
    )
    state.missing = new Set(results.filter(([, ok]) => !ok).map(([path]) => path))
  }

  const add = async (input: Omit<Project, 'id'>) => {
    const project: Project = { ...input, id: uid() }
    state.projects.push(project)
    state.selectedId = project.id
    await persist()
    void refreshMissing()
    return project
  }

  const update = async (id: string, patch: Partial<Omit<Project, 'id'>>) => {
    const project = state.projects.find((p) => p.id === id)
    if (!project) return
    Object.assign(project, patch)
    await persist()
    void refreshMissing()
  }

  const remove = async (id: string) => {
    const index = state.projects.findIndex((p) => p.id === id)
    if (index === -1) return
    state.projects.splice(index, 1)
    if (state.selectedId === id) state.selectedId = null
    await persist()
  }

  const select = (id: string | null) => {
    state.selectedId = id
  }

  return {
    state,
    selected,
    load,
    add,
    update,
    remove,
    select,
    refreshMissing,
    isMissing: (path: string) => state.missing.has(path),
  }
}

/** Absolute folder for a script: the project root, plus its relative cwd. */
export const scriptCwd = (project: Project, script: Script): string => {
  const sub = script.cwd?.trim().replace(/^[\\/]+/, '')
  if (!sub) return project.path
  return `${project.path.replace(/[\\/]+$/, '')}\\${sub.replace(/\//g, '\\')}`
}

/** Collapse a multi-line command into something safe to type at a prompt. */
export const oneLine = (command: string): string =>
  command
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('; ')
