<script setup lang="ts">
import { minimizeWindow, toggleMaximizeWindow, closeWindow } from '@/lib/api'
import iconUrl from '@/assets/gv-icon.png'
import { useTheme } from '@/stores/theme'

const theme = useTheme()

/** Ripple out from the button itself, so the swap feels like it came from there. */
const flip = (event: MouseEvent) => {
  const r = (event.currentTarget as HTMLElement).getBoundingClientRect()
  void theme.toggle({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
}
</script>

<template>
  <header class="titlebar" data-tauri-drag-region>
    <div class="brand" data-tauri-drag-region>
      <img class="bolt" :src="iconUrl" alt="" width="16" height="16" />
      <span class="name pixel">GEMINIVILLAIN</span>
      <span class="tagline">Turn commands into workflows.</span>
    </div>

    <div class="controls">
      <button
        class="ctl theme"
        :title="theme.state.name === 'dark' ? 'Switch to light' : 'Switch to dark'"
        @click="flip"
      >
        <!-- Thin strokes, to match the minimise/maximise/close icons beside it. -->
        <svg
          v-if="theme.state.name === 'dark'"
          width="13"
          height="13"
          viewBox="0 0 13 13"
          fill="none"
          stroke="currentColor"
          stroke-width="1"
          stroke-linecap="round"
        >
          <circle cx="6.5" cy="6.5" r="2.6" />
          <path d="M6.5 1v1.4M6.5 10.6V12M1 6.5h1.4M10.6 6.5H12" />
          <path d="M2.6 2.6l1 1M9.4 9.4l1 1M10.4 2.6l-1 1M3.6 9.4l-1 1" />
        </svg>
        <svg v-else width="13" height="13" viewBox="0 0 13 13" fill="currentColor">
          <path d="M10.3 8.3A4.6 4.6 0 0 1 4.7 2.7 4.6 4.6 0 1 0 10.3 8.3Z" />
        </svg>
      </button>
      <button class="ctl" title="Minimize" @click="minimizeWindow()">
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor" stroke-width="1" /></svg>
      </button>
      <button class="ctl" title="Maximize" @click="toggleMaximizeWindow()">
        <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1" /></svg>
      </button>
      <button class="ctl close" title="Close" @click="closeWindow()">
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" stroke-width="1" /></svg>
      </button>
    </div>
  </header>
</template>

<style scoped>
.titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 34px;
  padding-left: 12px;
  background: var(--surface-0);
  border-bottom: 1px solid var(--border);
  user-select: none;
  flex: none;
  /* Tauri uses the data attribute; Electron uses this. Both are harmless. */
  -webkit-app-region: drag;
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  pointer-events: none;
}

.bolt {
  image-rendering: pixelated;
  flex: none;
}

.name {
  font-size: 10px;
  color: var(--accent);
}

.tagline {
  font-size: 10.5px;
  color: var(--fg-faint);
  font-family: var(--mono);
}

.controls {
  display: flex;
  height: 100%;
  -webkit-app-region: no-drag;
}

.ctl {
  width: 44px;
  height: 100%;
  display: grid;
  place-items: center;
  border: 0;
  background: transparent;
  color: var(--fg-dim);
  cursor: pointer;
}

.ctl:hover {
  background: var(--surface-3);
  color: var(--fg);
}

.ctl.theme:hover { color: var(--accent); background: var(--surface-3); }

.ctl.close:hover {
  background: #c4262b;
  color: #fff;
}

@media (max-width: 720px) {
  .tagline { display: none; }
}
</style>
