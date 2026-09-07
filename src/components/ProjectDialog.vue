<script setup lang="ts">
import { ref, reactive, computed, watch, nextTick } from 'vue'
import { basename, pickDirectory } from '@/lib/api'
import {
  defaultChecks,
  defaultScripts,
  type Project,
  type Check,
  type Deployment,
  type Script,
  type Workflow,
} from '@/stores/projects'
import { useServers } from '@/stores/servers'

const props = defineProps<{ project: Project | null }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'save', value: Omit<Project, 'id'>): void
}>()

type Tab = 'details' | 'commands' | 'workflows' | 'status'

const servers = useServers()

const tab = ref<Tab>('details')
const error = ref<string | null>(null)
const nameInput = ref<HTMLInputElement | null>(null)

const form = reactive({
  name: '',
  path: '',
  description: '',
  scripts: [] as Script[],
  workflows: [] as Workflow[],
  checks: [] as Check[],
  deployments: [] as Deployment[],
})

/** Reset the form whenever the dialog is pointed at a different project. */
watch(
  () => props.project,
  (project) => {
    error.value = null
    tab.value = 'details'
    form.name = project?.name ?? ''
    form.path = project?.path ?? ''
    form.description = project?.description ?? ''
    // Clone so cancelling does not mutate the stored project.
    form.scripts = project ? project.scripts.map((s) => ({ ...s })) : defaultScripts()
    form.workflows = project
      ? project.workflows.map((w) => ({ ...w, steps: w.steps.map((s) => ({ ...s })) }))
      : []
    form.checks = project ? project.checks.map((c) => ({ ...c })) : defaultChecks()
    form.deployments = project ? project.deployments.map((d) => ({ ...d })) : []
    void nextTick(() => nameInput.value?.focus())
  },
  { immediate: true },
)

// ------------------------------------------------------------------ details ---

const browse = async () => {
  const picked = await pickDirectory()
  if (!picked) return
  form.path = picked
  if (!form.name.trim()) form.name = basename(picked)
}

// ----------------------------------------------------------------- commands ---

const addScript = async () => {
  form.scripts.push({ id: crypto.randomUUID(), name: '', command: '', cwd: '' })
  await nextTick()
  const rows = document.querySelectorAll<HTMLInputElement>('.dialog .s-name')
  rows[rows.length - 1]?.focus()
}

const removeScript = (id: string) => {
  form.scripts = form.scripts.filter((s) => s.id !== id)
  // A workflow must never point at a command that no longer exists.
  for (const workflow of form.workflows) {
    workflow.steps = workflow.steps.filter((step) => step.scriptId !== id)
  }
}

// ---------------------------------------------------------------- workflows ---

const usableScripts = computed(() => form.scripts.filter((s) => s.name.trim()))

const addDeployment = () => {
  const first = servers.state.servers[0]
  if (!first) return
  form.deployments.push({ id: crypto.randomUUID(), serverId: first.id, path: '' })
}

const removeDeployment = (id: string) => {
  form.deployments = form.deployments.filter((d) => d.id !== id)
}

const addCheck = () =>
  form.checks.push({ id: crypto.randomUUID(), name: '', command: '', cwd: '', serverId: null })

const removeCheck = (id: string) => {
  form.checks = form.checks.filter((c) => c.id !== id)
}

const addWorkflow = () => form.workflows.push({ id: crypto.randomUUID(), name: '', steps: [] })

const removeWorkflow = (id: string) => {
  form.workflows = form.workflows.filter((w) => w.id !== id)
}

const scriptById = (id: string) => form.scripts.find((s) => s.id === id) ?? null

/** Commands not yet in this workflow, offered by the "add step" picker. */
const available = (workflow: Workflow) =>
  usableScripts.value.filter((s) => !workflow.steps.some((step) => step.scriptId === s.id))

