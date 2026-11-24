#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod thumbar;
mod updater;

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::OnceLock;

use serde::Deserialize;
use serde_json::Value;
use tauri::webview::{NewWindowFeatures, NewWindowResponse, PermissionKind, PermissionResponse};
use tauri::window::{Color, ProgressBarState, ProgressBarStatus};
use tauri::{AppHandle, Manager, Theme, Url, Webview, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_window_state::StateFlags;

pub const MAIN: &str = "main";
const AUMID: &str = "com.brozy.memories";
const LIVE_URL: &str = "https://memories.brozy.org/?windapp=1";
const BRIDGE: &str = include_str!("bridge.js");

struct Site {
    start: Url,
    origins: Vec<String>,
    bridge: String,
}

static SITE: OnceLock<Site> = OnceLock::new();
static NEXT_WINDOW: AtomicU32 = AtomicU32::new(1);
static FULLSCREEN: AtomicBool = AtomicBool::new(false);

fn site() -> &'static Site {
    SITE.get_or_init(|| {
        let start = start_url();
        let mut origins = vec![start.origin().ascii_serialization()];
        let live = Url::parse(LIVE_URL).expect("live URL is valid").origin().ascii_serialization();
        if !origins.contains(&live) {
            origins.push(live);
        }
        let bridge = BRIDGE
            .replace("__ALLOWED_ORIGINS__", &serde_json::to_string(&origins).expect("origins serialize"))
            .replace("__PLATFORM__", "\"win32\"");
        Site { start, origins, bridge }
    })
}

// Release builds only ever load the live site. Debug builds load the local dev
// server, or WINDAPP_URL, and refuse to start on a bad value rather than guess.
fn start_url() -> Url {
    #[cfg(debug_assertions)]
    {
        let raw = std::env::var("WINDAPP_URL").unwrap_or_else(|_| "http://localhost:3000/?windapp=1".into());
        let url = Url::parse(&raw).expect("WINDAPP_URL is not a valid URL");
        assert!(matches!(url.scheme(), "http" | "https"), "WINDAPP_URL must be http or https");
        url
    }
    #[cfg(not(debug_assertions))]
    Url::parse(LIVE_URL).expect("live URL is valid")
}

pub fn site_origin() -> String {
    site().start.origin().ascii_serialization()
}

fn is_allowed(url: &Url) -> bool {
    let origin = url.origin().ascii_serialization();
    site().origins.iter().any(|allowed| *allowed == origin)
}

fn is_pip(url: &Url) -> bool {
    is_allowed(url) && (url.path() == "/pip" || url.path().starts_with("/pip/"))
}

fn open_external(app: &AppHandle, url: &Url) {
    if matches!(url.scheme(), "http" | "https" | "mailto") {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
}

// Pages outside the site open in the default browser instead of inside the app.
fn guard(app: &AppHandle, url: &Url) -> bool {
    if is_allowed(url) || url.as_str() == "about:blank" {
        return true;
    }
    open_external(app, url);
    false
}

fn deny_new_window(app: &AppHandle, url: &Url) -> NewWindowResponse<tauri::Wry> {
    if !is_allowed(url) {
        open_external(app, url);
    }
    NewWindowResponse::Deny
}

fn permission(webview: Webview, kind: PermissionKind) -> PermissionResponse {
    let from_site = webview.url().map(|url| is_allowed(&url)).unwrap_or(false);
    if from_site && matches!(kind, PermissionKind::Notifications) {
        PermissionResponse::Allow
    } else {
        PermissionResponse::Deny
    }
}

fn background(theme: Theme) -> Color {
    match theme {
        Theme::Dark => Color(0x0f, 0x14, 0x19, 0xff),
        _ => Color(0xff, 0xff, 0xff, 0xff),
    }
}

pub fn dispatch(window: &WebviewWindow, name: &str, payload: Value) {
    let name = serde_json::to_string(name).expect("event name serializes");
    let _ = window.eval(format!(
        "window.__memoriesWindappDispatch&&window.__memoriesWindappDispatch({name},{payload})"
    ));
}

fn sync_fullscreen(window: &WebviewWindow) {
    let on = window.is_fullscreen().unwrap_or(false);
    if FULLSCREEN.swap(on, Ordering::Relaxed) != on {
        dispatch(window, "window:fullscreen-changed", Value::Bool(on));
    }
}

fn blank() -> WebviewUrl {
    WebviewUrl::External("about:blank".parse().expect("about:blank parses"))
}

fn open_main(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let nav = app.clone();
    let popups = app.clone();
    let window = WebviewWindowBuilder::new(app, MAIN, WebviewUrl::External(site().start.clone()))
        .title("Memories")
        .inner_size(1280.0, 800.0)
        .min_inner_size(800.0, 600.0)
        .decorations(false)
        .visible(false)
        .initialization_script(site().bridge.clone())
        .on_navigation(move |url| guard(&nav, url))
        .on_new_window(move |url, features| new_window(&popups, url, features))
        .on_permission_request(permission)
        .build()?;

    // Window state is restored during build, so showing now avoids a jump.
    let _ = window.set_background_color(Some(background(window.theme().unwrap_or(Theme::Light))));
    disable_browser_keys(&window);
    window.show()?;
    let _ = window.set_focus();

    let events = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Resized(_) => sync_fullscreen(&events),
        WindowEvent::ThemeChanged(theme) => {
            let _ = events.set_background_color(Some(background(*theme)));
        }
        WindowEvent::Destroyed => events.app_handle().exit(0),
        _ => {}
    });
    Ok(window)
}

