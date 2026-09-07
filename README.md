# ⚡ GeminiVillain

> Turn commands into workflows.

A developer command center that starts as a real terminal. GeminiVillain does not
reimplement PowerShell, Git, or npm — it drives them, and wraps the repetitive parts
in a UI you can click.

This repository implements **v0.1** — the scope defined in
[GeminiVillain.md](GeminiVillain.md) §6 and §20.

---

## Quick start

```powershell
npm install
npm run dev
```

A window opens with PowerShell already running inside it.

---

## What works today

| Capability | Status |
| --- | --- |
| Real PowerShell running inside the app (ConPTY) | ✅ |
| Multiple terminal tabs, each its own shell | ✅ |
| Resize, colours, cursor keys, interactive TUIs | ✅ |
| Copy / paste / find in scrollback | ✅ |
| Register projects (name, path, description) | ✅ |
| Open a terminal in a project's folder | ✅ |
| Open project in VS Code / File Explorer | ✅ |
| Save per-project commands and run them as buttons | ✅ |
| Server profiles (host, user, port, key) | ✅ |
| Connect over SSH in a terminal tab | ✅ |
| Per-command subfolder + multi-line commands | ✅ |
| Workflows: chain saved commands behind one button | ✅ |

Not built yet, by design (§19): Git UI, Docker, deployment, error assistant.

---

## A note on the stack

The spec calls for **Tauri + Vue 3 + Rust**, and that backend is written and lives in
[src-tauri/](src-tauri/). It is not the default, for one reason:

> Tauri links with the MSVC toolchain, which requires **Visual Studio C++ Build
> Tools**. Installing those needs local administrator rights, which this machine
> does not have. Rust itself is installed and the crate graph resolves; only the
> linker is missing.

So the app ships on **Electron + node-pty**, which needs no compiler — `node-pty`
ships N-API prebuilt binaries that load into Electron without a rebuild.

**Both hosts implement the same command and event contract**, and the entire Vue
frontend is shared. [src/lib/backend.ts](src/lib/backend.ts) detects which host it is
running in and dispatches accordingly. Nothing in `src/components` or `src/stores`
knows which backend is underneath.

Once the Build Tools are installed, switch with no code changes:

```powershell
npm run dev:tauri
npm run build:tauri
```

To install them (needs an **elevated** shell, and Office's Click-to-Run must not be
holding the global `_MSIExecute` mutex — reboot first if the installer reports 1618):

```powershell
winget install Microsoft.VisualStudio.2022.BuildTools --override `
  "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite + Electron, hot reload on the Vue side |
| `npm run build` | Production bundle, then electron-builder |
| `npm run dev:tauri` | Same app on the Tauri host (needs MSVC) |
| `npm run build:tauri` | NSIS installer via Tauri (needs MSVC) |
| `npm run typecheck` | `vue-tsc --noEmit` |

---

## Keyboard

| Shortcut | Action |
| --- | --- |
| `Ctrl+Shift+T` | New terminal |
| `Ctrl+Shift+W` | Close terminal |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Cycle terminals |
| `Ctrl+Shift+C` / `Ctrl+Shift+V` | Copy / paste |
| `Ctrl+Shift+F` | Find in scrollback |

`Ctrl+C` is deliberately left alone so it still interrupts the running process.

---

## Architecture

```
Vue 3 + xterm.js          the surface: tabs, projects, command buttons
        │
src/lib/backend.ts        picks the host, one contract either way
        │
   ┌────┴────┐
Electron   Tauri          electron/main.cjs  |  src-tauri/src/*.rs
   └────┬────┘
        │
Windows                   PowerShell → npm / git / docker / ssh
```

### How a keystroke travels

1. `xterm.js` `onData` fires in the renderer.
2. `pty_write` crosses to the host process.
3. The host writes to the pty master; the shell owns all echo and line editing.
4. Output comes back as base64 on the `pty://output` event.
5. The matching `TerminalPane` writes those bytes into xterm.

Two details that matter:

- **Output is base64, not a string.** A UTF-8 character can straddle two reads;
  xterm's own decoder reassembles it from raw bytes.
- **The frontend assigns the pty id**, rather than receiving one back from spawn.
  The shell starts writing immediately, so a listener that only learned its id after
  `spawn` resolved would drop PowerShell's banner.

### Look

The identity is pixel-art throughout: `build/icon-source.png` is the app icon
(upscaled nearest-neighbour so it never blurs) and also sits in the title bar and at
the head of every terminal. **Press Start 2P** carries the wordmark and section
headers; **JetBrains Mono** does everything you actually read, terminal included.
Both are bundled as woff2 — nothing is fetched at runtime.

