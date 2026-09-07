<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import * as pty from '@/lib/pty'
import { xtermTheme } from '@/lib/theme'
import { useTheme } from '@/stores/theme'
import iconUrl from '@/assets/gv-icon.png'
import type { TerminalTab } from '@/stores/terminals'

const props = defineProps<{ tab: TerminalTab; active: boolean }>()

const appTheme = useTheme()

/** Whatever best identifies this session: an ssh target, else its folder. */
const markSub = computed(() => props.tab.subtitle ?? props.tab.cwd)

const host = ref<HTMLDivElement | null>(null)
const error = ref<string | null>(null)
const searchOpen = ref(false)
const searchTerm = ref('')
const searchInput = ref<HTMLInputElement | null>(null)

let term: Terminal | null = null
let fit: FitAddon | null = null
let search: SearchAddon | null = null
let observer: ResizeObserver | null = null
let unlistenOutput: (() => void) | null = null
let unlistenExit: (() => void) | null = null

let lastCols = 0
let lastRows = 0

/**
 * Push the current pixel size down to the pty so ncurses apps line up.
 *
 * Only when it actually changed: ConPTY answers every resize by repainting
 * the whole screen, so a redundant resize is a visible flicker.
 */
const syncSize = () => {
  if (!fit || !term || !props.active) return
  try {
    fit.fit()
  } catch {
    return // element not laid out yet
  }
  if (term.cols === lastCols && term.rows === lastRows) return
  lastCols = term.cols
  lastRows = term.rows
  if (props.tab.id) void pty.resize(props.tab.id, term.cols, term.rows).catch(() => {})
}

const runSearch = (dir: 'next' | 'prev') => {
  if (!search || !searchTerm.value) return
  if (dir === 'next') search.findNext(searchTerm.value)
  else search.findPrevious(searchTerm.value)
}

const openSearch = async () => {
  searchOpen.value = true
  await nextTick()
  searchInput.value?.select()
  searchInput.value?.focus()
}

const closeSearch = () => {
  searchOpen.value = false
  search?.clearDecorations?.()
  term?.focus()
}

onMounted(async () => {
  // The pty id is the tab key, so the output filter below is correct from
  // the very first byte the shell emits.
  props.tab.id = props.tab.key

  // Measure only once the webfont is in place. A font landing after the
  // first fit changes the cell size, so the terminal would be sized wrong
  // until something else triggered a refit.
  await document.fonts.ready.catch(() => {})

  term = new Terminal({
    fontFamily: '"JetBrains Mono", "Cascadia Mono", Consolas, "Courier New", monospace',
    fontSize: 13,
    lineHeight: 1.25,
    cursorBlink: true,
    cursorStyle: 'bar',
    scrollback: 10000,
    allowProposedApi: true,
    macOptionIsMeta: true,
    theme: xtermTheme(appTheme.state.name),
  })

  fit = new FitAddon()
  search = new SearchAddon()
  term.loadAddon(fit)
  term.loadAddon(search)
  term.loadAddon(new WebLinksAddon())
  term.open(host.value!)

  try {
    fit.fit()
  } catch {
    /* laid out on the next observer tick */
  }

  // Keystrokes go straight to the shell; the shell owns all echo and editing.
  term.onData((data) => {
    if (props.tab.status === 'running') {
      void pty.write(props.tab.id, data).catch(() => {})
    }
  })

  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true
    // Ctrl+Shift+C/V for clipboard, leaving Ctrl+C free to interrupt.
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyC') {
      const sel = term!.getSelection()
      if (sel) void navigator.clipboard.writeText(sel)
      return false
    }
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyV') {
      void navigator.clipboard.readText().then((text) => {
        if (text && props.tab.id) void pty.write(props.tab.id, text)
      })
      return false
    }
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyF') {
      void openSearch()
      return false
    }
    if (e.key === 'Escape' && searchOpen.value) {
      closeSearch()
      return false
    }
    return true
  })

  unlistenOutput = await pty.onOutput((id, bytes) => {
    if (id === props.tab.id) term?.write(bytes)
  })

  unlistenExit = await pty.onExit((id, code) => {
    if (id !== props.tab.id) return
    props.tab.status = 'exited'
    props.tab.exitCode = code
    term?.write(`\r\n\x1b[38;5;244m[process exited with code ${code ?? 0}]\x1b[0m\r\n`)
  })

  observer = new ResizeObserver(() => syncSize())
  observer.observe(host.value!)

  lastCols = term.cols
  lastRows = term.rows

  try {
    const result = await pty.spawn({
      id: props.tab.key,
      shell: props.tab.shellOverride ?? undefined,
      args: props.tab.args ?? undefined,
      cwd: props.tab.cwd ?? undefined,
      cols: term.cols,
      rows: term.rows,
    })
    props.tab.shell = result.shell
    props.tab.cwd = result.cwd
    props.tab.status = 'running'

    if (props.tab.pendingCommand) {
      const command = props.tab.pendingCommand
      props.tab.pendingCommand = null
      // Let the shell print its prompt before injecting the command.
      setTimeout(() => {
        if (props.tab.id) void pty.write(props.tab.id, `${command}\r`)
      }, 400)
    }
  } catch (e) {
    error.value = String(e)
    props.tab.status = 'exited'
  }

  if (props.active) {
    syncSize()
    term.focus()
  }
})

