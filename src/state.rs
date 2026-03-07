pub struct AppState {
    pub hdr_image: Option<image::DynamicImage>,
    pub hdr_path: Option<String>,
    pub image_bytes: Option<Vec<u8>>,
    pub image_content_type: String,
    pub image_width: u32,
    pub image_height: u32,
    pub image_is_hdr: bool,
    pub html: String,
    pub pending_file: Option<String>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            hdr_image: None,
            hdr_path: None,
            image_bytes: None,
            image_content_type: String::new(),
            image_width: 0,
            image_height: 0,
            image_is_hdr: false,
            html: String::new(),
            pending_file: None,
        }
    }
}
