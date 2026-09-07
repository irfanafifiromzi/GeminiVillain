<script setup lang="ts">
import { useTerminals } from '@/stores/terminals'

const terminals = useTerminals()
const { state } = terminals

const emit = defineEmits<{ (e: 'new'): void; (e: 'close', key: string): void }>()

const statusClass = (status: string) =>
  status === 'running' ? 'dot-run' : status === 'starting' ? 'dot-start' : 'dot-dead'
</script>

<template>
  <div class="tabbar">
    <div class="tabs">
      <button
        v-for="tab in state.tabs"
        :key="tab.key"
        class="tab"
        :class="{ active: tab.key === state.activeKey }"
        :title="tab.cwd ?? tab.title"
        @click="terminals.activate(tab.key)"
        @auxclick.middle.prevent="emit('close', tab.key)"
      >
        <span class="dot" :class="statusClass(tab.status)"></span>
        <span class="label">{{ tab.title }}</span>
        <span class="close" title="Close tab" @click.stop="emit('close', tab.key)">✕</span>
      </button>
    </div>

    <button class="new" title="New terminal (Ctrl+Shift+T)" @click="$emit('new')">+</button>
  </div>
</template>

<style scoped>
.tabbar {
  display: flex;
  align-items: stretch;
  height: 34px;
  background: var(--surface-1);
  border-bottom: 1px solid var(--border);
  flex: none;
}

.tabs {
  display: flex;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.tabs::-webkit-scrollbar { display: none; }

.tab {
  display: flex;
  align-items: center;
  gap: 7px;
  max-width: 200px;
  padding: 0 8px 0 11px;
  border: 0;
  border-right: 1px solid var(--border);
  background: transparent;
  color: var(--fg-dim);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  flex: none;
}

.tab:hover { background: var(--surface-2); }

.tab.active {
  background: var(--term-bg);
  color: var(--fg);
  box-shadow: inset 0 2px 0 var(--accent);
}

.label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
}

.dot-run { background: var(--ok); }
.dot-start { background: var(--warn); }
.dot-dead { background: var(--fg-faint); }

.close {
  width: 16px;
  height: 16px;
  display: grid;
  place-items: center;
  border-radius: 4px;
  font-size: 10px;
  color: var(--fg-faint);
  opacity: 0;
}

.tab:hover .close,
.tab.active .close { opacity: 1; }

.close:hover {
  background: var(--surface-3);
  color: var(--fg);
}

.new {
  width: 36px;
  border: 0;
  background: transparent;
  color: var(--fg-dim);
  font-size: 17px;
  cursor: pointer;
  flex: none;
}

.new:hover { background: var(--surface-2); color: var(--fg); }
</style>
