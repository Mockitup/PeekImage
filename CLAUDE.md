# PeekImage

A lightweight, single-file image viewer for Windows built with Rust.

## Architecture

- **Rust backend**: tao (window management) + wry (WebView2) + rfd (file dialogs) + image crate (decoding)
- **Frontend**: Vanilla HTML/CSS/JS embedded via `include_str!()`, rendered in WebView2
- **Rendering**: WebGL2 canvas with custom shaders for zoom/pan, transparency checkerboard, and HDR tone mapping
- **IPC**: JS→Rust via `window.ipc.postMessage(JSON)`, Rust→JS via `evaluate_script("window.__fromRust(...)")`

## Project Structure

```
src/
  main.rs           - Window creation, WebView setup, event loop, HTML assembly
  ipc.rs            - IPC message dispatch, image loading, clipboard ops
  image_decode.rs   - Format detection, decoding pipeline, HDR float packing
  file_ops.rs       - File dialog, folder browsing (sibling images)
  state.rs          - AppState struct (image bytes, metadata, HDR cache)
  window_state.rs   - Window position/size persistence
  frontend/
    index.html      - Shell with titlebar, viewport, statusbar
    style.css       - Catppuccin dark/light themes
    renderer.js     - WebGL2 renderer (texture upload, shaders, exposure)
    viewer.js       - Zoom/pan state, mouse interaction, fit/actual size
    app.js          - IPC bridge, keyboard shortcuts, UI wiring
```

## Key Conventions

- Custom titlebar with `decorations: false` — window controls are in HTML
- Web-native formats (PNG/JPG/GIF/WebP/BMP/ICO) pass raw bytes through to the browser
- Non-web formats (TIFF/TGA/PNM/QOI) are decoded via `image` crate and re-encoded as PNG
- HDR/EXR are decoded to Float32Array RGBA and uploaded as GL_RGBA32F textures
- Checker/black/white background modes cycle with `A` key
- Window state saved to `dirs::config_dir()/peekimage/`

## Build

```
cargo build --release
```

Binary lands at `target/release/peekimage.exe`. Optimized for size (~2 MB) via LTO, panic=abort, strip symbols.

## Image Pipeline

1. Rust reads file, detects format by extension
2. Web-native → raw bytes served via custom protocol `peekimage://`
3. Decoded formats → re-encoded to PNG bytes
4. HDR/EXR → packed as raw RGBA float32 array
5. JS fetches from `http://peekimage.localhost/image`
6. LDR → HTMLImageElement → WebGL texture (UNSIGNED_BYTE)
7. HDR → ArrayBuffer → Float32Array → WebGL texture (RGBA32F)
8. Fragment shader handles pan/scale transform, exposure, alpha compositing over background
