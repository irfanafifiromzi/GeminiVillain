<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import type { PaletteItem } from '@/lib/palette'

const props = defineProps<{ items: PaletteItem[] }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const query = ref('')
const index = ref(0)
const input = ref<HTMLInputElement | null>(null)
const listEl = ref<HTMLElement | null>(null)

/**
 * Subsequence matching, the way every palette worth using behaves: "srvdev"
 * finds "Server: dev-box". Earlier and tighter matches rank first.
 */
const score = (haystack: string, needle: string): number => {
  if (!needle) return 1
  const h = haystack.toLowerCase()
  const n = needle.toLowerCase()

  const direct = h.indexOf(n)
  if (direct !== -1) return 1000 - direct

  let at = 0
  let first = -1
  let gaps = 0
  for (const ch of n) {
    const found = h.indexOf(ch, at)
    if (found === -1) return 0
    if (first === -1) first = found
    else gaps += found - at
    at = found + 1
  }
  return Math.max(1, 500 - first - gaps)
}

const results = computed(() => {
  const q = query.value.trim()
  return props.items
    .map((item) => ({
      item,
      rank: Math.max(score(item.label, q), score(item.kind + ' ' + item.label, q) - 50),
    }))
    .filter((r) => r.rank > 0)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 40)
    .map((r) => r.item)
})

watch(results, () => (index.value = 0))

const choose = (item: PaletteItem | undefined) => {
  if (!item) return
  emit('close')
  item.run()
}

const move = (delta: number) => {
  if (!results.value.length) return
  index.value = (index.value + delta + results.value.length) % results.value.length
  void nextTick(() => {
    listEl.value
      ?.querySelectorAll('.hit')
      [index.value]?.scrollIntoView({ block: 'nearest' })
  })
}

void nextTick(() => input.value?.focus())
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <div class="palette" role="dialog" aria-modal="true">
      <input
        ref="input"
        v-model="query"
        class="query"
        placeholder="Run a command, open a project, connect to a server…"
        spellcheck="false"
        @keydown.down.prevent="move(1)"
        @keydown.up.prevent="move(-1)"
        @keydown.enter.prevent="choose(results[index])"
        @keydown.esc.prevent="emit('close')"
      />

      <p v-if="!results.length" class="none">Nothing matches “{{ query }}”.</p>

      <div v-else ref="listEl" class="hits">
        <button
          v-for="(item, i) in results"
          :key="item.id"
          class="hit"
          :class="{ on: i === index }"
          @click="choose(item)"
          @mousemove="index = i"
        >
          <span class="kind">{{ item.kind }}</span>
          <span class="label">{{ item.label }}</span>
          <span v-if="item.detail" class="detail">{{ item.detail }}</span>
        </button>
      </div>

      <div class="foot">
        <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
        <span><kbd>↵</kbd> run</span>
        <span><kbd>esc</kbd> close</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  justify-content: center;
  padding-top: 12vh;
  background: rgb(0 0 0 / 55%);
  backdrop-filter: blur(2px);
}

.palette {
  display: flex;
  flex-direction: column;
  width: min(620px, calc(100vw - 48px));
  max-height: 60vh;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-1);
  box-shadow: 0 24px 64px rgb(0 0 0 / 55%);
  overflow: hidden;
}

.query {
  flex: none;
  padding: 14px 16px;
  border: 0;
  border-bottom: 1px solid var(--border);
  background: transparent;
  color: var(--fg);
  font-family: var(--mono);
  font-size: 13px;
  outline: none;
}

.hits {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 6px;
}

.hit {
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

.hit.on { background: var(--accent-soft); }

.kind {
  flex: none;
  width: 8ch;
  font-size: 10px;
  color: var(--fg-faint);
  text-transform: lowercase;
}

.hit.on .kind { color: var(--accent); }

.label {
  flex: none;
  color: var(--fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 30ch;
}

.detail {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  color: var(--fg-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
}

.none {
  margin: 0;
  padding: 18px 16px;
  font-size: 12px;
  color: var(--fg-faint);
}

.foot {
  display: flex;
  gap: 16px;
  flex: none;
  padding: 8px 14px;
  border-top: 1px solid var(--border);
  font-size: 10.5px;
  color: var(--fg-faint);
}

kbd {
  padding: 1px 5px;
  margin-right: 3px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface-2);
  font-family: var(--mono);
  font-size: 10px;
}
</style>
