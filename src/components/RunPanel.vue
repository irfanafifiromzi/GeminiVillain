<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRunner, type RunStep } from '@/stores/runner'
import { useHistory, ago, type HistoryEntry } from '@/stores/history'

const runner = useRunner()
const history = useHistory()

/** Expanded history rows, keyed by entry id. */
const openEntry = ref<Record<string, boolean>>({})
const toggleEntry = (entry: HistoryEntry) =>
  (openEntry.value[entry.id] = !openEntry.value[entry.id])
const run = computed(() => runner.state.run)

/** Explicit user toggles; unset means "use the sensible default for this state". */
const toggled = ref<Record<string, boolean>>({})

/**
 * Ticks while a run is in flight so elapsed times count up and the spinner
 * animates. Without it the panel renders once and looks frozen.
 */
const now = ref(Date.now())
let timer: number | null = null

onMounted(() => {
  timer = window.setInterval(() => (now.value = Date.now()), 120)
})
onBeforeUnmount(() => {
  if (timer !== null) window.clearInterval(timer)
})

const SPINNER = ['▖', '▘', '▝', '▗']

const glyph = (step: RunStep) => {
  switch (step.status) {
    case 'running':
      return SPINNER[Math.floor(now.value / 140) % SPINNER.length]
    case 'passed':
      return '✓'
    case 'failed':
      return '✗'
    case 'skipped':
      return '–'
    case 'started':
      return '↗'
    default:
      return '·'
  }
}

