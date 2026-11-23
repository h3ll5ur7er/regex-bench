//! The desktop shell (docs/Architecture.md, client "Desktop Shell"). It hosts the same build of the Workbench UI
//! and contains no business logic: no commands are exposed to the webview, and no plugins are loaded, so the
//! webview can't reach the file system or the network through Tauri (docs/Architecture/STRIDE.md, H23).

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running regex-bench");
}
