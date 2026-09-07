// Electron host for GeminiVillain.
//
// Implements exactly the command/event surface that `src-tauri/src/*.rs`
// exposes, so the Vue frontend is identical on both hosts. See
// `src/lib/backend.ts` for the contract.

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { spawn } = require('node:child_process')
const pty = require('node-pty')

const DEV_URL = process.env.GV_DEV_URL || null

/** id -> { proc, exited } */
const sessions = new Map()

let mainWindow = null

// ---------------------------------------------------------------- window ---

/**
 * Only useful while developing: a packaged build takes its icon from the
 * executable's own resources, and the source tree is not shipped.
 */
const devIcon = () => {
  const candidate = path.join(__dirname, '..', 'build', 'icon.ico')
  return fs.existsSync(candidate) ? candidate : undefined
}

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 820,
    minHeight: 520,
    frame: false,
    backgroundColor: '#0d1017',
    show: false,
    title: 'GeminiVillain',
    icon: devIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())

  if (DEV_URL) {
    mainWindow.loadURL(DEV_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

const send = (channel, payload) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

// ------------------------------------------------------------------- pty ---

const which = (exe) =>
  (process.env.PATH || '')
    .split(path.delimiter)
    .some((dir) => dir && fs.existsSync(path.join(dir, exe)))

const resolveShell = (requested) => {
  if (requested && requested.trim()) {
    const name = requested.trim()
    // CreateProcess does no PATHEXT lookup, so a bare `ssh` fails on Windows
    // where `ssh.exe` would work.
    if (process.platform === 'win32' && !path.extname(name) && which(`${name}.exe`)) {
      return `${name}.exe`
    }
    return name
  }
  if (process.platform === 'win32') {
    return which('pwsh.exe') ? 'pwsh.exe' : 'powershell.exe'
  }
  return process.env.SHELL || '/bin/bash'
}

/** Fall back to home so a deleted project folder never blocks a terminal. */
const resolveCwd = (requested) => {
  if (requested && requested.trim()) {
    try {
      if (fs.statSync(requested).isDirectory()) return requested
    } catch {
      /* fall through */
    }
  }
  return app.getPath('home')
}

/** GeminiVillain draws its own wordmark, so suppress the shell's. */
const defaultArgs = (shell) => {
  const exe = path.basename(shell).toLowerCase()
  return exe === 'powershell.exe' || exe === 'pwsh.exe' ? ['-NoLogo'] : []
}

ipcMain.handle('pty_spawn', (_e, { id, shell, args, cwd, cols, rows }) => {
  const resolvedShell = resolveShell(shell)
  const resolvedCwd = resolveCwd(cwd)
  const resolvedArgs = Array.isArray(args) && args.length ? args : defaultArgs(resolvedShell)

  const proc = pty.spawn(resolvedShell, resolvedArgs, {
    name: 'xterm-256color',
    cols: Math.max(1, cols | 0),
    rows: Math.max(1, rows | 0),
    cwd: resolvedCwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      GEMINIVILLAIN: '1',
    },
  })

  const session = { proc, exited: false }
  sessions.set(id, session)

  // base64 keeps the wire format identical to the Rust host.
  proc.onData((data) => {
    send('pty://output', { id, data: Buffer.from(data, 'utf8').toString('base64') })
  })

  proc.onExit(({ exitCode }) => {
    session.exited = true
    sessions.delete(id)
    send('pty://exit', { id, code: exitCode })
  })

  return { id, shell: resolvedShell, cwd: resolvedCwd }
})

ipcMain.handle('pty_write', (_e, { id, data }) => {
  const session = sessions.get(id)
  if (!session || session.exited) return
  session.proc.write(data)
})

ipcMain.handle('pty_resize', (_e, { id, cols, rows }) => {
  const session = sessions.get(id)
  // A resize racing a closed tab is normal, not an error.
  if (!session || session.exited) return
  try {
    session.proc.resize(Math.max(1, cols | 0), Math.max(1, rows | 0))
  } catch {
    /* the shell exited between the check and the call */
  }
})

ipcMain.handle('pty_kill', (_e, { id }) => {
  const session = sessions.get(id)
  if (!session || session.exited) return
  try {
    session.proc.kill()
  } catch {
    /* already gone */
  }
  sessions.delete(id)
})

// -------------------------------------------------------------- projects ---

const storePath = (name) => {
  const dir = app.getPath('userData')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, name)
}

