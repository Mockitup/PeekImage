use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Serialize, Clone, Debug)]
pub struct ExrLayerInfo {
    pub name: String,
    pub display_name: String,
    pub channels: Vec<String>,
    pub layer_type: String,
}

#[derive(Clone, Debug)]
pub struct ExrMetadata {
    pub width: u32,
    pub height: u32,
    pub layers: Vec<ExrLayerInfo>,
}

/// Parse EXR metadata (channel list) without decoding pixel data.
/// Supports both single-part (channel name prefixes) and multi-part (separate headers) EXR files.
pub fn parse_exr_metadata(path: &str) -> Result<ExrMetadata, String> {
    let meta = exr::meta::MetaData::read_from_file(path, false)
        .map_err(|e| format!("Cannot read EXR metadata: {}", e))?;

    let first_header = meta.headers.first()
        .ok_or_else(|| "EXR file has no headers".to_string())?;

    let size = first_header.shared_attributes.display_window.size;
    let width = size.x() as u32;
    let height = size.y() as u32;

    // Collect channels from ALL headers (multi-part EXR support).
    // Each part may have its own layer_name attribute (V-Ray, Arnold, etc.)
    // or channels may use dot-prefixed names within a single part.
    let mut layer_map: BTreeMap<String, Vec<String>> = BTreeMap::new();

    for header in &meta.headers {
        // Multi-part: the part's own layer_name acts as the layer prefix
        let part_layer_name = header.own_attributes.layer_name
            .as_ref()
            .map(|n| n.to_string())
            .unwrap_or_default();

        for ch in header.channels.list.iter() {
            let ch_name = ch.name.to_string();

            // If the part has a layer name, use that as the layer grouping.
            // Otherwise, split the channel name on the last '.' for prefix-based grouping.
            let (layer, channel) = if !part_layer_name.is_empty() {
                (part_layer_name.clone(), ch_name)
            } else {
                split_channel_name(&ch_name)
            };

            layer_map.entry(layer).or_default().push(channel);
        }
    }

    let layers: Vec<ExrLayerInfo> = layer_map.into_iter().map(|(name, mut channels)| {
        channels.sort();
        let layer_type = classify_channels(&channels);
        let display_name = if name.is_empty() {
            format_base_layer_name(&layer_type)
        } else {
            name.clone()
        };
        ExrLayerInfo { name, display_name, channels, layer_type }
    }).collect();

    Ok(ExrMetadata { width, height, layers })
}

