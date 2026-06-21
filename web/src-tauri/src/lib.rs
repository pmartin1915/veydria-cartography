use std::fs;
use std::path::Path;

/// Atomically write `contents` to `path` (tempfile in the same dir + rename).
///
/// Uses `std::fs`, which is NOT subject to the fs-plugin scope, so it can write
/// to a user-chosen dialog path on any volume (e.g. `D:\`). Tauri v2 does not
/// auto-grant fs-plugin scope to dialog results, so the campaign Save path needs
/// this. The tempfile stays in the same directory so the rename is same-volume
/// (atomic; `std::fs::rename` = `MOVEFILE_REPLACE_EXISTING` on Windows → overwrites).
///
/// SECURITY POSTURE: these commands are unrestricted FS read/write exposed to the
/// webview. That is only safe because (a) the app loads no remote content and
/// CSP is null, and (b) the sole imported-content → HTML-sink path (annotations →
/// Leaflet `bindPopup` in MapViewer) is escaped via `escapeHtml`. Any future change
/// that loads remote content, or renders imported/external content into an HTML
/// sink unescaped, turns a webview XSS into arbitrary local FS read+write —
/// revisit this seam before making either change.
#[tauri::command]
fn write_text_atomic(path: String, contents: String) -> Result<(), String> {
    let target = Path::new(&path);
    let dir = target
        .parent()
        .ok_or_else(|| "path has no parent directory".to_string())?;
    let name = target
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("campaign.json");
    let tmp = dir.join(format!(".{name}.tmp"));
    fs::write(&tmp, contents.as_bytes()).map_err(|e| e.to_string())?;
    fs::rename(&tmp, target).map_err(|e| {
        let _ = fs::remove_file(&tmp); // best-effort cleanup of the temp on failure
        e.to_string()
    })
}

/// Read a UTF-8 text file via `std::fs` (bypasses fs-plugin scope, same as above).
#[tauri::command]
fn read_text(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![write_text_atomic, read_text])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
