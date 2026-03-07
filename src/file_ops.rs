use rfd::FileDialog;
use std::path::{Path, PathBuf};

use crate::image_decode;

pub fn pick_open_image() -> Option<String> {
    let exts: Vec<&str> = image_decode::supported_extensions().to_vec();
    FileDialog::new()
        .add_filter("Images", &exts)
        .add_filter("All files", &["*"])
        .pick_file()
        .map(|p| p.to_string_lossy().to_string())
}

fn get_image_list(current_path: &str) -> Vec<PathBuf> {
    let path = Path::new(current_path);
    let dir = match path.parent() {
        Some(d) => d,
        None => return vec![path.to_path_buf()],
    };

    let extensions = image_decode::supported_extensions();

    let mut images: Vec<PathBuf> = match std::fs::read_dir(dir) {
        Ok(entries) => entries
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| {
                p.is_file()
                    && p.extension()
                        .and_then(|e| e.to_str())
                        .map(|e| {
                            let lower = e.to_lowercase();
                            extensions.iter().any(|&s| s == lower)
                        })
                        .unwrap_or(false)
            })
            .collect(),
        Err(_) => return vec![path.to_path_buf()],
    };

    images.sort_by(|a, b| {
        a.file_name()
            .unwrap_or_default()
            .to_ascii_lowercase()
            .cmp(&b.file_name().unwrap_or_default().to_ascii_lowercase())
    });

    images
}

fn find_index(images: &[PathBuf], current_path: &str) -> Option<usize> {
    let current = Path::new(current_path);
    images.iter().position(|p| p == current)
}

pub fn get_sibling_image(current_path: &str, direction: i32) -> Option<(String, usize, usize)> {
    let images = get_image_list(current_path);
    let current_idx = find_index(&images, current_path)?;
    let new_idx = if direction > 0 {
        (current_idx + 1) % images.len()
    } else {
        (current_idx + images.len() - 1) % images.len()
    };

    Some((
        images[new_idx].to_string_lossy().to_string(),
        new_idx + 1,
        images.len(),
    ))
}

pub fn get_image_position(current_path: &str) -> (usize, usize) {
    let images = get_image_list(current_path);
    let idx = find_index(&images, current_path).unwrap_or(0);
    (idx + 1, images.len())
}
