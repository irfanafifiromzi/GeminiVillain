<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { hasSsh } from '@/lib/api'
import { useServers, sshCommand, type Server } from '@/stores/servers'

const props = defineProps<{ server: Server }>()
const emit = defineEmits<{
  (e: 'connect'): void
  (e: 'edit'): void
}>()

const servers = useServers()
const sshAvailable = ref(true)

onMounted(async () => {
  try {
    sshAvailable.value = await hasSsh()
  } catch {
    sshAvailable.value = true // don't cry wolf if the probe itself fails
  }
})

const remove = async () => {
  if (!confirm(`Remove "${props.server.name}" from GeminiVillain?\n\nThe server itself is untouched.`)) return
  await servers.remove(props.server.id)
}
</script>

<template>
  <section class="panel gv-panel">
    <div class="head">
      <div class="titles">
        <h1 class="pixel">{{ server.name }}</h1>
        <p class="target">
          {{ server.user ? server.user + '@' : '' }}{{ server.host }}<span
            v-if="server.port !== 22"
            >:{{ server.port }}</span
          >
        </p>
        <p v-if="server.description" class="desc">{{ server.description }}</p>
      </div>
      <div class="head-actions">
        <button class="ghost" @click="emit('edit')">Edit</button>
        <button class="ghost danger" @click="remove">Remove</button>
      </div>
    </div>

    <p v-if="!sshAvailable" class="warn">
      ⚠ The OpenSSH client was not found on PATH. Install it via
      <code>Settings → System → Optional features → OpenSSH Client</code>.
    </p>

    <div class="actions">
      <button class="primary" @click="emit('connect')">Connect</button>
    </div>

    <h2 class="pixel">Connection</h2>
    <div class="facts">
      <div class="fact">
        <span>Host</span>
        <code>{{ server.host }}</code>
      </div>
      <div class="fact">
        <span>Port</span>
        <code>{{ server.port }}</code>
      </div>
      <div class="fact">
        <span>User</span>
        <code>{{ server.user || '(ssh default)' }}</code>
      </div>
      <div class="fact">
        <span>Key</span>
        <code>{{ server.keyPath || '(agent / default keys)' }}</code>
      </div>
    </div>

    <h2 class="pixel">Command</h2>
    <p class="note">
      GeminiVillain does not implement SSH — it runs the OpenSSH client in a normal
      terminal tab, so everything you already know still works.
    </p>
    <pre class="cmd">{{ sshCommand(server) }}</pre>
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
  color: var(--fg);
}

.target {
  margin: 9px 0 0;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--accent);
  word-break: break-all;
}

.desc {
  margin: 9px 0 0;
  font-size: 12px;
  line-height: 1.6;
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
  font-size: 11.5px;
  line-height: 1.6;
}

.warn code {
  font-family: var(--mono);
  font-size: 11px;
  opacity: 0.85;
}

.actions {
  display: flex;
  gap: 9px;
  margin: 20px 0 4px;
}

h2 {
  margin: 28px 0 12px;
  font-size: 9px;
  line-height: 1.6;
  color: var(--fg-faint);
}

.facts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(215px, 1fr));
  gap: 9px;
}

.fact {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 10px 13px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--surface-1);
  min-width: 0;
}

.fact span {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--fg-faint);
}

.fact code {
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.note {
  margin: 0 0 10px;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--fg-faint);
  max-width: 66ch;
}

.cmd {
  margin: 0;
  padding: 11px 13px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--surface-0);
  color: var(--accent);
  font-family: var(--mono);
  font-size: 11.5px;
  overflow-x: auto;
}
</style>