The wordmark above each terminal is app chrome, not terminal output. Painting it
into the buffer was tried and reverted: ConPTY owns that screen region, and writing
into it desynchronises its cursor model from xterm's, which echoes every keystroke
twice.

Two motion rules worth keeping:

- Modals animate through `<Transition name="modal">`; the keyframes live in
  `global.css`, and all motion is disabled under `prefers-reduced-motion`.
- The boot animation fades only. A `scale()` there changes the terminal's measured
  rect mid-animation, so the fit addon resizes the pty and ConPTY repaints — a
  visible flicker on every launch.

### SSH

GeminiVillain does not implement SSH. A server profile is turned into an argument
list for the OpenSSH client that ships with Windows, and that runs in an ordinary
terminal tab — so keys, agents, `~/.ssh/config` and host prompts all behave exactly
as they do anywhere else. The dialog previews the literal command before you save
it, and the panel warns if `ssh` is not on PATH.

### Layout

```
src/
  lib/backend.ts        host detection + the shared contract
  lib/pty.ts            typed wrapper over the pty commands
  lib/api.ts            projects, VS Code, folder, window chrome
  lib/theme.ts          xterm palette
  stores/projects.ts    project registry, persisted through the host
  stores/terminals.ts   tab list and focus
  stores/servers.ts     server profiles + ssh argument building
  stores/runner.ts      workflow execution, exit codes, run log
  components/           TitleBar, Sidebar, TabBar, TerminalPane,
                        ProjectPanel, ProjectDialog,
                        ServerPanel, ServerDialog, RunPanel
  assets/               pixel icon + bundled fonts
electron/
  main.cjs              ipcMain handlers + node-pty sessions
  preload.cjs           the only renderer↔Node bridge
src-tauri/
  src/pty.rs            PtyManager, spawn/write/resize/kill, reader threads
  src/projects.rs       atomic JSON persistence + OS integration
```

Projects are stored as JSON in the host's user-data directory, written to a temp file
and renamed, so a crash mid-write cannot truncate the registry.

---

## Workflows

A workflow groups commands you have already saved and runs them behind one button.
Steps reference commands by id, so editing a command updates every workflow using it.

Each step picks a mode, because not every command finishes:

| Mode | For | Behaviour |
| --- | --- | --- |
| **Wait** | `git pull`, `npm install`, `npm run build` | Runs to completion. A non-zero exit stops the workflow and marks the rest skipped. |
| **Keep running** | `npm run dev`, `npm run start:dev` | Opens its own terminal tab and the workflow moves straight on. |

So Deploy is all *Wait*, Start All is all *Keep running*, and a mixed workflow can
pull, install, build, then start frontend and backend.

Wait-steps do **not** get a terminal tab. They spawn their own one-shot shell and the
runner waits on `pty://exit` for the real exit code; output is collected with ANSI
stripped and shown per step in the run log. That is deliberate — every ConPTY session
clears the screen when it starts, so sharing one xterm across sequential steps would
erase the previous step's output.

### Commands

A command has a name, a body and an optional **subfolder** relative to the project
root — so "Start frontend" is subfolder `frontend` plus `npm run dev`, with no `cd`.
The body may span several lines.

> On **PowerShell 5.1** — what ships with Windows — `&&` does not exist and is a
> parser error. Use `;` to always continue, or `cmd1; if ($?) { cmd2 }` to stop on
> failure. PowerShell 7 (`pwsh`) supports `&&`, and GeminiVillain prefers it when
> installed.

---

## Roadmap

Phases 1–4 are in place (§8 automation included) plus the connection half of Phase 6
(§10). Next: live process status for background steps, so a running dev server shows
as 🟢 and can be stopped from the project page; then Git (§9), then the server
dashboard (§11).

---

## Remote workflow steps

Each workflow step chooses **where** it runs: locally, or on one of your servers.

```
Ship
  1. Build here     Wait            Local
  2. Deploy there   Wait            ⇢ Prod
  3. Notify         Wait            Local
```

A remote step becomes `ssh <target> "<command>"`. That matters because
**`ssh host "cmd"` exits with the remote command's status**, so stop-on-failure works
across machines exactly as it does locally — if the deploy fails on production, the
rest of the workflow is skipped and the run log shows the remote exit code and
stderr. This is the thing a desktop terminal usually cannot do without a CI server.

Remote *Wait* steps run with `BatchMode=yes` and `ConnectTimeout=10`, so a host that
wants a password fails fast with a readable message instead of hanging on a prompt
nobody can see. If you do need to type a password, mark that step **Keep running** —
it opens a real terminal tab you can interact with.

Remote steps ignore the command's *Run in* folder, which is a local path. Put a
`cd /srv/app && …` in the command itself.

## Safety

