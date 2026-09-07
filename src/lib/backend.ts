/**
 * One contract, two hosts.
 *
 * GeminiVillain targets Tauri (see `src-tauri/`), but building that needs the
 * MSVC linker. Electron implements the identical command and event surface, so
 * the whole UI runs unchanged on whichever host is available.
 *
 * Everything above this file talks commands and events, never a host SDK.
 */

export type Unlisten = () => void

export interface Backend {
  readonly kind: 'tauri' | 'electron'
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>
  listen<T>(event: string, handler: (payload: T) => void): Promise<Unlisten>
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  close(): Promise<void>
  pickDirectory(title: string): Promise<string | null>
  pickFile(title: string): Promise<string | null>
}

/** Injected by `electron/preload.cjs`. */
interface ElectronBridge {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>
  on(event: string, handler: (payload: unknown) => void): Unlisten
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown
    gv?: ElectronBridge
  }
}

/**
 * Electron's IPC uses structured clone, which throws on a Vue reactive Proxy —
 * and every store hands us one. Round-tripping through JSON both unwraps the
 * proxies and drops `undefined`, which is not cloneable either.
 *
 * Tauri needs no equivalent: its invoke already serialises as JSON.
 */
const toPlain = (args?: Record<string, unknown>): Record<string, unknown> | undefined =>
  args === undefined ? undefined : (JSON.parse(JSON.stringify(args)) as Record<string, unknown>)

const electronBackend = (bridge: ElectronBridge): Backend => ({
  kind: 'electron',
  invoke: <T,>(command: string, args?: Record<string, unknown>) =>
    bridge.invoke(command, toPlain(args)) as Promise<T>,
  listen: <T,>(event: string, handler: (payload: T) => void) =>
    Promise.resolve(bridge.on(event, handler as (p: unknown) => void)),
  minimize: () => bridge.invoke('window_minimize') as Promise<void>,
  toggleMaximize: () => bridge.invoke('window_toggle_maximize') as Promise<void>,
  close: () => bridge.invoke('window_close') as Promise<void>,
  pickDirectory: (title: string) =>
    bridge.invoke('pick_directory', { title }) as Promise<string | null>,
  pickFile: (title: string) => bridge.invoke('pick_file', { title }) as Promise<string | null>,
})

const tauriBackend = async (): Promise<Backend> => {
  const [{ invoke }, { listen }, { getCurrentWindow }, dialog] = await Promise.all([
    import('@tauri-apps/api/core'),
    import('@tauri-apps/api/event'),
    import('@tauri-apps/api/window'),
    import('@tauri-apps/plugin-dialog'),
  ])
  const win = getCurrentWindow()

  return {
    kind: 'tauri',
    invoke: <T,>(command: string, args?: Record<string, unknown>) => invoke<T>(command, args),
    listen: async <T,>(event: string, handler: (payload: T) => void) => {
      const unlisten = await listen<T>(event, (e) => handler(e.payload))
      return unlisten as Unlisten
    },
    minimize: () => win.minimize(),
    toggleMaximize: () => win.toggleMaximize(),
    close: () => win.close(),
    pickDirectory: async (title: string) => {
      const picked = await dialog.open({ directory: true, multiple: false, title })
      return typeof picked === 'string' ? picked : null
    },
    pickFile: async (title: string) => {
      const picked = await dialog.open({ directory: false, multiple: false, title })
      return typeof picked === 'string' ? picked : null
    },
  }
}

let cached: Promise<Backend> | null = null

export const backend = (): Promise<Backend> => {
  if (!cached) {
    cached = window.gv
      ? Promise.resolve(electronBackend(window.gv))
      : window.__TAURI_INTERNALS__
        ? tauriBackend()
        : Promise.reject(new Error('GeminiVillain must run inside Electron or Tauri.'))
  }
  return cached
}

export const invoke = async <T,>(command: string, args?: Record<string, unknown>): Promise<T> =>
  (await backend()).invoke<T>(command, args)

export const listen = async <T,>(
  event: string,
  handler: (payload: T) => void,
): Promise<Unlisten> => (await backend()).listen<T>(event, handler)
