use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use std::path::Path;

pub struct ImageInfo {
    pub data_uri: String,
    pub width: u32,
    pub height: u32,
    pub file_size: u64,
    pub format: String,
    pub is_hdr: bool,
}

const MAX_DIMENSION: u32 = 8192;

const WEB_NATIVE: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico"];

pub fn is_hdr_format(ext: &str) -> bool {
    matches!(ext, "hdr" | "exr")
}

pub fn load_image(path: &str) -> Result<(ImageInfo, Option<image::DynamicImage>), String> {
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
        return load_svg(path, file_size).map(|info| (info, None));
    }

    if WEB_NATIVE.contains(&ext.as_str()) {
        load_web_native(path, &ext, file_size).map(|info| (info, None))
    } else {
        load_decoded(path, &ext, file_size)
    }
}

pub fn apply_exposure(
    img: &image::DynamicImage,
    exposure: f32,
    max_dim: u32,
) -> Result<(String, u32, u32), String> {
    let rgb = img.to_rgb32f();
    let (orig_w, orig_h) = (rgb.width(), rgb.height());
    let multiplier = 2.0f32.powf(exposure);

    let mut rgba = image::RgbaImage::new(orig_w, orig_h);
    for (x, y, pixel) in rgb.enumerate_pixels() {
        let r = (pixel[0] * multiplier).clamp(0.0, 1.0);
        let g = (pixel[1] * multiplier).clamp(0.0, 1.0);
        let b = (pixel[2] * multiplier).clamp(0.0, 1.0);
        rgba.put_pixel(
            x,
            y,
            image::Rgba([
                (r * 255.0 + 0.5) as u8,
                (g * 255.0 + 0.5) as u8,
                (b * 255.0 + 0.5) as u8,
                255,
            ]),
        );
    }

    let mut dyn_img = image::DynamicImage::ImageRgba8(rgba);
    if orig_w > max_dim || orig_h > max_dim {
        dyn_img = dyn_img.resize(max_dim, max_dim, image::imageops::FilterType::Lanczos3);
    }
    let (w, h) = (dyn_img.width(), dyn_img.height());

    let mut buf = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut buf);
    dyn_img
        .write_to(&mut cursor, image::ImageFormat::Jpeg)
        .map_err(|e| format!("Cannot encode image: {}", e))?;

    let b64 = STANDARD.encode(&buf);
    let data_uri = format!("data:image/jpeg;base64,{}", b64);

    Ok((data_uri, w, h))
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
        is_hdr: false,
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
        is_hdr: false,
    })
}

fn load_decoded(
    path: &str,
    ext: &str,
    file_size: u64,
) -> Result<(ImageInfo, Option<image::DynamicImage>), String> {
    let data = std::fs::read(path).map_err(|e| format!("Cannot read file: {}", e))?;

    let img =
        image::load_from_memory(&data).map_err(|e| format!("Cannot decode image: {}", e))?;

    let (width, height) = (img.width(), img.height());
    let is_hdr = is_hdr_format(ext);

    let (data_uri, disp_w, disp_h) = if is_hdr {
        apply_exposure(&img, 0.0, MAX_DIMENSION)?
    } else {
        let rgba = image::DynamicImage::ImageRgba8(img.to_rgba8());
        let rgba = if width > MAX_DIMENSION || height > MAX_DIMENSION {
            rgba.resize(MAX_DIMENSION, MAX_DIMENSION, image::imageops::FilterType::Lanczos3)
        } else {
            rgba
        };
        let (dw, dh) = (rgba.width(), rgba.height());

        let mut buf = Vec::new();
        let mut cursor = std::io::Cursor::new(&mut buf);
        rgba.write_to(&mut cursor, image::ImageFormat::Png)
            .map_err(|e| format!("Cannot encode image: {}", e))?;

        let b64 = STANDARD.encode(&buf);
        (format!("data:image/png;base64,{}", b64), dw, dh)
    };

    let format = match ext {
        "tiff" | "tif" => "TIFF",
        "tga" => "TGA",
        "pnm" | "pbm" | "pgm" | "ppm" | "pam" => "PNM",
        "qoi" => "QOI",
        "hdr" => "HDR",
        "exr" => "EXR",
        _ => "Image",
    }
    .to_string();

    let hdr_cache = if is_hdr { Some(img) } else { None };

    Ok((
        ImageInfo {
            data_uri,
            width: disp_w,
            height: disp_h,
            file_size,
            format,
            is_hdr,
        },
        hdr_cache,
    ))
}

pub fn supported_extensions() -> &'static [&'static str] {
    &[
        "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg", "tiff", "tif", "tga", "pnm",
        "pbm", "pgm", "ppm", "pam", "qoi", "hdr", "exr",
    ]
}
