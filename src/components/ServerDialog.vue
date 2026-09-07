<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import { pickFile } from '@/lib/api'
import { blankServer, sshCommand, type Server } from '@/stores/servers'

const props = defineProps<{ server: Server | null }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'save', value: Omit<Server, 'id'>): void
}>()

const form = reactive(blankServer())
const error = ref<string | null>(null)

watch(
  () => props.server,
  (server) => {
    error.value = null
    Object.assign(form, server ? { ...server } : blankServer())
  },
  { immediate: true },
)

/** Live preview of the exact command GeminiVillain will run. */
const preview = computed(() =>
  form.host.trim()
    ? sshCommand({ ...form, id: 'preview' })
    : 'ssh …',
)

const browseKey = async () => {
  const picked = await pickFile('Select an SSH private key')
  if (picked) form.keyPath = picked
}

const submit = () => {
  if (!form.name.trim()) return (error.value = 'Give the server a name.')
  if (!form.host.trim()) return (error.value = 'Enter a hostname or IP address.')

  const port = Number(form.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return (error.value = 'Port must be a whole number between 1 and 65535.')
  }

  emit('save', {
    name: form.name.trim(),
    host: form.host.trim(),
    user: form.user.trim(),
    port,
    keyPath: form.keyPath.trim(),
    description: form.description.trim(),
    production: form.production,
  })
}
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <div class="dialog" role="dialog" aria-modal="true">
      <h2 class="pixel">{{ server ? 'Edit server' : 'Add server' }}</h2>

      <label>
        <span>Name</span>
        <input v-model="form.name" placeholder="Production" spellcheck="false" autofocus />
      </label>

      <div class="grid">
        <label class="span2">
          <span>Host</span>
          <input v-model="form.host" placeholder="203.0.113.10" spellcheck="false" />
        </label>
        <label>
          <span>Port</span>
          <input v-model.number="form.port" type="number" min="1" max="65535" />
        </label>
      </div>

      <label>
        <span>User</span>
        <input v-model="form.user" placeholder="root" spellcheck="false" />
      </label>

      <label>
        <span>Private key <em>optional</em></span>
        <div class="row">
          <input
            v-model="form.keyPath"
            placeholder="Leave empty to use ssh-agent or your default keys"
            spellcheck="false"
          />
          <button class="ghost" @click="browseKey">Browse…</button>
        </div>
      </label>

      <label>
        <span>Description</span>
        <input v-model="form.description" placeholder="Main API + database" />
      </label>

      <label class="check" :class="{ on: form.production }">
        <input v-model="form.production" type="checkbox" />
        <span>
          <strong>This is production.</strong>
          Ask me to confirm before any workflow runs anything here.
        </span>
      </label>

      <div class="preview">
        <span class="preview-label">Runs</span>
        <code>{{ preview }}</code>
      </div>

      <p v-if="error" class="error">{{ error }}</p>

      <div class="footer">
        <button class="ghost" @click="emit('close')">Cancel</button>
        <button class="primary" @click="submit">{{ server ? 'Save' : 'Add server' }}</button>
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
  width: min(560px, calc(100vw - 48px));
  max-height: calc(100vh - 90px);
  overflow-y: auto;
  padding: 22px 24px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-1);
  box-shadow: 0 24px 64px rgb(0 0 0 / 55%);
}

h2 {
  margin: 0 0 20px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--accent);
}

label {
  display: block;
  margin-bottom: 14px;
}

label > span {
  display: block;
  margin-bottom: 5px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--fg-faint);
}

label em {
  font-style: normal;
  text-transform: none;
  letter-spacing: 0;
  opacity: 0.7;
}

input {
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

input:focus { border-color: var(--accent); }

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr 110px;
  gap: 10px;
}

.span2 { grid-column: span 2; }

.row { display: flex; gap: 8px; }
.row input { flex: 1; }

.check {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin-bottom: 4px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--fg-dim);
  cursor: pointer;
}

.check.on {
  border-color: var(--danger-border);
  background: var(--danger-bg);
  color: var(--danger-fg);
}

.check input { width: auto; margin: 2px 0 0; flex: none; }

.preview {
  display: flex;
  align-items: baseline;
  gap: 9px;
  margin: 18px 0 0;
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-0);
  overflow-x: auto;
}

.preview-label {
  flex: none;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--fg-faint);
}

.preview code {
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--accent);
  white-space: nowrap;
}

.error {
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
  margin-top: 22px;
}
</style>
