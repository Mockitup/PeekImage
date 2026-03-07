use base64::Engine;
use serde::Deserialize;
use std::sync::{Arc, Mutex};
use tao::window::Window;
use wry::WebView;

use crate::file_ops;
use crate::image_decode;
use crate::state::AppState;

#[derive(Deserialize)]
struct IpcMessage {
    command: String,
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    title: Option<String>,
}

pub fn handle_ipc_message(
    msg: &str,
    webview: &WebView,
    window: &Window,
    _state: &Arc<Mutex<AppState>>,
) {
    let parsed: IpcMessage = match serde_json::from_str(msg) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("IPC parse error: {e}");
            return;
        }
    };

    match parsed.command.as_str() {
        "open_image" => {
            let path = parsed.path.or_else(file_ops::pick_open_image);
            if let Some(p) = path {
                load_and_send_image(webview, &p);
            } else {
                send_loading_done(webview);
            }
        }
        "next_image" => {
            if let Some(ref current) = parsed.path {
                if let Some((next, idx, total)) = file_ops::get_sibling_image(current, 1) {
                    load_and_send_image_with_pos(webview, &next, idx, total);
                } else {
                    send_loading_done(webview);
                }
            } else {
                send_loading_done(webview);
            }
        }
        "prev_image" => {
            if let Some(ref current) = parsed.path {
                if let Some((prev, idx, total)) = file_ops::get_sibling_image(current, -1) {
                    load_and_send_image_with_pos(webview, &prev, idx, total);
                } else {
                    send_loading_done(webview);
                }
            } else {
                send_loading_done(webview);
            }
        }
        "set_title" => {
            if let Some(title) = parsed.title {
                window.set_title(&title);
            }
        }
        "window_minimize" => window.set_minimized(true),
        "window_maximize" => window.set_maximized(!window.is_maximized()),
        "window_close" => {
            let inner_size = window.inner_size();
            let outer_pos = window.outer_position().unwrap_or_default();
            crate::window_state::save_window_state(
                (outer_pos.x, outer_pos.y),
                (inner_size.width, inner_size.height),
            );
            std::process::exit(0);
        }
        "drag_enter" => {
            let _ = webview.evaluate_script(
                "document.getElementById('drop-overlay').classList.add('visible')",
            );
        }
        "drag_leave" => {
            let _ = webview.evaluate_script(
                "document.getElementById('drop-overlay').classList.remove('visible')",
            );
        }
        "copy_image" => {
            if let Some(ref path) = parsed.path {
                match copy_image_to_clipboard(path) {
                    Ok(_) => send_to_js(
                        webview,
                        "copied",
                        &serde_json::json!({}),
                    ),
                    Err(e) => send_to_js(
                        webview,
                        "error",
                        &serde_json::json!({"message": e}),
                    ),
                }
            }
        }
        "paste_image" => match paste_image_from_clipboard() {
            Ok((data_uri, width, height, size)) => {
                send_to_js(
                    webview,
                    "image_loaded",
                    &serde_json::json!({
                        "path": "",
                        "data_uri": data_uri,
                        "width": width,
                        "height": height,
                        "file_size": size,
                        "format": "Clipboard",
                        "filename": "Clipboard",
                        "index": 0,
                        "total": 0,
                    }),
                );
            }
            Err(e) => send_to_js(
                webview,
                "error",
                &serde_json::json!({"message": e}),
            ),
        },
        "ready" => {}
        _ => eprintln!("Unknown IPC command: {}", parsed.command),
    }
}

fn load_and_send_image_with_pos(webview: &WebView, path: &str, index: usize, total: usize) {
    match image_decode::load_image(path) {
        Ok(info) => {
            let filename = std::path::Path::new(path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("Unknown");

            send_to_js(
                webview,
                "image_loaded",
                &serde_json::json!({
                    "path": path,
                    "data_uri": info.data_uri,
                    "width": info.width,
                    "height": info.height,
                    "file_size": info.file_size,
                    "format": info.format,
                    "filename": filename,
                    "index": index,
                    "total": total,
                }),
            );
        }
        Err(e) => {
            send_to_js(
                webview,
                "error",
                &serde_json::json!({
                    "message": e
                }),
            );
        }
    }
}

fn load_and_send_image(webview: &WebView, path: &str) {
    match image_decode::load_image(path) {
        Ok(info) => {
            let (index, total) = file_ops::get_image_position(path);
            let filename = std::path::Path::new(path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("Unknown");

            send_to_js(
                webview,
                "image_loaded",
                &serde_json::json!({
                    "path": path,
                    "data_uri": info.data_uri,
                    "width": info.width,
                    "height": info.height,
                    "file_size": info.file_size,
                    "format": info.format,
                    "filename": filename,
                    "index": index,
                    "total": total,
                }),
            );
        }
        Err(e) => {
            send_to_js(
                webview,
                "error",
                &serde_json::json!({
                    "message": e
                }),
            );
        }
    }
}

fn copy_image_to_clipboard(path: &str) -> Result<(), String> {
    let img = image::open(path).map_err(|e| format!("Cannot open image: {}", e))?;
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| format!("Clipboard error: {}", e))?;
    clipboard
        .set_image(arboard::ImageData {
            width: w as usize,
            height: h as usize,
            bytes: rgba.into_raw().into(),
        })
        .map_err(|e| format!("Clipboard error: {}", e))
}

fn paste_image_from_clipboard() -> Result<(String, u32, u32, u64), String> {
    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| format!("Clipboard error: {}", e))?;
    let img_data = clipboard
        .get_image()
        .map_err(|_| "No image on clipboard".to_string())?;
    let w = img_data.width as u32;
    let h = img_data.height as u32;

    let img_buf: image::RgbaImage = image::RgbaImage::from_raw(w, h, img_data.bytes.into_owned())
        .ok_or("Invalid clipboard image data".to_string())?;

    let mut buf = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut buf);
    image::DynamicImage::ImageRgba8(img_buf)
        .write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|e| format!("Cannot encode image: {}", e))?;

    let size = buf.len() as u64;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&buf);
    let data_uri = format!("data:image/png;base64,{}", b64);

    Ok((data_uri, w, h, size))
}

fn send_loading_done(webview: &WebView) {
    send_to_js(webview, "loading_done", &serde_json::json!({}));
}

fn send_to_js(webview: &WebView, event: &str, data: &serde_json::Value) {
    let script = format!(
        "window.__fromRust({}, {})",
        serde_json::to_string(event).unwrap(),
        serde_json::to_string(data).unwrap(),
    );
    let _ = webview.evaluate_script(&script);
}
