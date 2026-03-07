pub struct AppState {
    pub hdr_image: Option<image::DynamicImage>,
    pub hdr_path: Option<String>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            hdr_image: None,
            hdr_path: None,
        }
    }
}
