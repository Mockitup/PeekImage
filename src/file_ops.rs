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

fn scan_image_list(dir: &Path) -> Vec<PathBuf> {
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
        Err(_) => return vec![],
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

/// Get the image list for the directory containing `current_path`.
/// If `cache` is Some and the directory matches, reuse it; otherwise scan fresh.
pub fn get_image_list_cached(
    current_path: &str,
    cache: Option<&(PathBuf, Vec<PathBuf>)>,
) -> (PathBuf, Vec<PathBuf>) {
    let path = Path::new(current_path);
    let dir = path.parent().unwrap_or(path).to_path_buf();

    if let Some((cached_dir, cached_list)) = cache {
        if *cached_dir == dir {
            return (dir, cached_list.clone());
        }
    }

    let list = scan_image_list(&dir);
    (dir, list)
}

pub fn get_sibling_image_cached(
    current_path: &str,
    direction: i32,
    cache: Option<&(PathBuf, Vec<PathBuf>)>,
) -> Option<(String, usize, usize, PathBuf, Vec<PathBuf>)> {
    let (dir, images) = get_image_list_cached(current_path, cache);
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
        dir,
        images,
    ))
}

pub fn get_image_position_cached(
    current_path: &str,
    cache: Option<&(PathBuf, Vec<PathBuf>)>,
) -> (usize, usize, PathBuf, Vec<PathBuf>) {
    let (dir, images) = get_image_list_cached(current_path, cache);
    let idx = find_index(&images, current_path).unwrap_or(0);
    (idx + 1, images.len(), dir, images)
}
