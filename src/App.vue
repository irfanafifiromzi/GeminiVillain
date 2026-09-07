<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import TitleBar from '@/components/TitleBar.vue'
import Sidebar from '@/components/Sidebar.vue'
import TabBar from '@/components/TabBar.vue'
import TerminalPane from '@/components/TerminalPane.vue'
import ProjectPanel from '@/components/ProjectPanel.vue'
import ProjectDialog from '@/components/ProjectDialog.vue'
import ServerPanel from '@/components/ServerPanel.vue'
import ServerDialog from '@/components/ServerDialog.vue'
import RunPanel from '@/components/RunPanel.vue'
import PreflightDialog from '@/components/PreflightDialog.vue'
import CommandPalette from '@/components/CommandPalette.vue'
import ShortcutsDialog from '@/components/ShortcutsDialog.vue'
import { useProjects, oneLine, scriptCwd, type Project, type Script, type Workflow } from '@/stores/projects'
import { useRunner, planWorkflow, type PlannedStep } from '@/stores/runner'
import { useHistory } from '@/stores/history'
import { useTheme } from '@/stores/theme'
import type { PaletteItem } from '@/lib/palette'
import { useServers, sshArgs, type Server } from '@/stores/servers'
import { useTerminals, type OpenOptions, type TerminalTab } from '@/stores/terminals'
import * as pty from '@/lib/pty'

type View = 'terminal' | 'project' | 'server' | 'run'

const projects = useProjects()
const servers = useServers()
const terminals = useTerminals()
const runner = useRunner()
const appTheme = useTheme()
const history = useHistory()

const view = ref<View>('terminal')
const projectDialog = ref<{ open: boolean; target: Project | null }>({ open: false, target: null })
const serverDialog = ref<{ open: boolean; target: Server | null }>({ open: false, target: null })

const activeTab = computed(
  () => terminals.state.tabs.find((t) => t.key === terminals.state.activeKey) ?? null,
)

/** Closing a tab kills whatever is in it, so a live process gets a question. */
const closeTerminal = (key: string) => {
  const tab = terminals.find(key)
  if (
    tab &&
    tab.status === 'running' &&
    !confirm(`"${tab.title}" is still running.

Closing this tab stops it. Continue?`)
  ) {
    return
  }
  terminals.close(key)
}

const newTerminal = (opts: OpenOptions = {}) => {
  terminals.open(opts)
  view.value = 'terminal'
}

// ------------------------------------------------------------- projects ---

const openProjectTerminal = (project: Project, command?: string, label?: string) => {
  newTerminal({
    title: label ? project.name + ': ' + label : project.name,
    cwd: project.path,
    projectId: project.id,
    subtitle: project.path,
    command: command ?? null,
  })
}

const runScript = (script: Script) => {
  const project = projects.selected.value
  if (!project) return
  // Typed at a live prompt, so a multi-line command becomes one history entry.
  newTerminal({
    title: `${project.name}: ${script.name}`,
    cwd: scriptCwd(project, script),
    projectId: project.id,
    subtitle: scriptCwd(project, script),
    command: oneLine(script.command),
  })
}

/**
 * Wait-steps run headless and report exit codes in the run log; keep-running
 * steps become ordinary terminal tabs so you can talk to them.
 */
const preflight = ref<{ workflow: Workflow; steps: PlannedStep[] } | null>(null)

/** Show what a workflow will do before any of it happens. */
const askToRun = (workflow: Workflow) => {
  const project = projects.selected.value
  if (!project) return
  preflight.value = {
    workflow,
    steps: planWorkflow(project, workflow, servers.state.servers),
  }
}

const runWorkflow = async (workflow: Workflow) => {
  const project = projects.selected.value
  if (!project) return
  preflight.value = null
  view.value = 'run'
  await runner.start(project, workflow, servers.state.servers, {
    openTab: (req) =>
      terminals.open({
        title: req.title,
        cwd: req.cwd,
        shellOverride: req.shellOverride,
        args: req.args,
        projectId: project.id,
        subtitle: req.subtitle,
        command: req.command,
      }),
  })

  // start() resolves when the run settles, so this is the moment to keep it.
  const finished = runner.state.run
  if (finished && finished.status !== 'running') {
    void history.record(finished, project.name)
  }
}

