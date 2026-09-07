<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import * as api from '@/lib/api'
import type { Project, Script, Workflow } from '@/stores/projects'
import { useProjects } from '@/stores/projects'
import { useChecks } from '@/stores/checks'
import { useSync } from '@/stores/sync'
import { useTerminals, type TerminalTab } from '@/stores/terminals'
import * as pty from '@/lib/pty'
import { useServers } from '@/stores/servers'

const props = defineProps<{ project: Project }>()
const emit = defineEmits<{
  (e: 'run', script: Script): void
  (e: 'run-workflow', workflow: Workflow): void
  (e: 'focus-tab', key: string): void
  (e: 'restart-tab', tab: TerminalTab): void
  (e: 'terminal'): void
  (e: 'edit'): void
}>()

const projects = useProjects()
const checks = useChecks()
const sync = useSync()
const terminals = useTerminals()
const servers = useServers()
const notice = ref<string | null>(null)

/** A multi-line command still has to fit on one chip. */
const firstLine = (command: string) => {
  const [first, ...rest] = command.split(/\r?\n/).filter((l) => l.trim())
  return rest.length ? `${first} …` : (first ?? '')
}

/** Terminals this project owns, running ones first. */
const processes = computed(() => {
  const tabs = terminals.forProject(props.project.id)
  return [...tabs].sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running'))
})

const liveCount = computed(() => processes.value.filter((t) => t.status === 'running').length)

/** Ticks so uptime counts up while you are looking at it. */
const now = ref(Date.now())
const timer = window.setInterval(() => (now.value = Date.now()), 1000)
onBeforeUnmount(() => window.clearInterval(timer))

const uptime = (tab: TerminalTab) => {
  const ms = now.value - tab.startedAt
  if (ms < 60000) return Math.max(1, Math.round(ms / 1000)) + "s"
  if (ms < 3600000) return Math.round(ms / 60000) + "m"
  return (ms / 3600000).toFixed(1) + "h"
}

const stop = (tab: TerminalTab) => {
  if (tab.id) void pty.kill(tab.id).catch(() => {})
}

const stopAll = () => {
  for (const tab of processes.value) if (tab.status === 'running') stop(tab)
}

const flash = (message: string) => {
  notice.value = message
  setTimeout(() => (notice.value = null), 4000)
}

const openFolder = async () => {
  try {
    await api.openFolder(props.project.path)
  } catch (e) {
    flash(String(e))
  }
}

const openVscode = async () => {
  try {
    await api.openInVscode(props.project.path)
  } catch (e) {
    flash(`${e}. Install the "code" command from VS Code's command palette.`)
  }
}

const remove = async () => {
  if (!confirm(`Remove "${props.project.name}" from GeminiVillain?\n\nThe folder on disk is not touched.`)) return
  await projects.remove(props.project.id)
}
</script>