const addStep = (workflow: Workflow, event: Event) => {
  const select = event.target as HTMLSelectElement
  const scriptId = select.value
  if (!scriptId) return
  workflow.steps.push({ scriptId, mode: 'wait', serverId: null })
  // Reset so the picker always reads "Add step…" rather than the last choice.
  select.value = ''
}

const removeStep = (workflow: Workflow, index: number) => workflow.steps.splice(index, 1)

/** Steps run top to bottom, so the list is the definition — never auto-sorted. */
const moveStep = (workflow: Workflow, index: number, delta: number) => {
  const to = index + delta
  if (to < 0 || to >= workflow.steps.length) return
  const [step] = workflow.steps.splice(index, 1)
  workflow.steps.splice(to, 0, step)
}

// -------------------------------------------------------------------- save ---

const submit = () => {
  if (!form.name.trim()) {
    tab.value = 'details'
    error.value = 'Give the project a name.'
    return void nextTick(() => nameInput.value?.focus())
  }
  if (!form.path.trim()) {
    tab.value = 'details'
    error.value = 'Choose the project folder.'
    return
  }

  const halfFilled = form.scripts.find(
    (s) => (s.name.trim() && !s.command.trim()) || (!s.name.trim() && s.command.trim()),
  )
  if (halfFilled) {
    tab.value = 'commands'
    error.value = 'Every command needs both a name and a command line.'
    return
  }

  const scripts = form.scripts
    .filter((s) => s.name.trim() && s.command.trim())
    .map((s) => ({ ...s, name: s.name.trim(), command: s.command.trim(), cwd: s.cwd.trim() }))

  const keep = new Set(scripts.map((s) => s.id))
  const unnamed = form.workflows.find((w) => !w.name.trim() && w.steps.length)
  if (unnamed) {
    tab.value = 'workflows'
    error.value = 'Give every workflow a name, or remove it.'
    return
  }

  const workflows = form.workflows
    .map((w) => ({
      ...w,
      name: w.name.trim(),
      steps: w.steps.filter((step) => keep.has(step.scriptId)),
    }))
    .filter((w) => w.name && w.steps.length)

  const checks = form.checks
    .filter((c) => c.name.trim() && c.command.trim())
    .map((c) => ({ ...c, name: c.name.trim(), command: c.command.trim(), cwd: c.cwd.trim() }))

  const deployments = form.deployments
    .filter((d) => d.serverId && d.path.trim())
    .map((d) => ({ ...d, path: d.path.trim() }))

  emit('save', {
    checks,
    deployments,
    name: form.name.trim(),
    path: form.path.trim(),
    description: form.description.trim(),
    scripts,
    workflows,
  })
}
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <div class="dialog" role="dialog" aria-modal="true">
      <h2 class="pixel">{{ project ? 'Edit project' : 'Register a project' }}</h2>

      <nav class="dialog-tabs">
        <button :class="{ on: tab === 'details' }" @click="tab = 'details'">Details</button>
        <button :class="{ on: tab === 'commands' }" @click="tab = 'commands'">
          Commands<span v-if="form.scripts.length" class="count">{{ form.scripts.length }}</span>
        </button>
        <button :class="{ on: tab === 'workflows' }" @click="tab = 'workflows'">
          Workflows<span v-if="form.workflows.length" class="count">{{ form.workflows.length }}</span>
        </button>
        <button :class="{ on: tab === 'status' }" @click="tab = 'status'">
          Status<span v-if="form.checks.length" class="count">{{ form.checks.length }}</span>
        </button>
      </nav>

      <!-- ------------------------------------------------------------ details -->
      <div v-show="tab === 'details'" class="tab-pane">
        <label>
          <span>Name <em class="req">required</em></span>
          <input ref="nameInput" v-model="form.name" placeholder="WMS" spellcheck="false" />
        </label>

        <label>
          <span>Folder <em class="req">required</em></span>
          <div class="row">
            <input v-model="form.path" placeholder="C:\Projects\WMS" spellcheck="false" />
            <button class="ghost" @click="browse">Browse…</button>
          </div>
        </label>

        <label>
          <span>Description</span>
          <input v-model="form.description" placeholder="Vue 3 · NestJS · Prisma · MySQL" />
        </label>

        <p v-if="!project" class="hint">
          That is all you need to register a project. Commands and workflows can wait until
          you know what you run most.
        </p>
      </div>

      <!-- ----------------------------------------------------------- commands -->
      <div v-show="tab === 'commands'" class="tab-pane">
        <p class="hint">
          Each command becomes a button on the project page. <strong>Run in</strong> is a folder
          inside the project — set it to <code>frontend</code> instead of writing <code>cd</code>.
        </p>

        <div v-for="script in form.scripts" :key="script.id" class="card">
          <div class="card-top">
            <label class="grow">
              <span>Name</span>
              <input v-model="script.name" class="s-name" placeholder="Start frontend" spellcheck="false" />
            </label>
            <label class="grow">
              <span>Run in</span>
              <input v-model="script.cwd" placeholder="project root" spellcheck="false" />
            </label>
            <button class="del" title="Remove command" @click="removeScript(script.id)">✕</button>
          </div>
          <label>
            <span>Command</span>
            <textarea
              v-model="script.command"
              rows="2"
              spellcheck="false"
              placeholder="npm run dev"
            ></textarea>
          </label>
        </div>

        <p v-if="!form.scripts.length" class="empty">No commands yet.</p>

        <button class="ghost wide" @click="addScript">+ Add command</button>

        <p class="hint foot">
          Several commands can share one button — put each on its own line, or separate them
          with <code>;</code>. Windows PowerShell 5.1 has no <code>&amp;&amp;</code>; use
          <code>cmd1; if ($?) { cmd2 }</code> to stop on failure.
        </p>
      </div>

      <!-- ---------------------------------------------------------- workflows -->
      <div v-show="tab === 'workflows'" class="tab-pane">
        <p class="hint">
          A workflow runs several commands from one button.
          <strong>Wait</strong> runs to completion and stops on failure;
          <strong>Keep running</strong> opens its own tab and moves on — for dev servers,
          which never exit.
        </p>
        <p class="hint">
          Each step also picks <strong>where</strong> it runs. Point one at a server and it goes
          over SSH, carrying the remote exit code back — so one workflow can build here and
          deploy there, stopping if either end fails. Remote <em>Wait</em> steps need key or
          agent auth; if the host asks for a password, run that step as
          <em>Keep running</em> instead so you get a tab to type into.
        </p>

        <p v-if="!usableScripts.length" class="empty">
          Add a named command first — workflows are built from commands you have saved.
        </p>

        <div v-for="workflow in form.workflows" :key="workflow.id" class="card">
          <div class="card-top">
            <label class="grow">
              <span>Workflow name</span>
              <input v-model="workflow.name" placeholder="Deploy" spellcheck="false" />
            </label>
            <button class="del" title="Remove workflow" @click="removeWorkflow(workflow.id)">✕</button>
          </div>

          <ol v-if="workflow.steps.length" class="steps">
            <li v-for="(step, i) in workflow.steps" :key="step.scriptId" class="step">
              <span class="num">{{ i + 1 }}</span>
              <span class="step-name">{{ scriptById(step.scriptId)?.name ?? '(removed)' }}</span>
              <select v-model="step.mode">
                <option value="wait">Wait</option>
                <option value="background">Keep running</option>
              </select>
              <select v-model="step.serverId" class="target" title="Where this step runs">
                <option :value="null">Local</option>
                <option v-for="s in servers.state.servers" :key="s.id" :value="s.id">
                  ⇢ {{ s.name }}
                </option>
              </select>
              <button class="move" title="Move up" :disabled="i === 0" @click="moveStep(workflow, i, -1)">↑</button>
              <button
                class="move"
                title="Move down"
                :disabled="i === workflow.steps.length - 1"
                @click="moveStep(workflow, i, 1)"
              >
                ↓
              </button>
              <button class="del small" title="Remove step" @click="removeStep(workflow, i)">✕</button>
            </li>
          </ol>
          <p v-else class="empty inner">No steps yet.</p>

          <select
            v-if="available(workflow).length"
            class="adder"
            :value="''"
            @change="addStep(workflow, $event)"
          >
            <option value="">+ Add step…</option>
            <option v-for="script in available(workflow)" :key="script.id" :value="script.id">
              {{ script.name }}
            </option>
          </select>
        </div>

        <button
          v-if="usableScripts.length"
          class="ghost wide"
          @click="addWorkflow"
        >
          + Add workflow
        </button>
      </div>

      <!-- ------------------------------------------------------------- status -->
      <div v-show="tab === 'status'" class="tab-pane">
        <p class="hint">
          Tell GeminiVillain where this project lives on each server and it can answer the
          only question that matters before a deploy: <strong>is that machine running the
          code I have here?</strong> It compares git commits — nothing is written.
        </p>

        <div v-for="d in form.deployments" :key="d.id" class="card">
          <div class="card-top">
            <label class="grow">
              <span>Server</span>
              <select v-model="d.serverId">
                <option v-for="sv in servers.state.servers" :key="sv.id" :value="sv.id">
                  {{ sv.name }}
                </option>
              </select>
            </label>
            <label class="grow">
              <span>Path on that server</span>
              <input v-model="d.path" placeholder="/var/www/app" spellcheck="false" />
            </label>
            <button class="del" title="Remove" @click="removeDeployment(d.id)">✕</button>
          </div>
        </div>

        <p v-if="!servers.state.servers.length" class="empty">
          Add a server first, then you can point this project at it.
        </p>
        <button v-else class="ghost wide" @click="addDeployment">+ Add deploy target</button>

        <div class="rule"></div>

        <p class="hint">
          Checks answer <strong>where does this project stand</strong> — here and on your
          servers. They run only when you press Refresh, and the board shows the last line
          each one prints. Keep them read-only.
        </p>

        <div v-for="check in form.checks" :key="check.id" class="card">
          <div class="card-top">
            <label class="grow">
              <span>Name</span>
              <input v-model="check.name" placeholder="Prod commit" spellcheck="false" />
            </label>
            <label class="grow">
              <span>Ask</span>
              <select v-model="check.serverId">
                <option :value="null">This PC</option>
                <option v-for="s in servers.state.servers" :key="s.id" :value="s.id">
                  ⇢ {{ s.name }}
                </option>
              </select>
            </label>
            <button class="del" title="Remove check" @click="removeCheck(check.id)">✕</button>
          </div>
          <label>
            <span>Command</span>
            <input
              v-model="check.command"
              placeholder="git rev-parse --short HEAD"
              spellcheck="false"
            />
          </label>
        </div>

        <p v-if="!form.checks.length" class="empty">No checks yet.</p>
        <button class="ghost wide" @click="addCheck">+ Add check</button>

        <p class="hint foot">
          Useful ones: <code>git rev-parse --short HEAD</code> on both sides to see whether
          production has your latest code, <code>pm2 pid api</code> or
          <code>systemctl is-active nginx</code> to see if a service is up, or
          <code>df -h / | tail -1</code> for disk.
        </p>
      </div>

      <p v-if="error" class="error">{{ error }}</p>

      <div class="footer">
        <button class="ghost" @click="emit('close')">Cancel</button>
        <button class="primary" @click="submit">{{ project ? 'Save' : 'Add project' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  background: rgb(0 0 0 / 55%);
  backdrop-filter: blur(2px);
}

.dialog {
  display: flex;
  flex-direction: column;
  width: min(640px, calc(100vw - 48px));
  max-height: calc(100vh - 70px);
  padding: 22px 24px 20px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-1);
  box-shadow: 0 24px 64px rgb(0 0 0 / 55%);
}

