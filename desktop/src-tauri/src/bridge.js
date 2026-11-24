// Runs before every page in the app's site windows. Gives the site the same
// window.memoriesWindapp the Electron preload did, so the site needs no changes.
(() => {
  const ALLOWED_ORIGINS = __ALLOWED_ORIGINS__;
  const PLATFORM = __PLATFORM__;
  // window.origin, not location.origin: a popup's first about:blank page belongs
  // to its opener, and the browser keeps that same window object when the popup
  // moves on to the real page, without running this script again.
  if (!ALLOWED_ORIGINS.includes(window.origin) || window.memoriesWindapp) return;

  const call = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);

  const listeners = { 'window:fullscreen-changed': new Set(), 'media:action': new Set() };
  const subscribe = (name, callback) => {
    if (typeof callback !== 'function') return () => {};
    listeners[name].add(callback);
    return () => listeners[name].delete(callback);
  };
  // The app pushes events by calling this; anything it doesn't know is ignored.
  Object.defineProperty(window, '__memoriesWindappDispatch', {
    value: (name, payload) => {
      const set = listeners[name];
      if (!set) return;
      for (const callback of set) {
        try {
          callback(payload);
        } catch {}
      }
    },
  });

  // Older WebKitGTK builds have no Navigation API, so plain history stands in.
  const go = (direction) => {
    const nav = window.navigation;
    if (!nav) {
      if (direction === 'back') history.back();
      else history.forward();
      return Promise.resolve(true);
    }
    const can = direction === 'back' ? nav.canGoBack : nav.canGoForward;
    if (!can) return Promise.resolve(false);
    const result = direction === 'back' ? nav.back() : nav.forward();
    result?.committed?.catch(() => {});
    result?.finished?.catch(() => {});
    return Promise.resolve(true);
  };

  const flag = (value) => value === true;

  const api = Object.freeze({
    isDesktop: true,
    platform: PLATFORM,
    getVersion: () => call('desktop_get_version'),
    installUpdate: () => call('desktop_install_update'),
    minimize: () => call('window_minimize'),
    maximize: () => call('window_toggle_maximize'),
    close: () => call('window_close'),
    isMaximized: () => call('window_is_maximized'),
    setFullScreen: (on) => call('window_set_fullscreen', { on: on === true }),
    isFullScreen: () => call('window_is_fullscreen'),
    onFullscreenChange: (callback) =>
      subscribe('window:fullscreen-changed', (on) => callback(on === true)),
    goBack: () => go('back'),
    goForward: () => go('forward'),
    reload: () => {
      location.reload();
      return Promise.resolve();
    },
    canGoBack: () =>
      Promise.resolve(window.navigation ? window.navigation.canGoBack === true : history.length > 1),
    canGoForward: () => Promise.resolve(window.navigation?.canGoForward === true),
    setMediaState: (state) => {
      if (!state || typeof state !== 'object') return Promise.resolve(false);
      const progress = Number.isFinite(state.progress) ? state.progress : null;
      return call('media_set_state', {
        state: {
          playing: flag(state.playing),
          canNext: flag(state.canNext),
          canPrevious: flag(state.canPrevious),
          progress,
        },
      });
    },
    clearMediaState: () => call('media_clear'),
    closePip: () => call('pip_close'),
    onMediaAction: (callback) => subscribe('media:action', callback),
  });

  Object.defineProperty(window, 'memoriesWindapp', { value: api, enumerable: true });
  window.__MEMORIES_WINDAPP__ = true;
  window.__MEMORIES_WINDAPP_PLATFORM__ = PLATFORM;
  try {
    sessionStorage.setItem('memories_windapp', '1');
    sessionStorage.setItem('memories_windapp_platform', PLATFORM);
  } catch {}

  const decorate = () => {
    const root = document.documentElement;
    root.classList.add('windapp');
    if (PLATFORM === 'darwin') root.classList.add('windapp-mac');
    if (document.getElementById('windapp-drag-css')) return;
    const style = document.createElement('style');
    style.id = 'windapp-drag-css';
    style.textContent =
      'html.windapp a,html.windapp img,html.windapp picture,html.windapp [href]' +
      '{-webkit-user-drag:none;user-drag:none;}';
    document.head.appendChild(style);
  };
  // Listeners live on window so they outlast that about:blank document.
  window.addEventListener('DOMContentLoaded', decorate);
  if (document.readyState !== 'loading') decorate();

  window.addEventListener(
    'dragstart',
    (event) => {
      if (event.target?.closest?.('a,[href],img,picture')) event.preventDefault();
    },
    true,
  );

  // Electron showed no right click menu. Text fields keep theirs for copy and paste.
  window.addEventListener('contextmenu', (event) => {
    if (event.defaultPrevented) return;
    const target = event.target;
    const editable =
      target instanceof Element &&
      (target.closest('input,textarea,[contenteditable=""],[contenteditable="true"]') !== null);
    if (!editable && !String(window.getSelection?.() ?? '')) event.preventDefault();
  });

  // WebKitGTK ignores the site's app-region CSS, so on Linux the title bar is
  // dragged from here, using the same rules as that CSS. The drag only starts
  // once the mouse moves, so clicks and the site's double click to maximize
  // still reach the page.
  if (PLATFORM === 'linux') {
    const NO_DRAG =
      '.windapp-no-drag,a,button,input,textarea,select,[role="button"],[role="combobox"],' +
      '[data-radix-collection-item],[data-sidebar="trigger"]';
    const inDragRegion = (target) => {
      if (!(target instanceof Element)) return false;
      const region = target.closest('.windapp-drag');
      if (!region) return false;
      const blocker = target.closest(NO_DRAG);
      return !blocker || !region.contains(blocker);
    };

    let pressed = null;
    window.addEventListener(
      'mousedown',
      (event) => {
        pressed = null;
        if (event.button !== 0 || event.detail !== 1 || !inDragRegion(event.target)) return;
        event.preventDefault();
        pressed = { x: event.screenX, y: event.screenY };
      },
      true,
    );
    window.addEventListener(
      'mousemove',
      (event) => {
        if (!pressed) return;
        if ((event.buttons & 1) === 0) {
          pressed = null;
          return;
        }
        if (Math.abs(event.screenX - pressed.x) + Math.abs(event.screenY - pressed.y) < 4) return;
        pressed = null;
        call('window_start_drag').catch(() => {});
      },
      true,
    );
    window.addEventListener('mouseup', () => (pressed = null), true);
    window.addEventListener('blur', () => (pressed = null));
  }
})();
