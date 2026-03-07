use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use std::path::Path;

pub struct ImageInfo {
    pub data_uri: String,
    pub width: u32,
    pub height: u32,
    pub file_size: u64,
    pub format: String,
}

const MAX_DIMENSION: u32 = 8192;

const WEB_NATIVE: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico"];

pub fn load_image(path: &str) -> Result<ImageInfo, String> {
    let p = Path::new(path);
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let file_size = std::fs::metadata(path)
        .map(|m| m.len())
        .map_err(|e| format!("Cannot read file: {}", e))?;

    if ext == "svg" {
        return load_svg(path, file_size);
    }

    if WEB_NATIVE.contains(&ext.as_str()) {
        load_web_native(path, &ext, file_size)
    } else {
        load_decoded(path, &ext, file_size)
    }
}

fn load_svg(path: &str, file_size: u64) -> Result<ImageInfo, String> {
    let content =
        std::fs::read_to_string(path).map_err(|e| format!("Cannot read SVG: {}", e))?;

    let (width, height) = parse_svg_dimensions(&content);

    let b64 = STANDARD.encode(content.as_bytes());
    let data_uri = format!("data:image/svg+xml;base64,{}", b64);

    Ok(ImageInfo {
        data_uri,
        width,
        height,
        file_size,
        format: "SVG".to_string(),
    })
}

fn parse_svg_dimensions(svg: &str) -> (u32, u32) {
    let get_attr = |name: &str| -> Option<f64> {
        let search = format!("{}=\"", name);
        svg.find(&search).and_then(|pos| {
            let start = pos + search.len();
            let end = svg[start..].find('"').map(|e| start + e)?;
            svg[start..end]
                .trim_end_matches("px")
                .parse::<f64>()
                .ok()
        })
    };

    if let (Some(w), Some(h)) = (get_attr("width"), get_attr("height")) {
        return (w as u32, h as u32);
    }

    if let Some(pos) = svg.find("viewBox=\"") {
        let start = pos + 9;
        if let Some(end) = svg[start..].find('"') {
            let parts: Vec<f64> = svg[start..start + end]
                .split_whitespace()
                .filter_map(|s| s.parse().ok())
                .collect();
            if parts.len() == 4 {
                return (parts[2] as u32, parts[3] as u32);
            }
        }
    }

    (0, 0)
}

fn load_web_native(path: &str, ext: &str, file_size: u64) -> Result<ImageInfo, String> {
    let data = std::fs::read(path).map_err(|e| format!("Cannot read file: {}", e))?;

    let mime = match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    };

    let (width, height) = image::image_dimensions(path)
        .map_err(|e| format!("Cannot read dimensions: {}", e))?;

    let b64 = STANDARD.encode(&data);
    let data_uri = format!("data:{};base64,{}", mime, b64);

    let format = match ext {
        "png" => "PNG",
        "jpg" | "jpeg" => "JPEG",
        "gif" => "GIF",
        "webp" => "WebP",
        "bmp" => "BMP",
        "ico" => "ICO",
        _ => "Image",
    }
    .to_string();

    Ok(ImageInfo {
        data_uri,
        width,
        height,
        file_size,
        format,
    })
}

fn load_decoded(path: &str, ext: &str, file_size: u64) -> Result<ImageInfo, String> {
    let data = std::fs::read(path).map_err(|e| format!("Cannot read file: {}", e))?;

    let img =
        image::load_from_memory(&data).map_err(|e| format!("Cannot decode image: {}", e))?;

    let (width, height) = (img.width(), img.height());

    let img = if width > MAX_DIMENSION || height > MAX_DIMENSION {
        img.resize(
            MAX_DIMENSION,
            MAX_DIMENSION,
            image::imageops::FilterType::Lanczos3,
        )
    } else {
        img
    };

    let mut buf = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut buf);
    img.write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|e| format!("Cannot encode image: {}", e))?;

    let b64 = STANDARD.encode(&buf);
    let data_uri = format!("data:image/png;base64,{}", b64);

    let format = match ext {
        "tiff" | "tif" => "TIFF",
        "tga" => "TGA",
        "pnm" | "pbm" | "pgm" | "ppm" | "pam" => "PNM",
        "qoi" => "QOI",
        "hdr" => "HDR",
        "dds" => "DDS",
        _ => "Image",
    }
    .to_string();

    Ok(ImageInfo {
        data_uri,
        width,
        height,
        file_size,
        format,
    })
}

pub fn supported_extensions() -> &'static [&'static str] {
    &[
        "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg", "tiff", "tif", "tga", "pnm",
        "pbm", "pgm", "ppm", "pam", "qoi", "hdr",
    ]
}
