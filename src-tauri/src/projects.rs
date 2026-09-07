//! Registry persistence and OS integration.
//!
//! Projects and servers are stored as JSON files in the app config directory.
//! The frontend owns the shape; Rust only reads and writes the document.

use std::path::PathBuf;
use std::process::Command;

use serde_json::Value;
use tauri::{AppHandle, Manager};

fn store_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no config directory: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(name))
}

fn read_store(app: &AppHandle, name: &str) -> Result<Value, String> {
    let path = store_path(app, name)?;
    if !path.exists() {
        return Ok(Value::Array(vec![]));
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    if raw.trim().is_empty() {
        return Ok(Value::Array(vec![]));
    }
    serde_json::from_str(&raw).map_err(|e| format!("{name} is corrupt: {e}"))
}

fn write_store(app: &AppHandle, name: &str, value: &Value) -> Result<(), String> {
    let path = store_path(app, name)?;
    let body = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    // Write to a temp file first so a crash mid-write cannot truncate the registry.
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, body).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn projects_load(app: AppHandle) -> Result<Value, String> {
    read_store(&app, "projects.json")
}

#[tauri::command]
pub fn projects_save(app: AppHandle, projects: Value) -> Result<(), String> {
    write_store(&app, "projects.json", &projects)
}

#[tauri::command]
pub fn servers_load(app: AppHandle) -> Result<Value, String> {
    read_store(&app, "servers.json")
}

#[tauri::command]
pub fn servers_save(app: AppHandle, servers: Value) -> Result<(), String> {
    write_store(&app, "servers.json", &servers)
}

#[tauri::command]
pub fn runs_load(app: AppHandle) -> Result<Value, String> {
    read_store(&app, "runs.json")
}

#[tauri::command]
pub fn runs_save(app: AppHandle, runs: Value) -> Result<(), String> {
    write_store(&app, "runs.json", &runs)
}

/// True when the path still exists on disk, so the UI can flag stale entries.
#[tauri::command]
pub fn path_exists(path: String) -> bool {
    std::path::Path::new(&path).is_dir()
}

fn which_exists(exe: &str) -> bool {
    let Ok(path) = std::env::var("PATH") else {
        return false;
    };
    std::env::split_paths(&path).any(|dir| dir.join(exe).is_file())
}

/// Reports whether the OpenSSH client is available, so the UI can warn early.
#[tauri::command]
pub fn has_ssh() -> bool {
    which_exists("ssh.exe") || which_exists("ssh")
}

#[tauri::command]
pub fn open_folder(path: String) -> Result<(), String> {
    if !std::path::Path::new(&path).exists() {
        return Err(format!("{path} does not exist"));
    }
    #[cfg(windows)]
    let result = Command::new("explorer").arg(&path).spawn();
    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(&path).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = Command::new("xdg-open").arg(&path).spawn();

    // explorer.exe returns a non-zero code even on success, so only the
    // spawn failure is worth reporting.
    result.map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_in_vscode(path: String) -> Result<(), String> {
    if !std::path::Path::new(&path).exists() {
        return Err(format!("{path} does not exist"));
    }

    // `code` on Windows is a .cmd shim, which CreateProcess cannot launch
    // directly, so route it through cmd.exe.
    #[cfg(windows)]
    let result = Command::new("cmd").args(["/C", "code"]).arg(&path).spawn();
    #[cfg(not(windows))]
    let result = Command::new("code").arg(&path).spawn();

    result
        .map(|_| ())
        .map_err(|e| format!("could not launch VS Code: {e}"))
}
