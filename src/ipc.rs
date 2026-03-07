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
    #[serde(default)]
    exposure: Option<f32>,
}

pub fn handle_ipc_message(
    msg: &str,
    webview: &WebView,
    window: &Window,
    state: &Arc<Mutex<AppState>>,
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
                load_and_send_image(webview, &p, state);
            } else {
                send_loading_done(webview);
            }
        }
        "next_image" => {
            if let Some(ref current) = parsed.path {
                if let Some((next, idx, total)) = file_ops::get_sibling_image(current, 1) {
                    load_and_send_image_with_pos(webview, &next, idx, total, state);
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
                    load_and_send_image_with_pos(webview, &prev, idx, total, state);
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
                let ev = parsed.exposure.unwrap_or(0.0);
                match copy_image_to_clipboard(path, ev, state) {
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
        "paste_image" => {
            match paste_image_from_clipboard(state) {
                Ok((w, h, size)) => {
                    send_to_js(
                        webview,
                        "image_ready",
                        &serde_json::json!({
                            "path": "",
                            "width": w,
                            "height": h,
                            "file_size": size,
                            "format": "Clipboard",
                            "filename": "Clipboard",
                            "index": 0,
                            "total": 0,
                            "is_hdr": false,
                        }),
                    );
                }
                Err(e) => send_to_js(
                    webview,
                    "error",
                    &serde_json::json!({"message": e}),
                ),
            }
        }
        "ready" => {}
        _ => eprintln!("Unknown IPC command: {}", parsed.command),
    }
}

fn load_and_send_image_with_pos(
    webview: &WebView,
    path: &str,
    index: usize,
    total: usize,
    state: &Arc<Mutex<AppState>>,
) {
    match image_decode::load_image(path) {
        Ok((data, hdr_cache)) => {
            {
                let mut st = state.lock().unwrap();
                st.hdr_image = hdr_cache;
                st.hdr_path = if data.is_hdr {
                    Some(path.to_string())
                } else {
                    None
                };
                st.image_width = data.width;
                st.image_height = data.height;
                st.image_is_hdr = data.is_hdr;
                st.image_content_type = data.content_type;
                st.image_bytes = Some(data.raw_bytes);
            }

            let filename = std::path::Path::new(path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("Unknown");

            send_to_js(
                webview,
                "image_ready",
                &serde_json::json!({
                    "path": path,
                    "width": data.width,
                    "height": data.height,
                    "file_size": data.file_size,
                    "format": data.format,
                    "filename": filename,
                    "index": index,
                    "total": total,
                    "is_hdr": data.is_hdr,
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

fn load_and_send_image(webview: &WebView, path: &str, state: &Arc<Mutex<AppState>>) {
    match image_decode::load_image(path) {
        Ok((data, hdr_cache)) => {
            let width = data.width;
            let height = data.height;
            let file_size = data.file_size;
            let format = data.format.clone();
            let is_hdr = data.is_hdr;
            {
                let mut st = state.lock().unwrap();
                st.hdr_image = hdr_cache;
                st.hdr_path = if is_hdr {
                    Some(path.to_string())
                } else {
                    None
                };
                st.image_width = width;
                st.image_height = height;
                st.image_is_hdr = is_hdr;
                st.image_content_type = data.content_type;
                st.image_bytes = Some(data.raw_bytes);
            }

            let (index, total) = file_ops::get_image_position(path);
            let filename = std::path::Path::new(path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("Unknown");

            send_to_js(
                webview,
                "image_ready",
                &serde_json::json!({
                    "path": path,
                    "width": width,
                    "height": height,
                    "file_size": file_size,
                    "format": format,
                    "filename": filename,
                    "index": index,
                    "total": total,
                    "is_hdr": is_hdr,
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

fn copy_image_to_clipboard(path: &str, exposure: f32, state: &Arc<Mutex<AppState>>) -> Result<(), String> {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if ext == "svg" {
        return Err("Cannot copy SVG to clipboard as image".to_string());
    }

    let is_hdr = image_decode::is_hdr_format(&ext);
    if is_hdr && exposure != 0.0 {
        let st = state.lock().unwrap();
        if let Some(ref img) = st.hdr_image {
            let rgba = image_decode::apply_exposure(img, exposure)?;
            let (w, h) = (rgba.width(), rgba.height());
            let mut clipboard =
                arboard::Clipboard::new().map_err(|e| format!("Clipboard error: {}", e))?;
            clipboard
                .set_image(arboard::ImageData {
                    width: w as usize,
                    height: h as usize,
                    bytes: rgba.into_raw().into(),
                })
                .map_err(|e| format!("Clipboard error: {}", e))?;
            return Ok(());
        }
    }

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

fn paste_image_from_clipboard(state: &Arc<Mutex<AppState>>) -> Result<(u32, u32, u64), String> {
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

    {
        let mut st = state.lock().unwrap();
        st.hdr_image = None;
        st.hdr_path = None;
        st.image_width = w;
        st.image_height = h;
        st.image_is_hdr = false;
        st.image_content_type = "image/png".to_string();
        st.image_bytes = Some(buf);
    }

    Ok((w, h, size))
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