/** Bring a project process to the front. */
const focusTab = (key: string) => {
  terminals.activate(key)
  view.value = 'terminal'
}

/** Run a finished process again exactly as it was first started. */
const restartTab = (tab: TerminalTab) => {
  terminals.close(tab.key)
  newTerminal({
    title: tab.title,
    cwd: tab.cwd,
    shellOverride: tab.shellOverride,
    args: tab.args,
    projectId: tab.projectId,
    serverId: tab.serverId,
    subtitle: tab.subtitle,
    command: tab.originCommand,
  })
}

const selectProject = (project: Project) => {
  projects.select(project.id)
  view.value = 'project'
}

const saveProject = async (value: Omit<Project, 'id'>) => {
  if (projectDialog.value.target) {
    await projects.update(projectDialog.value.target.id, value)
  } else {
    const created = await projects.add(value)
    projects.select(created.id)
    view.value = 'project'
  }
  projectDialog.value = { open: false, target: null }
}

// -------------------------------------------------------------- servers ---

/**
 * SSH is just another program in a pty — no cwd, and the wordmark's tagline
 * is swapped for the target so the tab identifies itself at a glance.
 */
const connectServer = (server: Server) => {
  newTerminal({
    title: server.name,
    shellOverride: 'ssh',
    args: sshArgs(server),
    serverId: server.id,
    subtitle: `${server.user ? server.user + '@' : ''}${server.host}`,
  })
}

const selectServer = (server: Server) => {
  servers.select(server.id)
  view.value = 'server'
}

const saveServer = async (value: Omit<Server, 'id'>) => {
  if (serverDialog.value.target) {
    await servers.update(serverDialog.value.target.id, value)
  } else {
    const created = await servers.add(value)
    servers.select(created.id)
    view.value = 'server'
  }
  serverDialog.value = { open: false, target: null }
}

// ------------------------------------------------------------- shortcuts ---


const paletteOpen = ref(false)
const shortcutsOpen = ref(false)

/**
 * One flat list of everything you can do right now. Built on demand rather
 * than kept in sync, because it is only ever read while the palette is open.
 */
const paletteItems = computed((): PaletteItem[] => {
  const items: PaletteItem[] = []

  for (const project of projects.state.projects) {
    items.push({
      id: 'p:' + project.id,
      label: project.name,
      kind: 'project',
      detail: project.path,
      run: () => selectProject(project),
    })

    for (const script of project.scripts) {
      items.push({
        id: 'c:' + project.id + ':' + script.id,
        label: project.name + ': ' + script.name,
        kind: 'command',
        detail: oneLine(script.command),
        run: () => {
          projects.select(project.id)
          runScript(script)
        },
      })
    }

    for (const workflow of project.workflows) {
      items.push({
        id: 'w:' + project.id + ':' + workflow.id,
        label: project.name + ': ' + workflow.name,
        kind: 'workflow',
        detail: workflow.steps.length + ' steps',
        run: () => {
          projects.select(project.id)
          askToRun(workflow)
        },
      })
    }
  }

  for (const server of servers.state.servers) {
    items.push({
      id: 's:' + server.id,
      label: 'Connect to ' + server.name,
      kind: 'server',
      detail: (server.user ? server.user + '@' : '') + server.host,
      run: () => connectServer(server),
    })
  }

  items.push(
    {
      id: 'a:terminal',
      label: 'New terminal',
      kind: 'action',
      detail: 'Ctrl+Shift+T',
      run: () => newTerminal({ cwd: projects.selected.value?.path ?? null }),
    },
    {
      id: 'a:theme',
      label: 'Toggle light / dark',
      kind: 'action',
      run: () => void appTheme.toggle(),
    },
    {
      id: 'a:keys',
      label: 'Keyboard shortcuts',
      kind: 'action',
      detail: 'Ctrl+/',
      run: () => (shortcutsOpen.value = true),
    },
  )

  return items
})

