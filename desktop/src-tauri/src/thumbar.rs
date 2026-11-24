// Previous, play/pause and next buttons under the taskbar thumbnail, like the
// Electron app's thumbar. Everything here runs on the main thread.

use std::cell::{Cell, RefCell};
use std::sync::OnceLock;

use serde_json::Value;
use tauri::{AppHandle, Manager, WebviewWindow};
use windows::core::w;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
use windows::Win32::UI::Shell::{
    DefSubclassProc, ITaskbarList3, RemoveWindowSubclass, SetWindowSubclass, TaskbarList, THUMBBUTTON,
    THBF_DISABLED, THBF_ENABLED, THBF_HIDDEN, THBN_CLICKED, THB_FLAGS, THB_ICON, THB_TOOLTIP,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateIconFromResourceEx, PostMessageW, RegisterWindowMessageW, HICON, LR_DEFAULTCOLOR, WM_COMMAND,
    WM_NCDESTROY,
};

use crate::{dispatch, MAIN};

const SUBCLASS_ID: usize = 0x4d4d_5442;
const PREVIOUS: u32 = 1;
const PLAY_PAUSE: u32 = 2;
const NEXT: u32 = 3;

#[derive(Clone, Copy, Default)]
struct Media {
    visible: bool,
    playing: bool,
    can_previous: bool,
    can_next: bool,
}

struct Bar {
    taskbar: ITaskbarList3,
    hwnd: HWND,
    previous: HICON,
    play: HICON,
    pause: HICON,
    next: HICON,
    added: bool,
    media: Media,
}

thread_local! {
    static BAR: RefCell<Option<Bar>> = const { RefCell::new(None) };
    static BUTTON_CREATED: Cell<u32> = const { Cell::new(0) };
    static APPLY: Cell<u32> = const { Cell::new(0) };
}

static APP: OnceLock<AppHandle> = OnceLock::new();

// Never hold the borrow across a COM call: the call can pump messages and land
// back in the subclass procedure below.
fn with_bar<T>(f: impl FnOnce(&mut Bar) -> T) -> Option<T> {
    BAR.with(|bar| bar.try_borrow_mut().ok().and_then(|mut bar| bar.as_mut().map(f)))
}

fn icon(png: &[u8]) -> windows::core::Result<HICON> {
    unsafe { CreateIconFromResourceEx(png, true, 0x0003_0000, 16, 16, LR_DEFAULTCOLOR) }
}

pub fn install(window: &WebviewWindow) {
    let _ = APP.set(window.app_handle().clone());
    let Ok(hwnd) = window.hwnd() else { return };
    let created = unsafe {
        let taskbar: windows::core::Result<ITaskbarList3> = CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER);
        let Ok(taskbar) = taskbar else { return };
        if taskbar.HrInit().is_err() {
            return;
        }
        let icons = (
            icon(include_bytes!("../icons/thumbar/prev.png")),
            icon(include_bytes!("../icons/thumbar/play.png")),
            icon(include_bytes!("../icons/thumbar/pause.png")),
            icon(include_bytes!("../icons/thumbar/next.png")),
        );
        let (Ok(previous), Ok(play), Ok(pause), Ok(next)) = icons else { return };
        BAR.with(|bar| {
            *bar.borrow_mut() = Some(Bar {
                taskbar,
                hwnd,
                previous,
                play,
                pause,
                next,
                added: false,
                media: Media::default(),
            })
        });
        BUTTON_CREATED.set(RegisterWindowMessageW(w!("TaskbarButtonCreated")));
        APPLY.set(RegisterWindowMessageW(w!("MemoriesThumbBarApply")));
        SetWindowSubclass(hwnd, Some(subclass), SUBCLASS_ID, 0)
    };
    if !created.as_bool() {
        BAR.with(|bar| bar.borrow_mut().take());
    }
}

pub fn show(window: &WebviewWindow, playing: bool, can_previous: bool, can_next: bool) {
    update(window, Media { visible: true, playing, can_previous, can_next });
}