<template>
  <section class="panel gv-panel">
    <div class="head">
      <div class="titles">
        <h1 class="pixel">{{ project.name }}</h1>
        <p class="path" :title="project.path">{{ project.path }}</p>
        <p v-if="project.description" class="desc">{{ project.description }}</p>
      </div>
      <div class="head-actions">
        <button class="ghost" @click="emit('edit')">Edit</button>
        <button class="ghost danger" @click="remove">Remove</button>
      </div>
    </div>

    <p v-if="projects.isMissing(project.path)" class="warn">
      ⚠ This folder no longer exists on disk. Terminals will open in your home directory instead.
    </p>

    <div class="actions">
      <button class="primary" @click="emit('terminal')">Open Terminal</button>
      <button class="ghost" @click="openVscode">Open VS Code</button>
      <button class="ghost" @click="openFolder">Open Folder</button>
    </div>

    <template v-if="processes.length">
      <div class="section">
        <h2 class="pixel">Processes</h2>
        <button v-if="liveCount" class="ghost small" @click="stopAll">
          Stop all ({{ liveCount }})
        </button>
        <span class="branch">{{ liveCount }} running</span>
      </div>

      <ul class="procs">
        <li v-for="tab in processes" :key="tab.key" class="proc" :class="tab.status">
          <button
            class="proc-open"
            :title="tab.originCommand ?? tab.title"
            @click="emit('focus-tab', tab.key)"
          >
            <span class="dot"></span>
            <span class="proc-name">{{ tab.title }}</span>
            <span class="proc-cmd">{{ tab.originCommand ?? tab.shell ?? '' }}</span>
            <span class="proc-meta">
              <template v-if="tab.status === 'running'">{{ uptime(tab) }}</template>
              <template v-else-if="tab.status === 'starting'">starting…</template>
              <template v-else>exited {{ tab.exitCode ?? 0 }}</template>
            </span>
          </button>
          <button v-if="tab.status === 'running'" class="ghost tiny" @click="stop(tab)">
            Stop
          </button>
          <button v-else class="ghost tiny" @click="emit('restart-tab', tab)">Restart</button>
        </li>
      </ul>
    </template>

    <div class="section">
      <h2 class="pixel">Deployed</h2>
      <button
        v-if="project.deployments.length"
        class="ghost small"
        :disabled="sync.isRunning(project.id)"
        @click="sync.check(project, servers.state.servers)"
      >
        {{ sync.isRunning(project.id) ? "Comparing…" : "Compare" }}
      </button>
      <span v-if="sync.localOf(project.id)?.ok" class="branch">
        {{ sync.localOf(project.id)?.branch
        }}<template v-if="sync.localOf(project.id)?.dirty">
          · {{ sync.localOf(project.id)?.dirty }} uncommitted</template
        >
      </span>
    </div>

    <p v-if="!project.deployments.length" class="empty">
      This project is not pointed at any server yet. Add one under
      <strong>Edit → Status</strong> and GeminiVillain can tell you whether that machine
      is running the code you have here.
    </p>
    <p v-else-if="!sync.targetsOf(project.id).length" class="empty">
      <strong>Compare</strong> asks each server which commit it is on, and tells you how
      far ahead of it you are. Nothing is written.
    </p>

    <ul v-else class="targets">
      <li v-for="row in sync.targetsOf(project.id)" :key="row.id" class="target" :class="row.state">
        <span class="verdict">
          <template v-if="row.state === 'checking'">checking…</template>
          <template v-else-if="row.state === 'current'">up to date</template>
          <template v-else-if="row.state === 'behind'">{{ row.behind }} behind</template>
          <template v-else-if="row.state === 'ahead'">{{ row.ahead }} ahead</template>
          <template v-else-if="row.state === 'diverged'">diverged</template>
          <template v-else-if="row.state === 'unknown'">unknown commit</template>
          <template v-else>error</template>
        </span>
        <span class="who">{{ row.serverName }}</span>
        <span class="where">{{ row.path }}</span>
        <span class="say">{{ row.message }}</span>
      </li>
    </ul>

    <template v-if="project.checks.length">
      <div class="section">
        <h2 class="pixel">Status</h2>
        <button class="ghost small" :disabled="checks.isRunning(project.id)" @click="checks.refresh(project, servers.state.servers)">
          {{ checks.isRunning(project.id) ? "Checking…" : "Refresh" }}
        </button>
      </div>

      <p v-if="!checks.resultsFor(project.id).length" class="empty">
        Nothing checked yet. <strong>Refresh</strong> asks this PC and your servers where
        things stand. Read-only.
      </p>

      <dl v-else class="readout">
        <template v-for="row in checks.resultsFor(project.id)" :key="row.id">
          <dt :title="row.output">
            <span class="host" :class="{ remote: row.target }">{{ row.target ?? "local" }}</span>
            <span class="key">{{ row.name }}</span>
            <span class="fill"></span>
          </dt>
          <dd :class="row.status" :title="row.output">
            <template v-if="row.status === 'running'">…</template>
            <template v-else>{{ row.value }}</template>
          </dd>
        </template>
      </dl>
    </template>

    <template v-if="project.workflows.length">
      <h2 class="pixel">Workflows</h2>
      <div class="scripts">
        <button
          v-for="workflow in project.workflows"
          :key="workflow.id"
          class="script workflow"
          :title="workflow.steps.length + ' step(s)'"
          @click="emit('run-workflow', workflow)"
        >
          <span class="script-name">⚡ {{ workflow.name }}</span>
          <code>{{ workflow.steps.length }} step{{ workflow.steps.length === 1 ? '' : 's' }}</code>
        </button>
      </div>
    </template>

    <h2 class="pixel">Commands</h2>
    <p v-if="!project.scripts.length" class="empty">
      No commands saved. Use <strong>Edit</strong> to add one.
    </p>
    <div v-else class="scripts">
      <button
        v-for="script in project.scripts"
        :key="script.id"
        class="script"
        :title="`Run: ${script.command}`"
        @click="emit('run', script)"
      >
        <span class="script-name">▶ {{ script.name }}</span>
        <code>{{ script.cwd ? script.cwd + ' › ' : '' }}{{ firstLine(script.command) }}</code>
      </button>
    </div>

    <p v-if="notice" class="notice">{{ notice }}</p>
  </section>
</template>

<style scoped>
.panel {
  padding: 22px 26px;
  overflow-y: auto;
  height: 100%;
  box-sizing: border-box;
}

.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.titles { min-width: 0; }