const secs = (ms: number) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`)

/** Counts up while running, then freezes at the recorded duration. */
const elapsed = (step: RunStep) =>
  step.status === 'running' && step.startedAt ? now.value - step.startedAt : step.ms

const runElapsed = computed(() => {
  if (!run.value) return 0
  return run.value.status === 'running' ? now.value - run.value.startedAt : run.value.ms
})

const waitSteps = computed(() => run.value?.steps.filter((s) => s.mode === 'wait') ?? [])
const doneCount = computed(
  () => waitSteps.value.filter((s) => s.status === 'passed' || s.status === 'failed').length,
)
const currentLabel = computed(
  () => run.value?.steps.find((s) => s.status === 'running')?.label ?? null,
)

/** Running and failed steps open themselves; anything else needs a click. */
const isOpen = (step: RunStep) =>
  toggled.value[step.key] ?? (step.status === 'running' || step.status === 'failed')

const toggle = (step: RunStep) => (toggled.value[step.key] = !isOpen(step))

const dots = (label: string) => '.'.repeat(Math.max(3, 26 - label.length))

/** Keep the live log pinned to the newest line. */
const vAutoscroll = {
  updated(el: HTMLElement) {
    el.scrollTop = el.scrollHeight
  },
}
</script>

<template>
  <section v-if="run" class="panel gv-panel">
    <div class="head">
      <div class="titles">
        <h1 class="pixel">{{ run.workflowName }}</h1>
        <p class="status" :class="run.status">
          <template v-if="run.status === 'running'">
            <span class="beacon"></span>
            Running {{ currentLabel ? '“' + currentLabel + '”' : '' }} ·
            {{ doneCount }}/{{ waitSteps.length }} · {{ secs(runElapsed) }}
          </template>
          <template v-else-if="run.status === 'passed'">
            Finished in {{ secs(run.ms) }}
          </template>
          <template v-else>Failed after {{ secs(run.ms) }}</template>
        </p>
      </div>
      <div class="head-actions">
        <button v-if="run.status === 'running'" class="ghost danger" @click="runner.stop()">
          Stop
        </button>
        <button v-else class="ghost" @click="runner.clear()">Clear</button>
      </div>
    </div>

    <div v-if="run.status === 'running' && waitSteps.length" class="bar">
      <span :style="{ width: (doneCount / waitSteps.length) * 100 + '%' }"></span>
    </div>

    <ol class="steps">
      <li v-for="step in run.steps" :key="step.key" class="step" :class="step.status">
        <button class="row" :disabled="!step.output" @click="toggle(step)">
          <span class="glyph">{{ glyph(step) }}</span>
          <span class="label">{{ step.label }}</span>
          <span v-if="step.serverName" class="where" :title="step.preview">⇢ {{ step.serverName }}</span>
          <span class="dots">{{ dots(step.label) }}</span>
          <span class="meta">
            <template v-if="step.mode === 'background'">running in a tab</template>
            <template v-else-if="step.status === 'running'">{{ secs(elapsed(step)) }}</template>
            <template v-else-if="step.status === 'skipped'">skipped</template>
            <template v-else-if="step.status === 'pending'">queued</template>
            <template v-else>
              {{ secs(step.ms) }}<template v-if="step.exitCode"> · exit {{ step.exitCode }}</template>
            </template>
          </span>
        </button>

        <pre v-if="isOpen(step) && step.output" v-autoscroll class="output">{{
          step.output.replace(/\s+$/, '')
        }}</pre>
        <p v-else-if="step.status === 'running'" class="waiting">waiting for output…</p>
      </li>
    </ol>
  </section>

  <section v-else class="panel gv-panel">
    <h1 class="pixel">Runs</h1>
    <p v-if="!history.state.entries.length" class="placeholder flush">
      Nothing has run yet. Workflow runs are kept here, newest first.
    </p>

    <ol v-else class="history">
      <li v-for="entry in history.state.entries" :key="entry.id" class="entry" :class="entry.status">
        <button class="entry-row" @click="toggleEntry(entry)">
          <span class="mark">{{ entry.status === 'passed' ? '✓' : '✗' }}</span>
          <span class="entry-name">{{ entry.workflowName }}</span>
          <span class="entry-project">{{ entry.projectName }}</span>
          <span class="entry-when">{{ ago(entry.startedAt) }} · {{ secs(entry.ms) }}</span>
        </button>

        <ol v-if="openEntry[entry.id]" class="entry-steps">
          <li v-for="(step, i) in entry.steps" :key="i">
            <span class="step-mark" :class="step.state">{{
              step.state === 'passed'
                ? '✓'
                : step.state === 'failed'
                  ? '✗'
                  : step.state === 'started'
                    ? '↗'
                    : '–'
            }}</span>
            <span class="step-label">{{ step.label }}</span>
            <span v-if="step.serverName" class="step-where">⇢ {{ step.serverName }}</span>
            <span class="step-time">
              {{ secs(step.ms)
              }}<template v-if="step.exitCode"> · exit {{ step.exitCode }}</template>
            </span>
          </li>
        </ol>
      </li>
    </ol>

    <button v-if="history.state.entries.length" class="ghost small" @click="history.clear()">
      Clear history
    </button>
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
  margin-bottom: 14px;
}

.titles { min-width: 0; }

h1 {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
}

.status {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 9px 0 0;
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--fg-faint);
}

.status.running { color: var(--warn); }
.status.passed { color: var(--ok); }
.status.failed { color: var(--danger-fg); }

.beacon {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 50%;
  background: var(--warn);
  animation: gv-beacon 1.1s ease-in-out infinite;
}

@keyframes gv-beacon {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgb(230 180 80 / 55%); }
  70% { opacity: 0.55; box-shadow: 0 0 0 6px rgb(230 180 80 / 0%); }
}

.head-actions { display: flex; gap: 8px; flex: none; }

.bar {
  height: 3px;
  margin: 0 0 18px;
  border-radius: 2px;
  background: var(--surface-3);
  overflow: hidden;
}

.bar span {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 0.3s var(--ease-out);
}

.steps {
  list-style: none;
  margin: 0;
  padding: 0;
}

.step { margin-bottom: 2px; }

.row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--fg-dim);
  font-family: var(--mono);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.row:disabled { cursor: default; }
.row:not(:disabled):hover { background: var(--surface-2); }

.step.running .row { background: var(--accent-soft); }

.glyph { width: 14px; flex: none; text-align: center; }

.step.running .glyph { color: var(--warn); }
.step.passed .glyph { color: var(--ok); }
.step.failed .glyph { color: var(--danger-fg); }
.step.started .glyph { color: var(--accent); }
.step.skipped { opacity: 0.45; }

.label { flex: none; color: var(--fg); }

.where {
  flex: none;
  padding: 1px 6px;
  border: 1px solid var(--accent);
  border-radius: 10px;
  font-size: 10px;
  color: var(--accent);
}

.dots {
  flex: 1;
  overflow: hidden;
  color: var(--border);
  white-space: nowrap;
}

.meta {
  flex: none;
  font-size: 11px;
  color: var(--fg-faint);
}

.step.running .meta { color: var(--warn); }

.output {
  margin: 2px 0 10px 32px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-0);
  color: var(--fg-dim);
  font-family: var(--mono);
  font-size: 11px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 300px;
  overflow-y: auto;
}

.step.running .output { border-color: var(--warn); }

.waiting {
  margin: 2px 0 10px 32px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--fg-faint);
}

.placeholder {
  padding: 26px;
  font-size: 12px;
  color: var(--fg-faint);
}

.placeholder.flush { padding: 0; }

.history { list-style: none; margin: 0 0 16px; padding: 0; }

.entry { margin-bottom: 3px; }

.entry-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  width: 100%;
  padding: 7px 10px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--fg-dim);
  font-family: var(--mono);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.entry-row:hover { background: var(--surface-2); }

.mark { flex: none; width: 12px; color: var(--fg-faint); }
.entry.passed .mark { color: var(--ok); }
.entry.failed .mark { color: var(--danger-fg); }

.entry-name { flex: none; color: var(--fg); }

.entry-project {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  color: var(--fg-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-when { flex: none; font-size: 11px; color: var(--fg-faint); }

.entry-steps {
  list-style: none;
  margin: 2px 0 10px 22px;
  padding: 0;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--fg-faint);
}

.entry-steps li {
  display: flex;
  align-items: baseline;
  gap: 9px;
  padding: 2px 0;
}

.step-mark { width: 10px; flex: none; }
.step-mark.passed { color: var(--ok); }
.step-mark.failed { color: var(--danger-fg); }
.step-mark.started { color: var(--accent); }

.step-label { flex: none; color: var(--fg-dim); }
.step-where { flex: none; color: var(--accent); }
.step-time { flex: 1; text-align: right; }
</style>
