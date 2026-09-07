import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

// Tauri expects a fixed port and must not obscure Rust errors.
export default defineConfig({
  // Relative asset paths so Electron can load the bundle via file://
  base: './',
  plugins: [vue()],
  clearScreen: false,
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] }
  },
  build: {
    target: 'esnext',
    sourcemap: false
  }
})
