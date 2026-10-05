// Builds every logo file the web app ships from the one mark defined below:
// the SVGs, each favicon and app icon at its exact size, and the 1200x630
// share card. Edge or Chrome draws every SVG straight onto a canvas at the
// target size, so small icons stay sharp instead of being shrunk from a big one.
//
//   node scripts/brand/build-brand.mjs
//
// Needs Edge or Chrome (set BRAND_BROWSER to its path if it is somewhere
// unusual) and a network connection for the Inter font used on the share card.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PUBLIC = join(APP, "public");

export const BRAND = {
  green: "#00a85c",
  greenLight: "#1ac375",
  greenDark: "#008141",
  ink: "#09090b",
  muted: "#a1a1aa",
};

// The mark lives on a 512 grid: an M drawn as one rounded stroke, with a play
// triangle under its middle. Memories, and the videos in them.
export const MARK = {
  m: "M116 372 V174 a34 34 0 0 1 55 -27 L256 216 L341 147 a34 34 0 0 1 55 27 V372",
  mStroke: 52,
  play: "M236 282 L236 358 L298 320 Z",
  playStroke: 22,
  tileRadius: 116,
};

function symbol(color, scale = 1) {
  const t = scale === 1 ? "" : ` transform="translate(256 256) scale(${scale}) translate(-256 -256)"`;
  return (
    `<g${t}>` +
    `<path d="${MARK.m}" fill="none" stroke="${color}" stroke-width="${MARK.mStroke}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${MARK.play}" fill="${color}" stroke="${color}" stroke-width="${MARK.playStroke}" stroke-linejoin="round"/>` +
    `</g>`
  );
}

const gradient =
  `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">` +
  `<stop offset="0" stop-color="${BRAND.greenLight}"/><stop offset="1" stop-color="${BRAND.greenDark}"/>` +
  `</linearGradient></defs>`;

/**
 * shape: "tile" (rounded, transparent corners), "full" (square, edge to edge,
 * for platforms that cut their own shape), or "none" (symbol only).
 * scale shrinks the symbol into a platform's safe zone.
 */