- **Registry backups.** Every save first copies the previous `projects.json` /
  `servers.json` into a `backups/` folder beside it, keeping the last 8. There was no
  undo before, and that turned out to matter.
- **Closing a live tab asks first.** Closing a tab kills whatever is in it; if the
  process is still running you get a confirmation naming the tab.

---

## Status board

Workflows *change* things. Checks only *ask*. A project can define read-only checks,
each pointed at this PC or a server, and one **Refresh** runs them all at once:

```
NODE VERSION   This PC     FILES IN SRC   This PC     PROD COMMIT    ⇢ Prod
v24.11.0                   27                         a3f91c2
```

Green if the command succeeded, red if it did not — the tile shows the last line it
printed, which for a check is the answer: a branch name, a commit hash, a count, or
the error.

The question it exists to answer is **"does production actually have my latest
code?"** — put `git rev-parse --short HEAD` on both sides and compare the two tiles.
Other useful ones: `systemctl is-active nginx`, `pm2 pid api`, `df -h / | tail -1`.

Checks never run on their own. They only run when you press Refresh, because each
remote one opens an SSH connection.

---

## Themes

Dark by default; the title-bar toggle swaps to a warm-paper light theme. The choice
is remembered per machine.

The toggle is a plain sun and crescent in thin strokes, matching the minimise/maximise/close icons beside it — the pixel treatment belongs to the wordmark and the app icon, not to every glyph.

The swap is a ripple spreading from the toggle, done with the View Transitions API
so it animates the **real UI** rather than a coloured overlay wiping through a blank
screen. Under `prefers-reduced-motion` the theme just changes.

Everything is driven by CSS custom properties on `:root`, overridden under
`:root[data-theme="light"]` — so a new colour never needs to be added twice, as long
as it is a token. The terminal is the exception: xterm takes a palette object, so
`xtermTheme(name)` is reapplied to every open terminal when the theme changes.

### On the status readout

It is deliberately not a grid of cards with coloured borders. Checks answer
questions, and the honest shape for a set of question-and-answer pairs is an aligned
readout with dot leaders — the same idiom the run log uses, and the same one `df`,
`systemctl status` and every other terminal tool uses. Colour carries only failure;
alignment carries the rest.

---

## Is production running my code?

The question you actually have every day, and the one nothing else on your desktop
answers. Point a project at where it lives on each server:

```
Edit → Status → + Add deploy target
   Server: Prod        Path: /var/www/app
```

Then **Compare** on the project page:

```
Deployed   [Compare]   main · 2 uncommitted

  3 behind   Prod       /var/www/app
             3 commits behind you

  up to date Staging    /srv/app
             running your current commit
```

It asks each server one question — `git rev-parse HEAD` — and does the counting
locally with `git rev-list`. Nothing is written anywhere, and the server needs no
agent.

States it can report:

| | |
| --- | --- |
| **up to date** | that machine is on your exact commit |
| **N behind** | you have N commits it does not |
| **N ahead** | it has N commits you do not — someone else deployed |
| **diverged** | both, so a plain deploy will not reconcile them |
| **unknown commit** | it is on a commit this checkout has never seen |
| **error** | unreachable, or the path is not there |

The branch and uncommitted count sit next to the button, because "up to date" is
misleading if you have changes you never committed.

---

## Processes

A workflow's *Keep running* steps become terminal tabs, and the project page tracks
them:

```
Processes   [ Stop all (2) ]   2 running

  ● demo: Frontend   npm run dev              3m     [Stop]
  ● demo: Backend    npm run start:dev        3m     [Stop]
  ○ demo: Build      npm run build      exited 0     [Restart]
```

Click a row to jump to its terminal. Restart re-runs a finished process exactly as it
was first started, which is why the tab keeps its original command.

## Run history

Every finished workflow run is kept — newest first, sixty deep, persisted to
`runs.json`. Click one to see its steps, timings and exit codes.

```
✓ Boot      demo        just now · 1.9s
✗ Ship      wms         2h ago · 12.4s
```

## Command palette

`Ctrl+K` searches every project, command, workflow and server at once, plus a few
actions. Matching is subsequence-based, so `boot` finds *demo: Boot* and `wmsdev`
finds *wms: Dev*.

`Ctrl+/` lists every shortcut.

### Why the shortcuts listen in the capture phase

xterm owns the keyboard while a terminal is focused, and it treats `Ctrl+K` as a real
control character — it consumes the event and stops propagation, so a bubble-phase
window listener never sees it. App-level shortcuts are therefore bound with
`addEventListener('keydown', handler, true)` and call `stopPropagation()` on the ones
they claim.

`Escape` is the deliberate exception: it is only claimed when something is actually
open, so it still reaches vim or anything else running in a terminal.