fn new_window(app: &AppHandle, url: Url, features: NewWindowFeatures) -> NewWindowResponse<tauri::Wry> {
    if !is_allowed(&url) {
        return deny_new_window(app, &url);
    }
    let built = if is_pip(&url) {
        open_pip(app, features)
    } else {
        open_popup(app, features)
    };
    match built {
        Ok(window) => NewWindowResponse::Create { window },
        Err(_) => NewWindowResponse::Deny,
    }
}

// The site's PiP keeps the handle window.open returns and talks to it, so the
// popup has to be the real linked window, sized like the Electron one.
fn open_pip(app: &AppHandle, features: NewWindowFeatures) -> tauri::Result<WebviewWindow> {
    close_pips(app);
    let nav = app.clone();
    let popups = app.clone();
    let label = format!("pip-{}", NEXT_WINDOW.fetch_add(1, Ordering::Relaxed));
    let window = WebviewWindowBuilder::new(app, label, blank())
        .window_features(features)
        .title("Memories")
        .inner_size(390.0, 700.0)
        .min_inner_size(280.0, 420.0)
        .max_inner_size(480.0, 860.0)
        .maximizable(false)
        .always_on_top(true)
        .decorations(false)
        .background_color(Color(0, 0, 0, 0xff))
        .initialization_script(site().bridge.clone())
        .on_navigation(move |url| guard(&nav, url))
        .on_new_window(move |url, _| deny_new_window(&popups, &url))
        .on_permission_request(permission)
        .build()?;
    disable_browser_keys(&window);
    Ok(window)
}

// Other same site popups get a normal framed window without the desktop bridge.
fn open_popup(app: &AppHandle, features: NewWindowFeatures) -> tauri::Result<WebviewWindow> {
    let nav = app.clone();
    let popups = app.clone();
    let label = format!("popup-{}", NEXT_WINDOW.fetch_add(1, Ordering::Relaxed));
    WebviewWindowBuilder::new(app, label, blank())
        .title("Memories")
        .inner_size(1024.0, 720.0)
        .window_features(features)
        .on_document_title_changed(|window, title| {
            let _ = window.set_title(&title);
        })
        .on_navigation(move |url| guard(&nav, url))
        .on_new_window(move |url, _| deny_new_window(&popups, &url))
        .on_permission_request(permission)
        .build()
}

fn close_pips(app: &AppHandle) {
    for (label, window) in app.webview_windows() {
        if label.starts_with("pip-") {
            let _ = window.destroy();
        }
    }
}

// Ctrl+F, Ctrl+P, F5 and friends would make the app feel like a browser tab.
// Copy, paste and the site's own shortcuts keep working.
fn disable_browser_keys(window: &WebviewWindow) {
    let _ = window.with_webview(|webview| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
        use windows::core::Interface;
        let Ok(core) = webview.controller().CoreWebView2() else { return };
        let Ok(settings) = core.Settings() else { return };
        if let Ok(settings) = settings.cast::<ICoreWebView2Settings3>() {
            let _ = settings.SetAreBrowserAcceleratorKeysEnabled(false);
        }
    });
}