h2 {
  margin: 0 0 16px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--accent);
  flex: none;
}

.dialog-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--border);
  flex: none;
}

.dialog-tabs button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--fg-faint);
  font-family: var(--mono);
  font-size: 11.5px;
  cursor: pointer;
  transition: color 0.15s var(--ease-out), border-color 0.15s var(--ease-out);
}

.dialog-tabs button:hover { color: var(--fg-dim); }

.dialog-tabs button.on {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

.count {
  padding: 1px 5px;
  border-radius: 8px;
  background: var(--surface-3);
  font-size: 10px;
  color: var(--fg-dim);
}

.tab-pane {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding-right: 2px;
}

label { display: block; margin-bottom: 14px; }

label > span {
  display: flex;
  align-items: baseline;
  gap: 7px;
  margin-bottom: 5px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--fg-faint);
}

.req {
  font-style: normal;
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
  color: var(--accent);
  opacity: 0.75;
}

input,
textarea,
select {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-0);
  color: var(--fg);
  font-family: var(--mono);
  font-size: 12px;
  box-sizing: border-box;
  outline: none;
  transition: border-color 0.15s var(--ease-out);
}

input:focus,
textarea:focus,
select:focus { border-color: var(--accent); }

textarea { resize: vertical; line-height: 1.5; font-size: 11.5px; }