h1 {
  margin: 0;
  font-size: 15px;
  line-height: 1.5;
}

.path {
  margin: 5px 0 0;
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--fg-faint);
  word-break: break-all;
}

.desc {
  margin: 9px 0 0;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--fg-dim);
  max-width: 62ch;
}

.head-actions { display: flex; gap: 8px; flex: none; }

.warn {
  margin: 16px 0 0;
  padding: 9px 12px;
  border: 1px solid var(--danger-border);
  border-radius: 8px;
  background: var(--danger-bg);
  color: var(--danger-fg);
  font-size: 12px;
}

.actions {
  display: flex;
  gap: 9px;
  margin: 20px 0 4px;
  flex-wrap: wrap;
}

.section {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 28px 0 12px;
}

.section h2 { margin: 0; }

.branch {
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--fg-faint);
}

.procs { list-style: none; margin: 0 0 4px; padding: 0; }

.proc {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.proc-open {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex: 1;
  min-width: 0;
  padding: 7px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-1);
  color: var(--fg-dim);
  font-family: var(--mono);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.12s var(--ease-out);
}

.proc-open:hover { border-color: var(--accent); }

.dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--fg-faint);
  align-self: center;
}

.proc.running .dot { background: var(--ok); }
.proc.starting .dot { background: var(--warn); }
.proc.exited .proc-name { color: var(--fg-faint); }

.proc-name { flex: none; color: var(--fg); }

.proc-cmd {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  color: var(--fg-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.proc-meta { flex: none; font-size: 11px; color: var(--fg-faint); }
.proc.running .proc-meta { color: var(--ok); }

.tiny { flex: none; padding: 4px 10px; font-size: 11px; }

.targets { list-style: none; margin: 0; padding: 0; }

/*
 * One line per server, verdict first — the answer should be readable without
 * reading the rest of the row.
 */
.target {
  display: grid;
  grid-template-columns: 10ch 12ch 1fr;
  align-items: baseline;
  gap: 4px 12px;
  padding: 7px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  margin-bottom: 6px;
  background: var(--surface-1);
  font-family: var(--mono);
  font-size: 12px;
}

.verdict {
  font-weight: 700;
  color: var(--fg-faint);
  white-space: nowrap;
}

.target.current .verdict { color: var(--ok); }
.target.behind .verdict,
.target.diverged .verdict { color: var(--accent); }
.target.error .verdict,
.target.unknown .verdict { color: var(--danger-fg); }

.who { color: var(--fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.where {
  color: var(--fg-faint);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.say {
  grid-column: 2 / -1;
  color: var(--fg-dim);
  font-size: 11px;
}

.small { padding: 3px 10px; font-size: 11px; }

/* A readout, not a dashboard: aligned columns and dot leaders, the way the
   run log and every terminal tool already presents this kind of answer. */
.readout {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: baseline;
  gap: 0 14px;
  margin: 0;
  padding: 10px 13px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--surface-1);
  font-family: var(--mono);
  font-size: 12px;
}

.readout dt {
  display: flex;
  align-items: baseline;
  gap: 9px;
  min-width: 0;
  padding: 3px 0;
}

.host {
  flex: none;
  width: 7ch;
  color: var(--fg-faint);
  font-size: 10.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.host.remote { color: var(--accent); }

.key {
  flex: none;
  color: var(--fg-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 28ch;
}

/* Dot leaders drawn rather than typed, so they always reach the value. */
.fill {
  flex: 1;
  min-width: 12px;
  height: 1em;
  background-image: radial-gradient(circle, var(--border) 1px, transparent 1px);
  background-size: 5px 5px;
  background-position: 0 0.72em;
  background-repeat: repeat-x;
}

.readout dd {
  margin: 0;
  padding: 3px 0;
  color: var(--fg);
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 46ch;
}

.readout dd.failed { color: var(--danger-fg); }
.readout dd.running { color: var(--warn); }

h2 {
  margin: 28px 0 12px;
  font-size: 9px;
  line-height: 1.6;
  color: var(--fg-faint);
}

.scripts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(215px, 1fr));
  gap: 9px;
}

.script {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 11px 13px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--surface-1);
  color: var(--fg);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.12s, background 0.12s;
}

.script.workflow { border-color: var(--accent); }

.script:hover {
  border-color: var(--accent);
  background: var(--surface-2);
}

.script-name { font-size: 12.5px; font-weight: 500; }

.script code {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--fg-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.empty { font-size: 12.5px; color: var(--fg-faint); }

.notice {
  margin-top: 18px;
  padding: 9px 12px;
  border-radius: 8px;
  background: var(--surface-2);
  font-size: 12px;
  color: var(--fg-dim);
}
</style>
