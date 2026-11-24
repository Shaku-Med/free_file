// Same protocol as the Electron updater: ask the site for the active Windows
// build, download it from the site, run it silently and quit.

use std::fs::{self, File};
use std::io::{BufWriter, Read, Write};
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::window::{ProgressBarState, ProgressBarStatus};
use tauri::{AppHandle, Manager, WebviewWindow};
use windows::core::HSTRING;
use windows::Win32::UI::WindowsAndMessaging::{
    MessageBoxW, IDYES, MB_ICONINFORMATION, MB_SETFOREGROUND, MB_YESNO,
};

use crate::{site_origin, MAIN};

const MAX_INSTALLER_BYTES: u64 = 400 * 1024 * 1024;
const MAX_JSON_BYTES: u64 = 64 * 1024;
const DEFAULT_DOWNLOAD_PATH: &str = "/api/desktop/win/download";
const DETACHED_PROCESS: u32 = 0x0000_0008;

static RUNNING: AtomicBool = AtomicBool::new(false);

#[derive(Deserialize)]
struct VersionReply {
    #[serde(default)]
    success: bool,
    #[serde(default, rename = "updateAvailable")]
    update_available: bool,
    latest: Option<Latest>,
}

#[derive(Deserialize)]
struct Latest {
    version: String,
    filename: Option<String>,
    #[serde(rename = "downloadPath")]
    download_path: Option<String>,
}

pub fn failure(current: &str) -> Value {
    json!({ "updateAvailable": false, "current": current, "error": "Update failed" })
}

pub fn check(app: &AppHandle, skip_prompt: bool) -> Value {
    let current = app.package_info().version.to_string();
    if RUNNING.swap(true, Ordering::SeqCst) {
        return json!({ "updateAvailable": false, "current": current, "busy": true });
    }
    let main = app.get_webview_window(MAIN);
    let result = run(app, &current, skip_prompt, main.as_ref());
    if result.is_err() {
        if let Some(window) = &main {
            reset_window(window);
        }
    }
    RUNNING.store(false, Ordering::SeqCst);
    result.unwrap_or_else(|_| failure(&current))
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .redirects(0)
        .timeout_connect(Duration::from_secs(10))
        .timeout_read(Duration::from_secs(30))
        .user_agent("Memories-Desktop")
        .build()
}

fn run(app: &AppHandle, current: &str, skip_prompt: bool, main: Option<&WebviewWindow>) -> Result<Value, ()> {
    let origin = site_origin();
    if cfg!(not(debug_assertions)) && !origin.starts_with("https://") {
        return Err(());
    }
    let agent = agent();

    let reply = agent
        .get(&format!("{origin}/api/desktop/version"))
        .query("platform", "win32")
        .query("current", current)
        .set("Accept", "application/json")
        .set("X-Memories-Desktop", "1")
        .call()
        .map_err(|_| ())?;
    if reply.status() != 200 {
        return Ok(json!({ "updateAvailable": false, "current": current }));
    }
    let mut body = String::new();
    reply
        .into_reader()
        .take(MAX_JSON_BYTES)
        .read_to_string(&mut body)
        .map_err(|_| ())?;
    let reply: VersionReply = serde_json::from_str(&body).map_err(|_| ())?;
    let latest = match reply.latest {
        Some(latest) if reply.success && reply.update_available => latest,
        _ => return Ok(json!({ "updateAvailable": false, "current": current })),
    };

    if !valid_version(&latest.version) {
        return Err(());
    }
    let version = latest.version;
    let filename = latest
        .filename
        .unwrap_or_else(|| format!("Memories-Setup-{version}.exe"));
    let download_path = latest
        .download_path
        .unwrap_or_else(|| DEFAULT_DOWNLOAD_PATH.to_string());
    if !valid_filename(&filename) || !valid_download_path(&download_path) {
        return Err(());
    }

    if !skip_prompt && !confirm(main, &version, current) {
        return Ok(json!({ "updateAvailable": true, "current": current, "latest": version, "deferred": true }));
    }

    let installer = download(&agent, &format!("{origin}{download_path}"), &filename, main)?;

    if let Some(window) = main {
        let _ = window.set_progress_bar(none());
        let _ = window.set_title("Installing update…");
    }
    Command::new(&installer)
        .args(["/S", "/UPDATE", "/R"])
        .creation_flags(DETACHED_PROCESS)
        .spawn()
        .map_err(|_| ())?;
    app.exit(0);
    Ok(json!({ "updateAvailable": true, "current": current, "latest": version, "installing": true }))
}

