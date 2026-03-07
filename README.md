# PeekImage

A fast, lightweight image viewer for Windows. Single binary, ~2 MB, starts instantly.

Built with Rust + WebView2. No Electron, no framework bloat.

![Viewing a JPEG with folder navigation](Screenshot%201.jpg)

![PNG with transparency over checker background](Screenshot%202.jpg)

![HDR panorama with exposure control](Screenshot%203.jpg)

## Features

- **Wide format support** — PNG, JPEG, GIF, WebP, SVG, BMP, ICO, TIFF, TGA, PNM, QOI, HDR, EXR
- **HDR/EXR viewing** — Float32 rendering with exposure slider (EV -10 to +10)
- **Zoom & pan** — Scroll to zoom at cursor, drag to pan, fit-to-window / actual-size toggle
- **Pixel inspection** — Hover to see RGBA values, hex code, and color swatch in the status bar
- **Folder browsing** — Arrow keys to step through images in the same directory
- **Transparency** — Checkerboard, black, or white background (cycle with `A`)
- **Clipboard** — Copy (`Ctrl+C`) and paste (`Ctrl+V`) images directly
- **Drag & drop** — Drop a file onto the window to open it
- **Dark / light theme** — Catppuccin-based, toggle with the theme button
- **Window state** — Remembers position and size across sessions

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+O` | Open file |
| `Ctrl+C` | Copy image to clipboard |
| `Ctrl+V` | Paste image from clipboard |
| `←` / `→` | Previous / next image in folder |
| `F` | Fit to window |
| `Ctrl+1` | Actual size (1:1) |
| `Ctrl++` / `Ctrl+-` | Zoom in / out |
| `A` | Cycle background (checker → black → white) |
| `E` | Reset HDR exposure to 0 |
| Double-click | Toggle fit / actual size |

## Building

Requires Rust and the Windows SDK (for WebView2).

```
cargo build --release
```

The binary is at `target/release/peekimage.exe`.

## Usage

```
peekimage.exe [path-to-image]
```

Or just double-click the binary and use `Ctrl+O` / drag & drop.

## License

MIT