function iconSvg({ shape, scale = 1, color = "#fff" }) {
  const bg =
    shape === "tile"
      ? `<rect width="512" height="512" rx="${MARK.tileRadius}" fill="url(#bg)"/>`
      : shape === "full"
        ? `<rect width="512" height="512" fill="url(#bg)"/>`
        : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${bg ? gradient + bg : ""}${symbol(color, scale)}</svg>`;
}

// Safe zones: maskable web icons keep content inside a circle of 80% of the
// width, Android adaptive icons inside 66 of 108dp. The symbol's farthest
// corner sits 214 units from the centre, so these scales keep it inside.
const SCALE_MASKABLE = 0.86;
const SCALE_ADAPTIVE = 0.68;

const tile = iconSvg({ shape: "tile" });
const full = iconSvg({ shape: "full" });
const maskable = iconSvg({ shape: "full", scale: SCALE_MASKABLE });
const adaptiveBackground = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${gradient}<rect width="512" height="512" fill="url(#bg)"/></svg>`;
const adaptiveForeground = iconSvg({ shape: "none", scale: SCALE_ADAPTIVE });
const monochrome = iconSvg({ shape: "none", scale: SCALE_ADAPTIVE });

const outputs = [];
const png = (path, size, svg) => outputs.push({ path, w: size, h: size, svg });

// Web and PWA
png("icons/web/icon-192.png", 192, tile);
png("icons/web/icon-512.png", 512, tile);
png("icons/web/android-chrome-192x192.png", 192, tile);
png("icons/web/android-chrome-512x512.png", 512, tile);
png("icons/web/icon-192-maskable.png", 192, maskable);
png("icons/web/icon-512-maskable.png", 512, maskable);
png("icons/web/apple-touch-icon.png", 180, full);
for (const s of [16, 32, 48]) png(`__ico/${s}.png`, s, tile);

// iOS cuts its own corners and refuses transparency, so these are full squares.
for (const [name, size] of [
  ["AppIcon-20~ipad.png", 20], ["AppIcon-20@2x.png", 40], ["AppIcon-20@2x~ipad.png", 40], ["AppIcon-20@3x.png", 60],
  ["AppIcon-29.png", 29], ["AppIcon-29~ipad.png", 29], ["AppIcon-29@2x.png", 58], ["AppIcon-29@2x~ipad.png", 58], ["AppIcon-29@3x.png", 87],
  ["AppIcon-40~ipad.png", 40], ["AppIcon-40@2x.png", 80], ["AppIcon-40@2x~ipad.png", 80], ["AppIcon-40@3x.png", 120],
  ["AppIcon@2x.png", 120], ["AppIcon@3x.png", 180], ["AppIcon~ipad.png", 76], ["AppIcon@2x~ipad.png", 152],
  ["AppIcon-83.5@2x~ipad.png", 167], ["AppIcon-60@2x~car.png", 120], ["AppIcon-60@3x~car.png", 180],
  ["AppIcon~ios-marketing.png", 1024],
]) png(`icons/ios/${name}`, size, full);

// Android: legacy launcher icons, then the adaptive layers (108dp at each density).
for (const [dpi, legacy, adaptive] of [
  ["mdpi", 48, 108], ["hdpi", 72, 162], ["xhdpi", 96, 216], ["xxhdpi", 144, 324], ["xxxhdpi", 192, 432],
]) {
  const dir = `icons/android/res/mipmap-${dpi}`;
  png(`${dir}/ic_launcher.png`, legacy, tile);
  png(`${dir}/ic_launcher_background.png`, adaptive, adaptiveBackground);
  png(`${dir}/ic_launcher_foreground.png`, adaptive, adaptiveForeground);
  png(`${dir}/ic_launcher_monochrome.png`, adaptive, monochrome);
}
png("icons/android/play_store_512.png", 512, full);

// The share card for Facebook, X and everything else that reads og:image.
outputs.push({ path: "brand/og-image.png", w: 1200, h: 630, card: true });

function renderPage() {
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@500;800&display=block">
</head><body><pre id="out"></pre><script>
const outputs = ${JSON.stringify(outputs.map(({ path, w, h, svg, card }) => ({ path, w, h, svg, card: Boolean(card) })))};
const brand = ${JSON.stringify(BRAND)};
const tileSvg = ${JSON.stringify(tile)};

function loadSvg(svg) {
  return new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = fail;
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
}

async function drawCard(ctx, w, h) {
  ctx.fillStyle = brand.ink;
  ctx.fillRect(0, 0, w, h);
  // A soft green light behind the mark, nothing louder.
  const glow = ctx.createRadialGradient(w * 0.3, h * 0.5, 0, w * 0.3, h * 0.5, w * 0.55);
  glow.addColorStop(0, "rgba(0,168,92,0.28)");
  glow.addColorStop(1, "rgba(0,168,92,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  const mark = 196, gap = 44;
  const title = "Memories";
  const tagline = "Share and keep your photos and videos.";
  const titleFont = "800 120px Inter", tagFont = "500 34px Inter";
  ctx.font = titleFont;
  ctx.letterSpacing = "-4px";
  const titleW = ctx.measureText(title).width;
  ctx.font = tagFont;
  ctx.letterSpacing = "0px";
  const tagW = ctx.measureText(tagline).width;
  // Centre the whole lockup on its widest line so neither runs to an edge.
  const x0 = Math.round((w - (mark + gap + Math.max(titleW, tagW))) / 2);
  const markY = Math.round(h / 2 - mark / 2 - 20);
  const textX = x0 + mark + gap;
  ctx.drawImage(await loadSvg(tileSvg), x0, markY, mark, mark);

  ctx.textBaseline = "alphabetic";
  ctx.font = titleFont;
  ctx.letterSpacing = "-4px";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(title, textX, markY + 124);
  ctx.font = tagFont;
  ctx.letterSpacing = "0px";
  ctx.fillStyle = brand.muted;
  ctx.fillText(tagline, textX + 3, markY + 182);
}

(async () => {
  await document.fonts.load("800 124px Inter");
  await document.fonts.load("500 40px Inter");
  const result = {};
  for (const o of outputs) {
    const c = document.createElement("canvas");
    c.width = o.w; c.height = o.h;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    if (o.card) await drawCard(ctx, o.w, o.h);
    else ctx.drawImage(await loadSvg(o.svg), 0, 0, o.w, o.h);
    result[o.path] = c.toDataURL("image/png");
  }
  document.getElementById("out").textContent = JSON.stringify(result);
})();
</script></body></html>`;
}

function findBrowser() {
  const candidates = [
    process.env.BRAND_BROWSER,
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error("No Edge or Chrome found. Set BRAND_BROWSER to the browser's executable.");
  return found;
}

/** An .ico holding PNG images, which every current browser reads. */
function icoFromPngs(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

function write(rel, data) {
  const path = join(PUBLIC, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-hide_banner", "-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/**
 * The browser's PNG encoder favours speed, so its files run four to six times
 * the size they need to be. ffmpeg re-encodes them losslessly at its highest
 * compression. Without ffmpeg the files are still correct, just bigger.
 */
function compressPng(data, work) {
  if (!hasFfmpeg) return data;
  const src = join(work, "in.png");
  const out = join(work, "out.png");
  writeFileSync(src, data);
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-compression_level", "100", "-pred", "mixed", out]);
  return readFileSync(out);
}

function main() {
  const work = mkdtempSync(join(tmpdir(), "brand-"));
  try {
    const page = join(work, "render.html");
    writeFileSync(page, renderPage());
    const dom = execFileSync(
      findBrowser(),
      [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        `--user-data-dir=${join(work, "profile")}`,
        "--virtual-time-budget=20000",
        "--dump-dom",
        pathToFileURL(page).href,
      ],
      { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
    );
    const json = dom.match(/<pre id="out">([\s\S]*?)<\/pre>/)?.[1];
    if (!json) throw new Error("The browser did not finish rendering.");
    const files = JSON.parse(json.replace(/&quot;/g, '"').replace(/&amp;/g, "&"));

    const ico = [];
    for (const [rel, url] of Object.entries(files)) {
      const data = compressPng(Buffer.from(url.slice(url.indexOf(",") + 1), "base64"), work);
      if (rel.startsWith("__ico/")) ico.push({ size: Number(rel.match(/(\d+)/)[1]), data });
      else write(rel, data);
    }
    ico.sort((a, b) => a.size - b.size);
    const icoData = icoFromPngs(ico);
    write("favicon.ico", icoData);
    write("icons/web/favicon.ico", icoData);

    write("logo.svg", tile);
    write("brand/logo-mark.svg", tile);
    write("brand/logo-mark-mono.svg", iconSvg({ shape: "none" }));

    console.log(`Wrote ${Object.keys(files).length - ico.length} PNGs, favicon.ico (${ico.map((i) => i.size).join(", ")}) and the SVGs.`);
    if (!hasFfmpeg) console.log("ffmpeg was not found, so the PNGs are uncompressed.");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main();