fn confirm(main: Option<&WebviewWindow>, version: &str, current: &str) -> bool {
    let owner = main.and_then(|window| window.hwnd().ok());
    let text = HSTRING::from(format!(
        "Memories {version} is ready.\n\nYou are on {current}. Download and install the update now?"
    ));
    let answer = unsafe {
        MessageBoxW(
            owner,
            &text,
            &HSTRING::from("Update available"),
            MB_YESNO | MB_ICONINFORMATION | MB_SETFOREGROUND,
        )
    };
    answer == IDYES
}

fn download(agent: &ureq::Agent, url: &str, filename: &str, main: Option<&WebviewWindow>) -> Result<PathBuf, ()> {
    let reply = agent.get(url).set("X-Memories-Desktop", "1").call().map_err(|_| ())?;
    if reply.status() != 200 {
        return Err(());
    }
    let total = reply
        .header("Content-Length")
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);
    if total > MAX_INSTALLER_BYTES {
        return Err(());
    }

    let dir = std::env::temp_dir().join("memories-desktop-update");
    fs::create_dir_all(&dir).map_err(|_| ())?;
    let dest = dir.join(filename);
    let partial = dir.join(format!("{filename}.part"));

    let written = (|| -> Result<(), ()> {
        let mut out = BufWriter::new(File::create(&partial).map_err(|_| ())?);
        let mut reader = reply.into_reader().take(MAX_INSTALLER_BYTES + 1);
        let mut chunk = vec![0u8; 64 * 1024];
        let mut received: u64 = 0;
        let mut shown: i64 = -1;
        let mut head = [0u8; 2];
        loop {
            let read = reader.read(&mut chunk).map_err(|_| ())?;
            if read == 0 {
                break;
            }
            if received < 2 {
                for (i, byte) in chunk[..read].iter().take(2 - received as usize).enumerate() {
                    head[received as usize + i] = *byte;
                }
            }
            received += read as u64;
            if received > MAX_INSTALLER_BYTES {
                return Err(());
            }
            out.write_all(&chunk[..read]).map_err(|_| ())?;
            if total > 0 {
                let percent = (received * 100 / total).min(100) as i64;
                if percent != shown {
                    shown = percent;
                    if let Some(window) = main {
                        show_progress(window, percent as u64);
                    }
                }
            }
        }
        out.flush().map_err(|_| ())?;
        // Every Windows executable starts with "MZ"; anything else is an error page.
        let complete = total == 0 || received == total;
        if head != *b"MZ" || !complete {
            return Err(());
        }
        Ok(())
    })();

    if written.is_err() {
        let _ = fs::remove_file(&partial);
        return Err(());
    }
    let _ = fs::remove_file(&dest);
    fs::rename(&partial, &dest).map_err(|_| ())?;
    Ok(dest)
}

fn show_progress(window: &WebviewWindow, percent: u64) {
    let _ = window.set_progress_bar(ProgressBarState {
        status: Some(ProgressBarStatus::Normal),
        progress: Some(percent),
    });
    let _ = window.set_title(&format!("Downloading update… {percent}%"));
}

fn none() -> ProgressBarState {
    ProgressBarState { status: Some(ProgressBarStatus::None), progress: None }
}

fn reset_window(window: &WebviewWindow) {
    let _ = window.set_progress_bar(none());
    let _ = window.set_title("Memories");
}

fn valid_version(version: &str) -> bool {
    (1..=32).contains(&version.len())
        && version.starts_with(|c: char| c.is_ascii_digit())
        && version.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+'))
}

fn valid_filename(name: &str) -> bool {
    (5..=100).contains(&name.len())
        && !name.starts_with('.')
        && name.to_ascii_lowercase().ends_with(".exe")
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
}

fn valid_download_path(path: &str) -> bool {
    path.len() <= 100
        && path.starts_with("/api/desktop/")
        && !path.contains("..")
        && path.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '-' | '_'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unsafe_values() {
        assert!(valid_version("1.0.5"));
        assert!(!valid_version("1.0.5;rm"));
        assert!(!valid_version("v"));
        assert!(valid_filename("Memories_1.0.5_x64-setup.exe"));
        assert!(!valid_filename("..\\evil.exe"));
        assert!(!valid_filename("setup.bat"));
        assert!(!valid_filename(".exe"));
        assert!(valid_download_path("/api/desktop/win/download"));
        assert!(!valid_download_path("/api/desktop/../admin"));
        assert!(!valid_download_path("https://evil.example/x"));
        assert!(!valid_download_path("//evil.example/api/desktop/x"));
    }
}