// Repaint the terminal when the app theme changes under it.
watch(
  () => appTheme.state.name,
  (name) => {
    if (term) term.options.theme = xtermTheme(name)
  },
)

watch(
  () => props.active,
  async (active) => {
    if (!active) return
    await nextTick()
    syncSize()
    term?.focus()
  },
)

onBeforeUnmount(() => {
  observer?.disconnect()
  unlistenOutput?.()
  unlistenExit?.()
  if (props.tab.id) void pty.kill(props.tab.id).catch(() => {})
  term?.dispose()
})
</script>

<template>
  <div class="pane">
    <div v-if="error" class="pane-error">
      <strong>Could not start a shell.</strong>
      <span>{{ error }}</span>
    </div>

    <div v-if="searchOpen" class="search">
      <input
        ref="searchInput"
        v-model="searchTerm"
        placeholder="Find in terminal"
        spellcheck="false"
        @keydown.enter.prevent="runSearch($event.shiftKey ? 'prev' : 'next')"
        @keydown.esc.prevent="closeSearch"
      />
      <button title="Previous (Shift+Enter)" @click="runSearch('prev')">↑</button>
      <button title="Next (Enter)" @click="runSearch('next')">↓</button>
      <button title="Close (Esc)" @click="closeSearch">✕</button>
    </div>

    <!-- Chrome, not terminal content: writing into ConPTY's own screen would
         desync its cursor model from xterm's and echo every keystroke twice. -->
    <div class="mark">
      <img :src="iconUrl" alt="" width="14" height="14" />
      <span class="pixel wordmark">GEMINIVILLAIN</span>
      <span v-if="markSub" class="mark-sub">{{ markSub }}</span>
    </div>

    <div ref="host" class="xterm-host"></div>
  </div>
</template>

<style scoped>
.pane {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--term-bg);
}

.mark {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  padding: 7px 14px 6px;
  border-bottom: 1px solid var(--border);
  user-select: none;
}

.mark img {
  /* 128px pixel art: never let the browser smooth it. */
  image-rendering: pixelated;
  flex: none;
}

.wordmark {
  font-size: 8px;
  color: var(--accent);
  text-shadow: 0 0 10px rgb(255 176 32 / 35%);
}

.mark-sub {
  margin-left: auto;
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--fg-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding-left: 14px;
}

.xterm-host {
  flex: 1;
  min-height: 0;
  padding: 8px 4px 8px 12px;
  box-sizing: border-box;
}

.pane-error {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 12px;
  padding: 12px 14px;
  border: 1px solid var(--danger-border);
  border-radius: 8px;
  background: var(--danger-bg);
  color: var(--danger-fg);
  font-size: 12px;
}

.search {
  position: absolute;
  top: 10px;
  right: 18px;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-2);
  box-shadow: 0 8px 24px rgb(0 0 0 / 45%);
}

.search input {
  width: 190px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--surface-1);
  color: var(--fg);
  font-size: 12px;
  outline: none;
}

.search input:focus {
  border-color: var(--accent);
}

.search button {
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--fg-dim);
  cursor: pointer;
  font-size: 12px;
}

.search button:hover {
  background: var(--surface-3);
  color: var(--fg);
}
</style>