/// Decode a specific layer from an EXR file into RGBA32F bytes.
pub fn decode_exr_layer(path: &str, layer_name: &str, meta: &ExrMetadata) -> Result<Vec<u8>, String> {
    use exr::prelude::*;

    let layer_info = meta.layers.iter()
        .find(|l| l.name == layer_name)
        .ok_or_else(|| format!("Layer '{}' not found", layer_name))?;

    let pixel_count = (meta.width as usize) * (meta.height as usize);

    let image = read()
        .no_deep_data()
        .largest_resolution_level()
        .all_channels()
        .all_layers()
        .all_attributes()
        .from_file(path)
        .map_err(|e| format!("Cannot decode EXR: {}", e))?;

    // Build a lookup: (layer_name, channel_short_name) → f32 samples.
    // The exr crate groups channels into layers (by name prefix or by part).
    // Each exr Layer has a layer_name and channels with short names.
    let mut channel_map: BTreeMap<(String, String), Vec<f32>> = BTreeMap::new();
    for exr_layer in image.layer_data.iter() {
        let exr_layer_name = exr_layer.attributes.layer_name
            .as_ref()
            .map(|n| n.to_string())
            .unwrap_or_default();
        for ch in exr_layer.channel_data.list.iter() {
            let ch_name = ch.name.to_string();
            let samples: Vec<f32> = match &ch.sample_data {
                FlatSamples::F16(data) => data.iter().map(|v| v.to_f32()).collect(),
                FlatSamples::F32(data) => data.clone(),
                FlatSamples::U32(data) => data.iter().map(|v| *v as f32).collect(),
            };
            channel_map.insert((exr_layer_name.clone(), ch_name), samples);
        }
    }

    let get_channel = |ch_name: &str| -> Option<&Vec<f32>> {
        channel_map.get(&(layer_name.to_string(), ch_name.to_string()))
    };

    let mut buf = Vec::with_capacity(pixel_count * 16);

    match layer_info.layer_type.as_str() {
        "rgba" => {
            let r = get_channel("R").ok_or("Missing R channel")?;
            let g = get_channel("G").ok_or("Missing G channel")?;
            let b = get_channel("B").ok_or("Missing B channel")?;
            let a = get_channel("A").ok_or("Missing A channel")?;
            for i in 0..pixel_count {
                buf.extend_from_slice(&r.get(i).copied().unwrap_or(0.0).to_le_bytes());
                buf.extend_from_slice(&g.get(i).copied().unwrap_or(0.0).to_le_bytes());
                buf.extend_from_slice(&b.get(i).copied().unwrap_or(0.0).to_le_bytes());
                buf.extend_from_slice(&a.get(i).copied().unwrap_or(1.0).to_le_bytes());
            }
        }
        "rgb" => {
            let r = get_channel("R").ok_or("Missing R channel")?;
            let g = get_channel("G").ok_or("Missing G channel")?;
            let b = get_channel("B").ok_or("Missing B channel")?;
            for i in 0..pixel_count {
                buf.extend_from_slice(&r.get(i).copied().unwrap_or(0.0).to_le_bytes());
                buf.extend_from_slice(&g.get(i).copied().unwrap_or(0.0).to_le_bytes());
                buf.extend_from_slice(&b.get(i).copied().unwrap_or(0.0).to_le_bytes());
                buf.extend_from_slice(&1.0f32.to_le_bytes());
            }
        }
        "scalar" => {
            let ch_name = &layer_info.channels[0];
            let data = get_channel(ch_name)
                .ok_or_else(|| format!("Missing {} channel", ch_name))?;
            for i in 0..pixel_count {
                let v = data.get(i).copied().unwrap_or(0.0);
                buf.extend_from_slice(&v.to_le_bytes());
                buf.extend_from_slice(&v.to_le_bytes());
                buf.extend_from_slice(&v.to_le_bytes());
                buf.extend_from_slice(&1.0f32.to_le_bytes());
            }
        }
        _ => {
            // Vector or unknown: pack up to 3 channels as RGB
            let mut ch_data: Vec<&Vec<f32>> = Vec::new();
            for ch_name in layer_info.channels.iter().take(3) {
                ch_data.push(get_channel(ch_name)
                    .ok_or_else(|| format!("Missing {} channel", ch_name))?);
            }
            let ch_count = ch_data.len();
            for i in 0..pixel_count {
                for c in 0..3 {
                    let v = if c < ch_count {
                        ch_data[c].get(i).copied().unwrap_or(0.0)
                    } else {
                        0.0
                    };
                    buf.extend_from_slice(&v.to_le_bytes());
                }
                buf.extend_from_slice(&1.0f32.to_le_bytes());
            }
        }
    }

    Ok(buf)
}

fn split_channel_name(full: &str) -> (String, String) {
    if let Some(pos) = full.rfind('.') {
        (full[..pos].to_string(), full[pos + 1..].to_string())
    } else {
        (String::new(), full.to_string())
    }
}

fn classify_channels(channels: &[String]) -> String {
    let has = |name: &str| channels.iter().any(|c| c == name);
    if has("R") && has("G") && has("B") && has("A") {
        "rgba".to_string()
    } else if has("R") && has("G") && has("B") {
        "rgb".to_string()
    } else if channels.len() == 1 {
        "scalar".to_string()
    } else {
        "vector".to_string()
    }
}

fn format_base_layer_name(layer_type: &str) -> String {
    match layer_type {
        "rgba" => "RGBA".to_string(),
        "rgb" => "RGB".to_string(),
        _ => "Base".to_string(),
    }
}
