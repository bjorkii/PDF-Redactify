mod commands;
mod detection;
mod error;
mod legal_dong;
mod pdfium;
mod save;
mod settings;
mod sidecar;
mod status;
mod xlsx;

#[cfg(not(test))]
use commands::bookmarks::get_bookmarks;
#[cfg(not(test))]
use commands::detection::{cancel_detection, detect_review_items, DetectionCancelToken};
#[cfg(not(test))]
use commands::operation::{cancel_operation, open_path_external, OperationCancelToken};
#[cfg(not(test))]
use commands::pdf::{extract_text_in_bbox, open_pdf, open_pdf_path, render_page};
#[cfg(not(test))]
use commands::sample::{ping, ping_fail, report_status};
#[cfg(not(test))]
use commands::save::save_redacted_document;
#[cfg(not(test))]
use commands::settings::{
    load_color_settings, load_detection_categories, load_global_color_settings, save_color_settings,
    save_detection_categories, save_global_color_settings,
};
#[cfg(not(test))]
use commands::sidecar::{load_sidecar, save_sidecar};
#[cfg(not(test))]
use commands::xlsx::{export_review_items, import_review_items, reanchor_review_item_bboxes};

// `tauri::generate_context!()`는 플랫폼별 리소스를 고유 심볼로 임베드하므로 한 빌드
// 산출물 안에서 두 번 이상 호출하면 심볼 충돌이 난다. 테스트 빌드에서는 ipc_tests
// 모듈이 이미 한 번 호출하므로, 프로덕션 진입점인 이 함수는 테스트 빌드에서 제외한다.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[cfg(not(test))]
pub fn run() {
    use tauri::Manager;

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // DIST-01~03: 배포 번들에서는 pdfium 동적 라이브러리를 앱 리소스로 함께 담고
        // (tauri.conf.json bundle.resources), 시작 시 그 실제 경로를
        // PDFIUM_DYNAMIC_LIB_PATH로 넣어준다 — pdfium.rs의 dev용 CARGO_MANIFEST_DIR
        // 경로는 빌드 머신 기준이라 배포 앱에서는 유효하지 않기 때문이다. 리소스가
        // 없으면(예: cargo run 개발) 그대로 두어 dev 폴백 경로를 쓰게 한다.
        .setup(|app| {
            if std::env::var_os("PDFIUM_DYNAMIC_LIB_PATH").is_none() {
                if let Ok(resource_dir) = app.path().resource_dir() {
                    let bundled = resource_dir.join(pdfium::bundled_lib_relative_path());
                    if bundled.exists() {
                        std::env::set_var("PDFIUM_DYNAMIC_LIB_PATH", &bundled);
                    }
                }
            }
            Ok(())
        })
        .manage(DetectionCancelToken::default())
        .manage(OperationCancelToken::default())
        .invoke_handler(tauri::generate_handler![
            ping,
            ping_fail,
            report_status,
            open_pdf,
            open_pdf_path,
            render_page,
            extract_text_in_bbox,
            get_bookmarks,
            save_sidecar,
            load_sidecar,
            detect_review_items,
            cancel_detection,
            save_color_settings,
            load_color_settings,
            save_global_color_settings,
            load_global_color_settings,
            save_detection_categories,
            load_detection_categories,
            export_review_items,
            import_review_items,
            reanchor_review_item_bboxes,
            save_redacted_document,
            cancel_operation,
            open_path_external
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod ipc_tests {
    use tauri::test::{get_ipc_response, mock_builder};
    use tauri::webview::InvokeRequest;
    use tauri::ipc::{CallbackFn, InvokeBody};

    // capabilities/default.json에 등록된 실제 ACL(허용 커맨드 목록)을 그대로 사용해
    // 프로덕션과 동일한 권한 경로로 IPC 왕복을 검증한다.
    fn make_app() -> tauri::App<tauri::test::MockRuntime> {
        mock_builder()
            .manage(super::commands::detection::DetectionCancelToken::default())
            .manage(super::commands::operation::OperationCancelToken::default())
            .invoke_handler(tauri::generate_handler![
                super::commands::sample::ping,
                super::commands::sample::ping_fail,
                super::commands::sample::report_status,
                super::commands::pdf::open_pdf_path,
                super::commands::pdf::render_page,
                super::commands::pdf::extract_text_in_bbox,
                super::commands::bookmarks::get_bookmarks,
                super::commands::sidecar::save_sidecar,
                super::commands::sidecar::load_sidecar,
                super::commands::detection::detect_review_items,
                super::commands::detection::cancel_detection,
                super::commands::settings::save_color_settings,
                super::commands::settings::load_color_settings,
                super::commands::settings::save_global_color_settings,
                super::commands::settings::load_global_color_settings,
                super::commands::settings::save_detection_categories,
                super::commands::settings::load_detection_categories,
                super::commands::xlsx::export_review_items,
                super::commands::xlsx::reanchor_review_item_bboxes,
                super::commands::operation::cancel_operation,
                super::commands::operation::open_path_external
                // save_redacted_document는 SAVE-05(OS 네이티브 저장 다이얼로그)
                // 이후 open_pdf와 마찬가지로 실제 다이얼로그를 띄우는 커맨드라
                // mock 웹뷰로는 IPC 왕복 테스트를 할 수 없다 — 순수 로직은
                // commands/save.rs 자체의 단위테스트가 커버한다.
            ])
            .build(tauri::generate_context!())
            .expect("mock 앱 빌드 실패")
    }

    fn invoke_request(cmd: &str, body: serde_json::Value) -> InvokeRequest {
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            // 로컬 오리진 스킴은 OS별로 다르다(Windows: http://tauri.localhost, 그 외: tauri://localhost).
            #[cfg(windows)]
            url: "http://tauri.localhost".parse().unwrap(),
            #[cfg(not(windows))]
            url: "tauri://localhost".parse().unwrap(),
            body: InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.to_string(),
        }
    }

    #[test]
    fn ping_command_round_trips_success_response() {
        let app = make_app();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("mock 웹뷰 생성 실패");

        let response = get_ipc_response(
            &webview,
            invoke_request("ping", serde_json::json!({ "value": "hello" })),
        )
        .expect("ping 호출 실패");

        let value: String = response.deserialize().expect("응답 역직렬화 실패");
        assert_eq!(value, "pong: hello");
    }

    #[test]
    fn ping_fail_command_round_trips_standard_error_envelope() {
        let app = make_app();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("mock 웹뷰 생성 실패");

        let body = get_ipc_response(&webview, invoke_request("ping_fail", serde_json::json!({})))
            .expect_err("ping_fail은 실패해야 함");

        assert_eq!(body["code"], "SAMPLE_FAILURE");
        assert_eq!(body["message"], "샘플 실패 응답입니다");
    }

    #[test]
    fn report_status_command_round_trips_success_response() {
        let app = make_app();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("mock 웹뷰 생성 실패");

        get_ipc_response(
            &webview,
            invoke_request("report_status", serde_json::json!({ "message": "진행 중입니다" })),
        )
        .expect("report_status 호출 실패");
    }

    #[test]
    fn render_page_command_round_trips_rendered_page() {
        let app = make_app();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("mock 웹뷰 생성 실패");

        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("pdf-samples")
            .join("BZB000877_01.pdf");

        let response = get_ipc_response(
            &webview,
            invoke_request(
                "render_page",
                serde_json::json!({ "path": path.to_string_lossy(), "pageIndex": 0, "scale": 0.1 }),
            ),
        )
        .expect("render_page 호출 실패");

        let rendered: serde_json::Value = response.deserialize().expect("응답 역직렬화 실패");
        assert_eq!(rendered["pageIndex"], 0);
        assert!(rendered["width"].as_u64().unwrap() > 0);
        assert!(rendered["height"].as_u64().unwrap() > 0);
        assert!(!rendered["pngBase64"].as_str().unwrap().is_empty());
    }

    #[test]
    fn open_pdf_path_command_round_trips_document_info() {
        let app = make_app();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("mock 웹뷰 생성 실패");

        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("pdf-samples")
            .join("BZB000877_01.pdf");

        let response = get_ipc_response(
            &webview,
            invoke_request("open_pdf_path", serde_json::json!({ "path": path.to_string_lossy() })),
        )
        .expect("open_pdf_path 호출 실패");

        let info: serde_json::Value = response.deserialize().expect("응답 역직렬화 실패");
        assert_eq!(info["filename"], "BZB000877_01.pdf");
        assert_eq!(info["pageCount"], 4);
    }

    #[test]
    fn get_bookmarks_command_round_trips_bookmark_tree() {
        let app = make_app();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("mock 웹뷰 생성 실패");

        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("pdf-samples")
            .join("BZB000877_01.pdf");

        let response = get_ipc_response(
            &webview,
            invoke_request("get_bookmarks", serde_json::json!({ "path": path.to_string_lossy() })),
        )
        .expect("get_bookmarks 호출 실패");

        let bookmarks: serde_json::Value = response.deserialize().expect("응답 역직렬화 실패");
        assert_eq!(bookmarks.as_array().unwrap().len(), 5);
        assert_eq!(bookmarks[0]["title"], "표지");
        assert_eq!(bookmarks[0]["pageIndex"], 0);
    }

    fn sample_sidecar_document_json() -> serde_json::Value {
        serde_json::json!({
            "schema_version": 2,
            "app": "PDF-Redactify",
            "source": {
                "filename": "test.pdf",
                "path": "/abs/test.pdf",
                "page_count": 1,
                "text_fingerprint": "sha256:abc",
                "created_at": "2026-07-26T00:00:00.000Z",
                "updated_at": "2026-07-26T00:00:00.000Z"
            },
            "view_state": {
                "current_page": 0,
                "zoom": 1.0,
                "selected_item_id": null,
                "focus": "viewer",
                "bookmark_sidebar": { "visible": true, "dock": "left" },
                "redaction_sidebar": { "visible": true, "dock": "right", "floating": false, "rect": null },
                "sort": { "column": "position", "direction": "asc" }
            },
            "page_dimensions": [],
            "review_items": [],
            "history": { "cursor": 0, "entries": [] }
        })
    }

    #[test]
    fn save_sidecar_then_load_sidecar_round_trips_via_ipc() {
        let app = make_app();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("mock 웹뷰 생성 실패");

        let dir = tempfile::tempdir().expect("임시 디렉터리 생성 실패");
        let pdf_path = dir.path().join("test.pdf");
        std::fs::write(&pdf_path, b"fake").expect("더미 PDF 쓰기 실패");
        let path_str = pdf_path.to_string_lossy().to_string();

        get_ipc_response(
            &webview,
            invoke_request(
                "save_sidecar",
                serde_json::json!({ "path": path_str, "document": sample_sidecar_document_json() }),
            ),
        )
        .expect("save_sidecar 호출 실패");

        let response = get_ipc_response(
            &webview,
            invoke_request("load_sidecar", serde_json::json!({ "path": path_str })),
        )
        .expect("load_sidecar 호출 실패");

        let loaded: serde_json::Value = response.deserialize().expect("응답 역직렬화 실패");
        assert_eq!(loaded["schema_version"], 2);
        assert_eq!(loaded["source"]["filename"], "test.pdf");
    }

    #[test]
    fn detect_review_items_command_round_trips_candidates() {
        let app = make_app();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("mock 웹뷰 생성 실패");

        // KKZ000160_01.pdf에는 실제 전화번호가 있어 후보가 나온다(BZB000877은
        // anchor 없는 날짜뿐이라 생년월일 anchor 필수화 이후 0건).
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("pdf-samples")
            .join("KKZ000160_01.pdf");

        let response = get_ipc_response(
            &webview,
            invoke_request(
                "detect_review_items",
                serde_json::json!({ "path": path.to_string_lossy(), "exclusionZones": [] }),
            ),
        )
        .expect("detect_review_items 호출 실패");

        let items: serde_json::Value = response.deserialize().expect("응답 역직렬화 실패");
        assert!(!items.as_array().unwrap().is_empty());
    }

    #[test]
    fn cancel_detection_command_round_trips_without_a_running_detection() {
        let app = make_app();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("mock 웹뷰 생성 실패");

        get_ipc_response(&webview, invoke_request("cancel_detection", serde_json::json!({})))
            .expect("cancel_detection 호출 실패");
    }

    #[test]
    fn save_color_settings_then_load_color_settings_round_trips_via_ipc() {
        let app = make_app();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("mock 웹뷰 생성 실패");

        let dir = tempfile::tempdir().expect("임시 디렉터리 생성 실패");
        let pdf_path = dir.path().join("test.pdf");
        std::fs::write(&pdf_path, b"fake").expect("더미 PDF 쓰기 실패");
        let path_str = pdf_path.to_string_lossy().to_string();

        let settings = serde_json::json!({
            "detected": {
                "selected": { "background": "#111111", "border": "#222222" },
                "unselected": { "background": "#333333", "border": "#444444" }
            },
            "manual": {
                "selected": { "background": "#555555", "border": "#666666" },
                "unselected": { "background": "#777777", "border": "#888888" }
            },
            "focus_border_color": "#999999",
            "sidebar_selection": { "background": "#aaaaaa", "font": "#bbbbbb" }
        });

        get_ipc_response(
            &webview,
            invoke_request(
                "save_color_settings",
                serde_json::json!({ "path": path_str, "settings": settings }),
            ),
        )
        .expect("save_color_settings 호출 실패");

        let response = get_ipc_response(
            &webview,
            invoke_request("load_color_settings", serde_json::json!({ "path": path_str })),
        )
        .expect("load_color_settings 호출 실패");

        let loaded: serde_json::Value = response.deserialize().expect("응답 역직렬화 실패");
        assert_eq!(loaded["focus_border_color"], "#999999");
        assert_eq!(loaded["detected"]["selected"]["background"], "#111111");
    }

    #[test]
    fn export_review_items_command_round_trips_saved_path() {
        let app = make_app();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("mock 웹뷰 생성 실패");

        let dir = tempfile::tempdir().expect("임시 디렉터리 생성 실패");
        let pdf_path = dir.path().join("test.pdf");
        std::fs::write(&pdf_path, b"fake").expect("더미 PDF 쓰기 실패");
        let path_str = pdf_path.to_string_lossy().to_string();

        let rows = serde_json::json!([{
            "filename": "test.pdf",
            "category": "전화번호",
            "content": "010-1234-5678",
            "page": 1,
            "bbox": "0.1,0.2,0.3,0.05",
            "updated_at": "2026-01-01T00:00:00.000Z"
        }]);

        let response = get_ipc_response(
            &webview,
            invoke_request("export_review_items", serde_json::json!({ "path": path_str, "rows": rows })),
        )
        .expect("export_review_items 호출 실패");

        // UI-PROGRESS: 반환형이 Option<String>(취소 시 None). 정상 완료면 Some(경로).
        let saved_path: Option<String> = response.deserialize().expect("응답 역직렬화 실패");
        let saved_path = saved_path.expect("정상 완료 시 저장 경로가 있어야 함");
        assert!(saved_path.ends_with("test-블랙마킹목록.xlsx"));
        assert!(std::path::Path::new(&saved_path).exists());
    }

    #[test]
    fn reanchor_review_item_bboxes_command_finds_real_content_via_ipc() {
        let app = make_app();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("mock 웹뷰 생성 실패");

        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("pdf-samples")
            .join("KKZ000160_01.pdf");

        // DET-01로 실제 검출된 (page, content)를 그대로 재탐색 요청에 쓴다.
        let items = super::pdfium::detect_review_items(&path).expect("검출 실패");
        let item = items.first().expect("검출된 항목이 있어야 함");

        let response = get_ipc_response(
            &webview,
            invoke_request(
                "reanchor_review_item_bboxes",
                serde_json::json!({
                    "path": path.to_string_lossy(),
                    "requests": [{ "page_index": item.page, "content": item.content }]
                }),
            ),
        )
        .expect("reanchor_review_item_bboxes 호출 실패");

        let results: serde_json::Value = response.deserialize().expect("응답 역직렬화 실패");
        assert!(!results[0].is_null());
    }
}