pub fn hide(window: &WebviewWindow) {
    update(window, Media::default());
}

fn update(window: &WebviewWindow, media: Media) {
    let _ = window.run_on_main_thread(move || {
        if let Some(hwnd) = with_bar(|bar| {
            bar.media = media;
            bar.hwnd
        }) {
            schedule(hwnd);
        }
    });
}

// Applied from the message loop, never from inside another message.
fn schedule(hwnd: HWND) {
    let _ = unsafe { PostMessageW(Some(hwnd), APPLY.get(), WPARAM(0), LPARAM(0)) };
}

fn tip(text: &str) -> [u16; 260] {
    let mut out = [0u16; 260];
    for (slot, unit) in out.iter_mut().zip(text.encode_utf16().take(259)) {
        *slot = unit;
    }
    out
}

fn button(id: u32, icon: HICON, label: &str, enabled: bool, visible: bool) -> THUMBBUTTON {
    THUMBBUTTON {
        dwMask: THB_ICON | THB_TOOLTIP | THB_FLAGS,
        iId: id,
        iBitmap: 0,
        hIcon: icon,
        szTip: tip(label),
        dwFlags: if !visible {
            THBF_HIDDEN
        } else if enabled {
            THBF_ENABLED
        } else {
            THBF_DISABLED
        },
    }
}

fn apply() {
    let Some((taskbar, hwnd, added, buttons)) = with_bar(|bar| {
        let m = bar.media;
        let (toggle, label) = if m.playing { (bar.pause, "Pause") } else { (bar.play, "Play") };
        let buttons = [
            button(PREVIOUS, bar.previous, "Previous", m.can_previous, m.visible),
            button(PLAY_PAUSE, toggle, label, true, m.visible),
            button(NEXT, bar.next, "Next", m.can_next, m.visible),
        ];
        (bar.taskbar.clone(), bar.hwnd, bar.added, buttons)
    }) else {
        return;
    };
    if !added && buttons.iter().all(|b| b.dwFlags == THBF_HIDDEN) {
        return;
    }
    let result = unsafe {
        if added {
            taskbar.ThumbBarUpdateButtons(hwnd, &buttons)
        } else {
            taskbar.ThumbBarAddButtons(hwnd, &buttons)
        }
    };
    if result.is_ok() && !added {
        with_bar(|bar| bar.added = true);
    }
}

fn clicked(id: u32) {
    let playing = with_bar(|bar| bar.media.playing).unwrap_or(false);
    let action = match id {
        PREVIOUS => "previoustrack",
        PLAY_PAUSE if playing => "pause",
        PLAY_PAUSE => "play",
        NEXT => "nexttrack",
        _ => return,
    };
    let Some(app) = APP.get().cloned() else { return };
    std::thread::spawn(move || {
        if let Some(main) = app.get_webview_window(MAIN) {
            dispatch(&main, "media:action", Value::String(action.into()));
        }
    });
}

unsafe extern "system" fn subclass(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    id: usize,
    _data: usize,
) -> LRESULT {
    if msg == WM_COMMAND && ((wparam.0 >> 16) & 0xffff) as u32 == THBN_CLICKED {
        clicked((wparam.0 & 0xffff) as u32);
        return LRESULT(0);
    }
    if msg != 0 && msg == APPLY.get() {
        apply();
        return LRESULT(0);
    }
    if msg != 0 && msg == BUTTON_CREATED.get() {
        // Explorer made (or remade) the taskbar button, so the buttons are gone.
        with_bar(|bar| bar.added = false);
        schedule(hwnd);
    }
    if msg == WM_NCDESTROY {
        let _ = unsafe { RemoveWindowSubclass(hwnd, Some(subclass), id) };
        BAR.with(|bar| {
            if let Ok(mut bar) = bar.try_borrow_mut() {
                bar.take();
            }
        });
    }
    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}
