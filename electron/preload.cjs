// The only bridge between the renderer and Node.
//
// `invoke` mirrors Tauri's command call; `on` mirrors its event listener,
// returning an unsubscribe function.

const { contextBridge, ipcRenderer } = require('electron')

/** Events the renderer is allowed to subscribe to. */
const ALLOWED_EVENTS = new Set(['pty://output', 'pty://exit'])

contextBridge.exposeInMainWorld('gv', {
  invoke: (command, args) => ipcRenderer.invoke(command, args ?? {}),

  on: (event, handler) => {
    if (!ALLOWED_EVENTS.has(event)) {
      throw new Error(`Refusing to listen on unknown channel: ${event}`)
    }
    const listener = (_e, payload) => handler(payload)
    ipcRenderer.on(event, listener)
    return () => ipcRenderer.removeListener(event, listener)
  },
})