fn failed(error: tauri::Error) -> String {
    error.to_string()
}

#[tauri::command]
fn window_minimize(window: WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(failed)
}

#[tauri::command]
fn window_toggle_maximize(window: WebviewWindow) -> Result<bool, String> {
    if !window.is_maximizable().map_err(failed)? {
        return Ok(false);
    }
    let maximized = window.is_maximized().map_err(failed)?;
    if maximized {
        window.unmaximize().map_err(failed)?;
    } else {
        window.maximize().map_err(failed)?;
    }
    Ok(!maximized)
}

#[tauri::command]
fn window_close(window: WebviewWindow) -> Result<(), String> {
    window.close().map_err(failed)
}

#[tauri::command]
fn window_is_maximized(window: WebviewWindow) -> Result<bool, String> {
    window.is_maximized().map_err(failed)
}

#[tauri::command]
fn window_set_fullscreen(window: WebviewWindow, on: bool) -> Result<bool, String> {
    if window.label() != MAIN {
        return Ok(false);
    }
    window.set_fullscreen(on).map_err(failed)?;
    sync_fullscreen(&window);
    Ok(true)
}

#[tauri::command]
fn window_is_fullscreen(window: WebviewWindow) -> Result<bool, String> {
    window.is_fullscreen().map_err(failed)
}

#[tauri::command]
fn desktop_get_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
async fn desktop_install_update(app: AppHandle) -> Value {
    tauri::async_runtime::spawn_blocking(move || updater::check(&app, true))
        .await
        .unwrap_or_else(|_| updater::failure(""))
}

#[tauri::command]
fn pip_close(app: AppHandle) {
    for (label, window) in app.webview_windows() {
        if label.starts_with("pip-") {
            let _ = window.close();
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MediaState {
    playing: bool,
    can_next: bool,
    can_previous: bool,
    progress: Option<f64>,
}

#[tauri::command]
fn media_set_state(app: AppHandle, state: MediaState) -> bool {
    let Some(main) = app.get_webview_window(MAIN) else { return false };
    thumbar::show(&main, state.playing, state.can_previous, state.can_next);
    if let Some(progress) = state.progress.filter(|p| p.is_finite()) {
        let bar = if state.playing {
            ProgressBarState {
                status: Some(ProgressBarStatus::Normal),
                progress: Some((progress.clamp(0.0, 1.0) * 100.0).round() as u64),
            }
        } else {
            ProgressBarState { status: Some(ProgressBarStatus::None), progress: None }
        };
        let _ = main.set_progress_bar(bar);
    }
    true
}

#[tauri::command]
fn media_clear(app: AppHandle) {
    if let Some(main) = app.get_webview_window(MAIN) {
        thumbar::hide(&main);
        let _ = main.set_progress_bar(ProgressBarState { status: Some(ProgressBarStatus::None), progress: None });
    }
}

fn main() {
    #[cfg(windows)]
    unsafe {
        let _ = windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID(&windows::core::HSTRING::from(AUMID));
    }

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window(MAIN) {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
                .with_filter(|label| label == MAIN)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            window_minimize,
            window_toggle_maximize,
            window_close,
            window_is_maximized,
            window_set_fullscreen,
            window_is_fullscreen,
            desktop_get_version,
            desktop_install_update,
            pip_close,
            media_set_state,
            media_clear,
        ])
        .setup(|app| {
            #[cfg(debug_assertions)]
            app.add_capability(
                tauri::ipc::CapabilityBuilder::new("dev-site")
                    .remote(format!("{}/*", site_origin()))
                    .windows(["main", "pip-*"])
                    .permission("allow-window-minimize")
                    .permission("allow-window-toggle-maximize")
                    .permission("allow-window-close")
                    .permission("allow-window-is-maximized")
                    .permission("allow-window-set-fullscreen")
                    .permission("allow-window-is-fullscreen")
                    .permission("allow-desktop-get-version")
                    .permission("allow-desktop-install-update")
                    .permission("allow-pip-close")
                    .permission("allow-media-set-state")
                    .permission("allow-media-clear"),
            )?;

            let main = open_main(app.handle())?;
            thumbar::install(&main);

            #[cfg(not(debug_assertions))]
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(4));
                    let _ = updater::check(&handle, false);
                });
            }
            Ok(())
        });

    builder
        .run(tauri::generate_context!())
        .expect("failed to start Memories");
}