/** Ours, so the terminal never sees it. */
const claim = (e: KeyboardEvent) => {
  e.preventDefault()
  e.stopPropagation()
}

const onKeydown = (e: KeyboardEvent) => {
  if (e.ctrlKey && !e.shiftKey && e.code === 'KeyK') {
    claim(e)
    paletteOpen.value = !paletteOpen.value
    return
  }
  if (e.ctrlKey && e.code === 'Slash') {
    claim(e)
    shortcutsOpen.value = !shortcutsOpen.value
    return
  }
  if (e.ctrlKey && e.shiftKey && e.code === 'KeyT') {
    claim(e)
    newTerminal({ cwd: projects.selected.value?.path ?? null })
    return
  }
  if (e.ctrlKey && e.shiftKey && e.code === 'KeyW') {
    claim(e)
    if (terminals.state.activeKey) closeTerminal(terminals.state.activeKey)
    return
  }
  if (e.key === 'Escape') {
    const open =
      projectDialog.value.open ||
      serverDialog.value.open ||
      !!preflight.value ||
      paletteOpen.value ||
      shortcutsOpen.value
    if (!open) return // let it through to whatever is running in the terminal
    claim(e)
    projectDialog.value = { open: false, target: null }
    serverDialog.value = { open: false, target: null }
    preflight.value = null
    paletteOpen.value = false
    shortcutsOpen.value = false
    return
  }
  // Ctrl+Tab cycles terminals in tab-strip order.
  if (e.ctrlKey && e.code === 'Tab' && terminals.state.tabs.length > 1) {
    claim(e)
    const tabs = terminals.state.tabs
    const i = tabs.findIndex((t) => t.key === terminals.state.activeKey)
    const next = tabs[(i + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length]
    terminals.activate(next.key)
    view.value = 'terminal'
  }
}

onMounted(async () => {
  // Capture phase: see the key before the focused terminal does.
  window.addEventListener('keydown', onKeydown, true)
  await Promise.all([projects.load(), servers.load(), history.load()])
  // Start with one shell open, the way a terminal app should behave.
  newTerminal()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true)
  // Best-effort cleanup so no orphaned shells outlive the window.
  for (const tab of terminals.state.tabs) {
    if (tab.id) void pty.kill(tab.id).catch(() => {})
  }
})
</script>

