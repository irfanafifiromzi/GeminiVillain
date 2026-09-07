mod projects;
mod pty;

use std::sync::Arc;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::new(pty::PtyManager::default()))
        .invoke_handler(tauri::generate_handler![
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            projects::projects_load,
            projects::projects_save,
            projects::servers_load,
            projects::servers_save,
            projects::runs_load,
            projects::runs_save,
            projects::path_exists,
            projects::has_ssh,
            projects::open_folder,
            projects::open_in_vscode,
        ])
        .run(tauri::generate_context!())
        .expect("error while running GeminiVillain");
}
