(function () {
  'use strict';
  if (window.__memoriesTvNav) return;
  window.__memoriesTvNav = true;

  var FOCUS_CLASS = 'tv-focus';
  var SELECTOR = [
    'a[href]',
    'button',
    'input',
    'select',
    'textarea',
    'video',
    '[role="button"]',
    '[role="link"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  var style = document.createElement('style');
  style.textContent =
    '.' + FOCUS_CLASS + '{' +
    'outline:3px solid var(--ring,#fff)!important;' +
    'outline-offset:2px!important;' +
    'border-radius:inherit;' +
    'transition:outline-offset 120ms ease;' +
    'z-index:2;}' +
    ':focus{scroll-margin:96px;}';
  document.documentElement.appendChild(style);

  var lastFocused = null;

  function isVisible(el) {
    if (!el || el.disabled || el.getAttribute('aria-hidden') === 'true') return false;
    var rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return false;
    if (rect.bottom < -200 || rect.top > innerHeight + 200) return false;
    if (rect.right < 0 || rect.left > innerWidth) return false;
    var cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) !== 0;
  }

  function candidates() {
    var out = [];
    var nodes = document.querySelectorAll(SELECTOR);
    for (var i = 0; i < nodes.length; i++) {
      if (isVisible(nodes[i])) out.push(nodes[i]);
    }
    return out;
  }

  function centerOf(el) {
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, rect: r };
  }

  function currentTarget() {
    var ae = document.activeElement;
    if (ae && ae !== document.body && ae !== document.documentElement && isVisible(ae)) return ae;
    if (lastFocused && isVisible(lastFocused)) return lastFocused;
    return null;
  }

  function setFocus(el) {
    if (!el) return;
    if (lastFocused && lastFocused !== el) lastFocused.classList.remove(FOCUS_CLASS);
    lastFocused = el;
    el.classList.add(FOCUS_CLASS);
    try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (e2) {} }
    try { el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' }); } catch (e) {}
  }

  function move(dir) {
    var from = currentTarget();
    var all = candidates();
    if (!from) {
      var best = null, bestScore = Infinity;
      for (var i = 0; i < all.length; i++) {
        var c = centerOf(all[i]);
        var s = c.y * 2 + c.x;
        if (c.rect.top >= 0 && s < bestScore) { bestScore = s; best = all[i]; }
      }
      if (best) setFocus(best);
      return Boolean(best);
    }

    var fc = centerOf(from);
    var target = null, targetScore = Infinity;
    for (var j = 0; j < all.length; j++) {
      var el = all[j];
      if (el === from || from.contains(el) || el.contains(from)) continue;
      var c2 = centerOf(el);
      var dx = c2.x - fc.x;
      var dy = c2.y - fc.y;
      var primary, ortho;
      if (dir === 'left') { primary = -dx; ortho = Math.abs(dy); }
      else if (dir === 'right') { primary = dx; ortho = Math.abs(dy); }
      else if (dir === 'up') { primary = -dy; ortho = Math.abs(dx); }
      else { primary = dy; ortho = Math.abs(dx); }
      if (primary < 8) continue;
      var score = primary + ortho * 2.5;
      if (score < targetScore) { targetScore = score; target = el; }
    }

    if (target) {
      setFocus(target);
      return true;
    }
    var step = Math.round(innerHeight * 0.6);
    if (dir === 'down') scrollBy({ top: step, behavior: 'smooth' });
    else if (dir === 'up') scrollBy({ top: -step, behavior: 'smooth' });
    return dir === 'down' || dir === 'up';
  }

  function isEditable(el) {
    if (!el) return false;
    var tag = (el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
  }

  var KEYS = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };

  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented) return;

    var dir = KEYS[e.keyCode];
    var active = document.activeElement;

    if (isEditable(active) && (dir === 'left' || dir === 'right' || !dir)) return;
    if (active && (active.tagName === 'VIDEO' || document.fullscreenElement)) return;

    if (dir) {
      if (move(dir)) e.preventDefault();
      return;
    }

    if (e.keyCode === 13) {
      var el = currentTarget();
      if (!el) return;
      var tag = el.tagName;
      if (tag !== 'A' && tag !== 'BUTTON' && tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') {
        el.click();
        e.preventDefault();
      }
    }
  });

  window.__memoriesTvMedia = function (action) {
    var video = document.querySelector('video');
    if (!video) return;
    if (action === 'toggle') {
      if (video.paused) video.play(); else video.pause();
    } else if (action === 'forward') {
      video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10);
    } else if (action === 'rewind') {
      video.currentTime = Math.max(0, video.currentTime - 10);
    }
  };
})();
