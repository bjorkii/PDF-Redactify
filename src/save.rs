
#[cfg(test)]
mod diag_q {
    use super::*;
    use super::tests::sample_path;
    #[test]
    #[ignore]
    fn measure() {
        let _g = PDFIUM_OP_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let doc = load_document(&sample_path("ZZ0002376_01.pdf")).unwrap();
        let page = doc.pages().get(7).unwrap();
        // 원본 이미지 정보
        for object in page.objects().iter() {
            if let Some(img) = object.as_image_object() {
                let raw = img.get_raw_image_data().map(|d| d.len()).unwrap_or(0);
                println!("원본 이미지: {}x{}px, 압축바이트 {} KB",
                    img.width().unwrap_or(0), img.height().unwrap_or(0), raw/1024);
            }
        }
        let pw = page.width().value; let ph = page.height().value;
        let scale = rasterize_render_scale(&page, pw, ph);
        let bmp = page.render_with_config(&PdfRenderConfig::new().scale_page_by_factor(scale)).unwrap();
        let image = bmp.as_image(); drop(bmp);
        let rgb = image.to_rgb8();
        println!("렌더 배율 {:.2}, 렌더 비트맵 {}x{}px", scale, rgb.width(), rgb.height());
        for q in [70u8, 75, 80, 85, 90] {
            let mut buf = Vec::new();
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, q).encode_image(&rgb).unwrap();
            println!("  q{} → {} KB", q, buf.len()/1024);
        }
    }
}
