const form = document.getElementById("form");
const fileInput = document.getElementById("file");
const browse = document.getElementById("browse");
const statusEl = document.getElementById("status");
const hintEl = document.getElementById("hint");
const resultsEl = document.getElementById("results");

let maxMb = 60;

function setStatus(html, kind = "") {
  statusEl.className = `status ${kind}`.trim();
  statusEl.innerHTML = html;
}

/** Everything from the server is treated as text, never markup. */
function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = String(text);
  return n;
}

async function boot() {
  try {
    const r = await fetch("/api/health");
    const h = await r.json();
    maxMb = h.max_upload_mb ?? maxMb;
    hintEl.textContent = `mp3, m4a, flac, ogg, opus, wav  ·  up to ${maxMb}MB  ·  first ${h.fingerprint_seconds}s fingerprinted`;
    const problems = [];
    if (!h.api_key_set) problems.push("no ACOUSTID_API_KEY in .env");
    if (!h.fpcalc_found) problems.push("fpcalc not found on PATH");
    if (problems.length) setStatus(`Not ready: ${problems.join(" · ")}`, "bad");
    else setStatus("Ready.", "good");
  } catch {
    setStatus("Backend is not running. Start it with: python script/app.py", "bad");
  }
}

function secs(n) {
  if (!Number.isFinite(n)) return "";
  const m = Math.floor(n / 60);
  return `${m}:${String(Math.round(n % 60)).padStart(2, "0")}`;
}

function render(data) {
  resultsEl.hidden = false;
  resultsEl.replaceChildren();

  const meta = el(
    "div",
    "meta",
    `${data.filename}  ·  ${secs(data.duration)}  ·  fingerprinted the first ${data.fingerprinted_seconds}s  ·  ${data.match_count} match${data.match_count === 1 ? "" : "es"}`,
  );
  resultsEl.append(meta);

  if (!data.matches.length) {
    resultsEl.append(
      el(
        "div",
        "empty",
        "No match. AcoustID only knows recordings people have submitted, so covers, live versions, remixes and anything unreleased usually come back empty.",
      ),
    );
    return;
  }

  for (const m of data.matches) {
    const card = el("div", "card");

    if (m.cover_art) {
      const img = el("img", "art");
      img.src = m.cover_art;
      img.alt = "";
      img.loading = "lazy";
      // The archive can 404 after the HEAD check; fall back rather than show a
      // broken image.
      img.onerror = () => img.replaceWith(el("div", "art placeholder", "no art"));
      card.append(img);
    } else {
      card.append(el("div", "art placeholder", "no art"));
    }

    const info = el("div", "info");
    info.append(el("p", "title", m.title));
    info.append(el("p", "artist", m.artists));
    if (m.album) info.append(el("p", "album", m.album));
    card.append(info);

    const right = el("div", "right");
    right.append(el("span", "score", `${Math.round(m.score * 100)}%`));
    if (m.musicbrainz_url) {
      const a = el("a", "mb", "MusicBrainz");
      a.href = m.musicbrainz_url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      right.append(a);
    }
    card.append(right);

    resultsEl.append(card);
  }
}

async function submit(file) {
  if (!file) return;
  if (file.size > maxMb * 1024 * 1024) {
    setStatus(`That file is ${(file.size / 1048576).toFixed(1)}MB, over the ${maxMb}MB limit.`, "bad");
    return;
  }

  form.classList.add("busy");
  setStatus('<span class="spinner"></span>Fingerprinting and looking it up…');
  resultsEl.hidden = true;

  const body = new FormData();
  body.append("file", file);
  try {
    const res = await fetch("/api/identify", { method: "POST", body });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setStatus(data.error || `Failed (HTTP ${res.status})`, "bad");
      return;
    }
    setStatus(data.match_count ? "Done." : "Done, nothing matched.", data.match_count ? "good" : "");
    render(data);
  } catch (e) {
    setStatus(`Request failed: ${e instanceof Error ? e.message : e}`, "bad");
  } finally {
    form.classList.remove("busy");
  }
}

browse.addEventListener("click", (e) => {
  e.stopPropagation();
  fileInput.click();
});
form.addEventListener("click", () => fileInput.click());
form.addEventListener("submit", (e) => e.preventDefault());
fileInput.addEventListener("change", () => submit(fileInput.files?.[0]));

for (const type of ["dragenter", "dragover"]) {
  form.addEventListener(type, (e) => {
    e.preventDefault();
    form.classList.add("over");
  });
}
for (const type of ["dragleave", "drop"]) {
  form.addEventListener(type, (e) => {
    e.preventDefault();
    form.classList.remove("over");
  });
}
form.addEventListener("drop", (e) => submit(e.dataTransfer?.files?.[0]));

boot();