const readStore = (name) => {
  const file = storePath(name)
  if (!fs.existsSync(file)) return []
  const raw = fs.readFileSync(file, 'utf8')
  if (!raw.trim()) return []
  try {
    return JSON.parse(raw)
  } catch (e) {
    throw new Error(`${name} is corrupt: ${e.message}`)
  }
}

/** Keep the last few versions so a bad write is never the end of the story. */
const KEEP_BACKUPS = 8

const backup = (name, file) => {
  if (!fs.existsSync(file)) return
  const dir = path.join(path.dirname(file), "backups")
  fs.mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  fs.copyFileSync(file, path.join(dir, `${path.parse(name).name}-${stamp}.json`))

  const mine = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(path.parse(name).name + "-"))
    .sort()
  for (const stale of mine.slice(0, Math.max(0, mine.length - KEEP_BACKUPS))) {
    try {
      fs.unlinkSync(path.join(dir, stale))
    } catch {
      /* a backup we cannot prune is not worth failing the save over */
    }
  }
}

const writeStore = (name, value) => {
  const file = storePath(name)
  backup(name, file)
  // Temp file then rename, so a crash mid-write cannot truncate the registry.
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

ipcMain.handle('projects_load', () => readStore('projects.json'))
ipcMain.handle('projects_save', (_e, { projects }) => writeStore('projects.json', projects))

ipcMain.handle('servers_load', () => readStore('servers.json'))
ipcMain.handle('servers_save', (_e, { servers }) => writeStore('servers.json', servers))

ipcMain.handle('runs_load', () => readStore('runs.json'))
ipcMain.handle('runs_save', (_e, { runs }) => writeStore('runs.json', runs))

ipcMain.handle('path_exists', (_e, { path: p }) => {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
})

// --------------------------------------------------------- os integration ---

ipcMain.handle('open_folder', async (_e, { path: p }) => {
  if (!fs.existsSync(p)) throw new Error(`${p} does not exist`)
  const err = await shell.openPath(p)
  if (err) throw new Error(err)
})

ipcMain.handle('open_in_vscode', (_e, { path: p }) => {
  if (!fs.existsSync(p)) throw new Error(`${p} does not exist`)

  if (process.platform === 'win32') {
    // `code` on Windows is a .cmd shim, which Node refuses to spawn directly
    // since CVE-2024-27980, so go through cmd.exe. Check PATH first, because
    // once cmd owns the process its failure is invisible to us.
    if (!which('code.cmd') && !which('code.exe') && !which('code.bat')) {
      throw new Error('VS Code was not found on PATH')
    }
    const child = spawn('cmd.exe', ['/c', 'code', p], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.unref()
    return
  }

  try {
    const child = spawn('code', [p], { detached: true, stdio: 'ignore' })
    child.unref()
  } catch {
    throw new Error('VS Code was not found on PATH')
  }
})

ipcMain.handle('pick_directory', async (_e, { title }) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: title || 'Select project folder',
    properties: ['openDirectory'],
  })
  return result.canceled || !result.filePaths.length ? null : result.filePaths[0]
})

ipcMain.handle('pick_file', async (_e, { title }) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: title || 'Select a file',
    // Private keys have no extension, and .ssh is hidden on Windows.
    defaultPath: path.join(app.getPath('home'), '.ssh'),
    properties: ['openFile', 'showHiddenFiles'],
  })
  return result.canceled || !result.filePaths.length ? null : result.filePaths[0]
})

/** Reports whether the OpenSSH client is available, so the UI can warn early. */
ipcMain.handle('has_ssh', () => which('ssh.exe') || which('ssh'))

// ---------------------------------------------------------------- chrome ---

ipcMain.handle('window_minimize', () => mainWindow?.minimize())
ipcMain.handle('window_toggle_maximize', () => {
  if (!mainWindow) return
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
})
ipcMain.handle('window_close', () => mainWindow?.close())

// ----------------------------------------------------------- lifecycle ---

app.whenReady().then(createWindow)

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Never leave orphaned shells behind.
app.on('before-quit', () => {
  for (const session of sessions.values()) {
    try {
      session.proc.kill()
    } catch {
      /* already gone */
    }
  }
  sessions.clear()
})