<template>
  <div class="app gv-boot">
    <TitleBar />

    <div class="body">
      <Sidebar
        @add-project="projectDialog = { open: true, target: null }"
        @edit-project="(p) => (projectDialog = { open: true, target: p })"
        @select-project="selectProject"
        @add-server="serverDialog = { open: true, target: null }"
        @edit-server="(s) => (serverDialog = { open: true, target: s })"
        @select-server="selectServer"
      />

      <main class="main">
        <nav class="viewbar">
          <button :class="{ on: view === 'terminal' }" @click="view = 'terminal'">Terminal</button>
          <button
            :class="{ on: view === 'project' }"
            :disabled="!projects.selected.value"
            @click="view = 'project'"
          >
            Project
          </button>
          <button
            :class="{ on: view === 'server' }"
            :disabled="!servers.selected.value"
            @click="view = 'server'"
          >
            Server
          </button>
          <button
            v-if="runner.state.run"
            :class="{ on: view === 'run' }"
            @click="view = 'run'"
          >
            Run<span v-if="runner.state.run.status === 'running'" class="pip"></span>
          </button>
          <span class="spacer"></span>
          <span v-if="activeTab?.shell" class="hint">{{ activeTab.shell }}</span>
        </nav>

        <section v-show="view === 'terminal'" class="terminal-view">
          <TabBar
            @new="newTerminal({ cwd: projects.selected.value?.path ?? null })"
            @close="closeTerminal"
          />

          <div class="panes">
            <p v-if="!terminals.state.tabs.length" class="placeholder">
              No terminals open. Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd> or the
              <strong>+</strong> button above.
            </p>
            <!-- Kept mounted so scrollback and running processes survive tab switches. -->
            <div
              v-for="tab in terminals.state.tabs"
              v-show="tab.key === terminals.state.activeKey"
              :key="tab.key"
              class="pane-slot"
            >
              <TerminalPane :tab="tab" :active="tab.key === terminals.state.activeKey" />
            </div>
          </div>
        </section>

        <section v-show="view === 'project'" class="stack-view">
          <ProjectPanel
            v-if="projects.selected.value"
            :key="projects.selected.value.id"
            :project="projects.selected.value"
            @run="runScript"
            @run-workflow="askToRun"
            @focus-tab="focusTab"
            @restart-tab="restartTab"
            @terminal="openProjectTerminal(projects.selected.value!)"
            @edit="projectDialog = { open: true, target: projects.selected.value }"
          />
          <p v-else class="placeholder">Select a project from the sidebar.</p>
        </section>

        <section v-show="view === 'server'" class="stack-view">
          <ServerPanel
            v-if="servers.selected.value"
            :key="servers.selected.value.id"
            :server="servers.selected.value"
            @connect="connectServer(servers.selected.value!)"
            @edit="serverDialog = { open: true, target: servers.selected.value }"
          />
          <p v-else class="placeholder">Select a server from the sidebar.</p>
        </section>
        <section v-show="view === 'run'" class="stack-view">
          <RunPanel />
        </section>
      </main>
    </div>

    <Transition name="modal">
      <CommandPalette
        v-if="paletteOpen"
        :items="paletteItems"
        @close="paletteOpen = false"
      />
    </Transition>

    <Transition name="modal">
      <ShortcutsDialog v-if="shortcutsOpen" @close="shortcutsOpen = false" />
    </Transition>

    <Transition name="modal">
      <PreflightDialog
        v-if="preflight"
        :workflow-name="preflight.workflow.name"
        :steps="preflight.steps"
        @close="preflight = null"
        @run="runWorkflow(preflight!.workflow)"
      />
    </Transition>

    <Transition name="modal">
      <ProjectDialog
        v-if="projectDialog.open"
        :project="projectDialog.target"
        @close="projectDialog = { open: false, target: null }"
        @save="saveProject"
      />
    </Transition>

    <Transition name="modal">
      <ServerDialog
        v-if="serverDialog.open"
        :server="serverDialog.target"
        @close="serverDialog = { open: false, target: null }"
        @save="saveServer"
      />
    </Transition>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.viewbar {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 33px;
  padding: 0 12px;
  background: var(--surface-0);
  border-bottom: 1px solid var(--border);
  flex: none;
}

.viewbar button {
  padding: 4px 11px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--fg-faint);
  font-family: var(--mono);
  font-size: 11px;
  cursor: pointer;
  transition: background 0.15s var(--ease-out), color 0.15s var(--ease-out);
}

.viewbar button:hover:not(:disabled) {
  background: var(--surface-2);
  color: var(--fg-dim);
}

.viewbar button.on {
  background: var(--accent-soft);
  color: var(--accent);
}

.viewbar button:disabled {
  opacity: 0.3;
  cursor: default;
}

.pip {
  display: inline-block;
  width: 5px;
  height: 5px;
  margin-left: 6px;
  border-radius: 50%;
  background: var(--warn);
  vertical-align: middle;
  animation: gv-pip 1s ease-in-out infinite;
}

@keyframes gv-pip {
  50% { opacity: 0.25; }
}

.spacer { flex: 1; }

.hint {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--fg-faint);
}

.terminal-view,
.stack-view {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.panes {
  position: relative;
  flex: 1;
  min-height: 0;
  background: var(--term-bg);
}

.pane-slot { height: 100%; }

.placeholder {
  padding: 26px;
  font-size: 12px;
  color: var(--fg-faint);
}

kbd {
  padding: 1px 5px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface-2);
  font-family: var(--mono);
  font-size: 10.5px;
}
</style>
