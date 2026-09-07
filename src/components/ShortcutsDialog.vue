<script setup lang="ts">
defineEmits<{ (e: 'close'): void }>()

const groups = [
  {
    name: 'Anywhere',
    keys: [
      ['Ctrl', 'K', 'Command palette'],
      ['Ctrl', '/', 'This list'],
      ['Esc', '', 'Close a dialog'],
    ],
  },
  {
    name: 'Terminals',
    keys: [
      ['Ctrl', 'Shift+T', 'New terminal'],
      ['Ctrl', 'Shift+W', 'Close terminal'],
      ['Ctrl', 'Tab', 'Next terminal'],
      ['Ctrl', 'Shift+Tab', 'Previous terminal'],
    ],
  },
  {
    name: 'In a terminal',
    keys: [
      ['Ctrl', 'Shift+C', 'Copy selection'],
      ['Ctrl', 'Shift+V', 'Paste'],
      ['Ctrl', 'Shift+F', 'Find in scrollback'],
      ['Ctrl', 'C', 'Interrupt — left alone on purpose'],
    ],
  },
]
</script>

<template>
  <div class="backdrop" @click.self="$emit('close')">
    <div class="dialog" role="dialog" aria-modal="true">
      <h2 class="pixel">Keyboard</h2>

      <div v-for="group in groups" :key="group.name" class="group">
        <h3>{{ group.name }}</h3>
        <div v-for="row in group.keys" :key="row[2]" class="row">
          <span class="combo">
            <kbd>{{ row[0] }}</kbd><kbd v-if="row[1]">{{ row[1] }}</kbd>
          </span>
          <span class="what">{{ row[2] }}</span>
        </div>
      </div>

      <div class="footer">
        <button class="ghost" @click="$emit('close')">Close</button>
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
  width: min(460px, calc(100vw - 48px));
  max-height: calc(100vh - 90px);
  overflow-y: auto;
  padding: 22px 24px 18px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-1);
  box-shadow: 0 24px 64px rgb(0 0 0 / 55%);
}

h2 {
  margin: 0 0 18px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--accent);
}

h3 {
  margin: 0 0 8px;
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--fg-faint);
}

.group { margin-bottom: 18px; }

.row {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 3px 0;
}

.combo { flex: none; width: 14ch; }

.what {
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--fg-dim);
}

kbd {
  display: inline-block;
  padding: 1px 5px;
  margin-right: 3px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface-0);
  font-family: var(--mono);
  font-size: 10px;
  color: var(--fg-dim);
}

.footer {
  display: flex;
  justify-content: flex-end;
  padding-top: 4px;
}
</style>