.row { display: flex; gap: 8px; }
.row input { flex: 1; }

.card {
  margin-bottom: 12px;
  padding: 12px 13px 2px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--surface-0);
}

.card-top {
  display: flex;
  align-items: flex-end;
  gap: 9px;
}

.card-top .grow { flex: 1; min-width: 0; }
.card-top label { margin-bottom: 14px; }

.del,
.move {
  flex: none;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: transparent;
  color: var(--fg-faint);
  cursor: pointer;
  font-size: 11px;
}

.del { width: 30px; height: 31px; margin-bottom: 14px; }
.del.small { height: 24px; width: 24px; margin: 0; }
.move { width: 24px; height: 24px; }

.del:not(:disabled):hover { border-color: var(--danger-border); color: var(--danger-fg); }
.move:not(:disabled):hover { border-color: var(--accent); color: var(--fg); }
.move:disabled { opacity: 0.3; cursor: default; }

.steps { list-style: none; margin: 0 0 10px; padding: 0; }

.step {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 4px 0;
}

.num {
  width: 18px;
  flex: none;
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--fg-faint);
  text-align: right;
}

.step-name {
  flex: 1;
  min-width: 0;
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.step select { width: auto; padding: 3px 6px; font-size: 11px; }
.step select.target { max-width: 130px; color: var(--accent); }

.adder {
  width: auto;
  margin-bottom: 12px;
  padding: 4px 8px;
  font-size: 11px;
  color: var(--fg-dim);
}

.rule {
  height: 1px;
  margin: 20px 0 16px;
  background: var(--border);
}

.wide {
  width: 100%;
  margin-bottom: 4px;
  border-style: dashed;
}

.hint {
  margin: 0 0 12px;
  font-size: 11px;
  line-height: 1.65;
  color: var(--fg-faint);
}

.hint.foot { margin-top: 12px; margin-bottom: 0; }

.hint code {
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--surface-0);
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--fg-dim);
}

.empty {
  margin: 0 0 12px;
  font-size: 11.5px;
  color: var(--fg-faint);
}

.empty.inner { margin-bottom: 8px; }

.error {
  flex: none;
  margin: 14px 0 0;
  padding: 8px 11px;
  border: 1px solid var(--danger-border);
  border-radius: 7px;
  background: var(--danger-bg);
  color: var(--danger-fg);
  font-size: 11.5px;
}

.footer {
  display: flex;
  justify-content: flex-end;
  gap: 9px;
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
  flex: none;
}
</style>
