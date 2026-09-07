//! ConPTY-backed terminal sessions.
//!
//! GeminiVillain does not implement a shell. It spawns the real one
//! (PowerShell, cmd, bash) behind a pseudo-terminal and pipes the bytes
//! to xterm.js in the webview.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

/// One live shell. The master handle drives resize, the writer drives stdin.
struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyManager {
    sessions: Mutex<HashMap<String, Session>>,
}

#[derive(Clone, Serialize)]
struct OutputEvent {
    id: String,
    /// base64 so that multi-byte UTF-8 split across reads survives the trip.
    data: String,
}

#[derive(Clone, Serialize)]
struct ExitEvent {
    id: String,
    code: Option<u32>,
}

#[derive(Serialize)]
pub struct SpawnResult {
    pub id: String,
    pub shell: String,
    pub cwd: String,
}

/// Resolve the shell to launch. `None` picks the best default for the OS.
fn resolve_shell(requested: Option<String>) -> String {
    if let Some(s) = requested {
        let name = s.trim();
        if !name.is_empty() {
            // CreateProcess does no PATHEXT lookup, so a bare `ssh` fails on
            // Windows where `ssh.exe` would work.
            if cfg!(windows)
                && !std::path::Path::new(name).extension().is_some()
                && which_exists(&format!("{name}.exe"))
            {
                return format!("{name}.exe");
            }
            return name.to_string();
        }
    }
    if cfg!(windows) {
        // Prefer PowerShell 7 when present, else Windows PowerShell.
        if which_exists("pwsh.exe") {
            "pwsh.exe".to_string()
        } else {
            "powershell.exe".to_string()
        }
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    }
}

/// GeminiVillain draws its own wordmark, so suppress the shell's.
fn default_args(shell: &str) -> Vec<String> {
    let exe = std::path::Path::new(shell)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(shell)
        .to_ascii_lowercase();

    if exe == "powershell.exe" || exe == "pwsh.exe" {
        vec!["-NoLogo".to_string()]
    } else {
        Vec::new()
    }
}

fn which_exists(exe: &str) -> bool {
    let Ok(path) = std::env::var("PATH") else {
        return false;
    };
    std::env::split_paths(&path).any(|dir| dir.join(exe).is_file())
}

/// Fall back to the user's home directory when the requested cwd is gone,
/// so a deleted project folder can never stop a terminal from opening.
fn resolve_cwd(requested: Option<String>) -> String {
    let candidate = requested.filter(|c| !c.trim().is_empty());
    if let Some(c) = candidate {
        if std::path::Path::new(&c).is_dir() {
            return c;
        }
    }
    dirs_home().unwrap_or_else(|| ".".to_string())
}

fn dirs_home() -> Option<String> {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()
}

#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    manager: State<'_, Arc<PtyManager>>,
    // Chosen by the frontend so its output listener is filtering on the
    // right id before the reader thread emits a single byte.
    id: String,
    shell: Option<String>,
    args: Option<Vec<String>>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<SpawnResult, String> {
    let shell = resolve_shell(shell);
    let cwd = resolve_cwd(cwd);

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("failed to open pty: {e}"))?;

    let mut cmd = CommandBuilder::new(&shell);
    let args = args
        .filter(|a| !a.is_empty())
        .unwrap_or_else(|| default_args(&shell));
    for arg in args {
        cmd.arg(arg);
    }
    cmd.cwd(&cwd);
    // Programs probe these to decide whether to emit colour.
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("GEMINIVILLAIN", "1");

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("failed to start `{shell}`: {e}"))?;
    // Dropping the slave lets the pty close cleanly once the child exits.
    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("failed to read from pty: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("failed to write to pty: {e}"))?;

    manager.sessions.lock().unwrap().insert(
        id.clone(),
        Session {
            master: pair.master,
            writer,
            child,
        },
    );

    // `inner()` avoids relying on deref coercion through `State` for the clone.
    spawn_reader(app, manager.inner().clone(), id.clone(), reader);

    Ok(SpawnResult { id, shell, cwd })
}

/// Pump pty output to the webview until EOF, then report the exit code.
fn spawn_reader(
    app: AppHandle,
    manager: Arc<PtyManager>,
    id: String,
    mut reader: Box<dyn Read + Send>,
) {
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let payload = OutputEvent {
                        id: id.clone(),
                        data: B64.encode(&buf[..n]),
                    };
                    if app.emit("pty://output", payload).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }

        // Reap the child so the exit code is accurate, then drop the session.
        let code = {
            let mut sessions = manager.sessions.lock().unwrap();
            sessions
                .remove(&id)
                .and_then(|mut s| s.child.wait().ok())
                .map(|status| status.exit_code())
        };

        let _ = app.emit("pty://exit", ExitEvent { id, code });
    });
}

#[tauri::command]
pub fn pty_write(
    manager: State<'_, Arc<PtyManager>>,
    id: String,
    data: String,
) -> Result<(), String> {
    let mut sessions = manager.sessions.lock().unwrap();
    let session = sessions
        .get_mut(&id)
        .ok_or_else(|| format!("terminal {id} is no longer running"))?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    session.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(
    manager: State<'_, Arc<PtyManager>>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = manager.sessions.lock().unwrap();
    let Some(session) = sessions.get(&id) else {
        // A resize racing a closed tab is normal, not an error.
        return Ok(());
    };
    session
        .master
        .resize(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_kill(manager: State<'_, Arc<PtyManager>>, id: String) -> Result<(), String> {
    let mut sessions = manager.sessions.lock().unwrap();
    if let Some(session) = sessions.get_mut(&id) {
        let _ = session.child.kill();
    }
    Ok(())
}
