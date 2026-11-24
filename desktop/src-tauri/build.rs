// Every command the site may call. Each gets an allow-<name> permission that
// capabilities/site.json grants to the live site only.
const COMMANDS: &[&str] = &[
    "window_minimize",
    "window_toggle_maximize",
    "window_close",
    "window_start_drag",
    "window_is_maximized",
    "window_set_fullscreen",
    "window_is_fullscreen",
    "desktop_get_version",
    "desktop_install_update",
    "pip_close",
    "media_set_state",
    "media_clear",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("tauri build step failed");
}
