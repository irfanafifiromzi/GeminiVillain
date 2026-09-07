<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { PlannedStep } from '@/stores/runner'

const props = defineProps<{ workflowName: string; steps: PlannedStep[] }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'run'): void }>()

const acknowledged = ref(false)

watch(() => props.steps, () => (acknowledged.value = false))

const guarded = computed(() => props.steps.filter((s) => s.guarded))
const guardedNames = computed(() => [...new Set(guarded.value.map((s) => s.serverName))].join(', '))
const machines = computed(() => [
  ...new Set(props.steps.map((s) => s.serverName ?? 'This PC')),
])

const blocked = computed(() => guarded.value.length > 0 && !acknowledged.value)
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <div class="dialog" role="dialog" aria-modal="true">
      <h2 class="pixel">{{ workflowName }}</h2>
      <p class="lede">
        This is everything that will run, in order, and where. Nothing has happened yet.
      </p>

      <p v-if="!steps.length" class="empty">
        This workflow has no steps — every command it referred to has been deleted.
      </p>

      <ol v-else class="plan">
        <li v-for="(step, i) in steps" :key="i" class="step" :class="{ guarded: step.guarded }">
          <div class="line">
            <span class="num">{{ i + 1 }}</span>
            <span class="label">{{ step.label }}</span>
            <span class="target" :class="{ remote: step.serverName, danger: step.guarded }">
              {{ step.serverName ? '⇢ ' + step.serverName : 'This PC' }}
            </span>
            <span v-if="step.mode === 'background'" class="mode">keeps running</span>
          </div>
          <code class="cmd">{{ step.preview }}</code>
          <span v-if="!step.serverName" class="where">in {{ step.cwd }}</span>
        </li>
      </ol>

      <p v-if="steps.length" class="summary">
        {{ steps.length }} step{{ steps.length === 1 ? '' : 's' }} across
        {{ machines.length }} machine{{ machines.length === 1 ? '' : 's' }}:
        {{ machines.join(', ') }}. Stops at the first failure.
      </p>

      <label v-if="guarded.length" class="guard">
        <input v-model="acknowledged" type="checkbox" />
        <span>
          This touches <strong>{{ guardedNames }}</strong
          >, which you marked as production.
        </span>
      </label>

      <div class="footer">
        <button class="ghost" @click="emit('close')">Cancel</button>
        <button
          class="primary"
          :class="{ danger: guarded.length }"
          :disabled="blocked || !steps.length"
          @click="emit('run')"
        >
          {{ guarded.length ? 'Run on production' : 'Run' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  background: rgb(0 0 0 / 55%);
  backdrop-filter: blur(2px);
}

.dialog {
  display: flex;
  flex-direction: column;
  width: min(660px, calc(100vw - 48px));
  max-height: calc(100vh - 70px);
  padding: 22px 24px 20px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-1);
  box-shadow: 0 24px 64px rgb(0 0 0 / 55%);
}

h2 {
  margin: 0 0 10px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--accent);
  flex: none;
}

.lede {
  margin: 0 0 16px;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--fg-faint);
  flex: none;
}

.plan {
  list-style: none;
  margin: 0;
  padding: 0;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

.step {
  padding: 9px 11px;
  margin-bottom: 7px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-0);
}

.step.guarded { border-color: var(--danger-border); }

.line {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 6px;
}

.num {
  width: 16px;
  flex: none;
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--fg-faint);
  text-align: right;
}

.label {
  flex: 1;
  min-width: 0;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.target {
  flex: none;
  padding: 1px 7px;
  border: 1px solid var(--border);
  border-radius: 10px;
  font-family: var(--mono);
  font-size: 10px;
  color: var(--fg-faint);
}

.target.remote { border-color: var(--accent); color: var(--accent); }
.target.danger { border-color: var(--danger-border); color: var(--danger-fg); }

.mode {
  flex: none;
  font-size: 10px;
  color: var(--fg-faint);
}

.cmd {
  display: block;
  font-family: var(--mono);
  font-size: 11px;
  line-height: 1.5;
  color: var(--fg-dim);
  word-break: break-all;
}

.where {
  display: block;
  margin-top: 4px;
  font-family: var(--mono);
  font-size: 10px;
  color: var(--fg-faint);
  word-break: break-all;
}

.summary {
  margin: 10px 0 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--fg-faint);
  flex: none;
}

.empty {
  margin: 0;
  font-size: 12px;
  color: var(--fg-faint);
}

.guard {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin: 14px 0 0;
  padding: 10px 12px;
  border: 1px solid var(--danger-border);
  border-radius: 8px;
  background: var(--danger-bg);
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--danger-fg);
  cursor: pointer;
  flex: none;
}

.guard input { margin: 2px 0 0; flex: none; }

.footer {
  display: flex;
  justify-content: flex-end;
  gap: 9px;
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
  flex: none;
}

.primary.danger {
  border-color: #c4262b;
  background: #c4262b;
  color: #fff;
}

.primary:disabled {
  opacity: 0.4;
  cursor: default;
  filter: none;
}
</style>
