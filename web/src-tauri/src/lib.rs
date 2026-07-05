use base64::Engine;
use std::fs;
use std::path::Path;

/// Atomically write `bytes` to `path`: tempfile in the SAME directory + rename.
///
/// `std::fs` is NOT subject to the Tauri fs-plugin scope, so this reaches any
/// volume (e.g. `D:\`) — Tauri v2 does not auto-grant fs scope to native-dialog
/// results. Same-dir temp keeps the rename same-volume (atomic; on Windows
/// `std::fs::rename` = `MOVEFILE_REPLACE_EXISTING`, so it overwrites).
///
/// SECURITY POSTURE: the commands below are unrestricted FS read/write exposed to
/// the webview. That is only safe because (a) the app loads no remote content and
/// CSP is null, and (b) the sole imported-content → HTML-sink path (annotations →
/// Leaflet `bindPopup` in MapViewer) is escaped via `escapeHtml`. Any future change
/// that loads remote content, or renders imported/external content into an HTML
/// sink unescaped, turns a webview XSS into arbitrary local FS read+write —
/// revisit this seam before making either change.
fn atomic_write(path: &str, bytes: &[u8]) -> Result<(), String> {
    let target = Path::new(path);
    let dir = target
        .parent()
        .ok_or_else(|| "path has no parent directory".to_string())?;
    let name = target
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("export.bin");
    let tmp = dir.join(format!(".{name}.tmp"));
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, target).map_err(|e| {
        let _ = fs::remove_file(&tmp); // best-effort cleanup of the temp on failure
        e.to_string()
    })
}

/// Atomically write a UTF-8 text file (campaign JSON, logs, configs).
#[tauri::command]
fn write_text_atomic(path: String, contents: String) -> Result<(), String> {
    atomic_write(&path, contents.as_bytes())
}

/// Atomically write a binary file from standard-base64 `data` (e.g. a PNG
/// snapshot, whose dataURL payload is already base64 — no MB-sized number-array
/// IPC marshaling).
#[tauri::command]
fn write_bytes_b64(path: String, data: String) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|e| format!("invalid base64: {e}"))?;
    atomic_write(&path, &bytes)
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
        .invoke_handler(tauri::generate_handler![
            write_text_atomic,
            write_bytes_b64,
            read_text
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
