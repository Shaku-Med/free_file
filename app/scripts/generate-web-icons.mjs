/**
 * Generates public/favicon.ico and public/icons/web/*.png from public/logo.svg.
 * Run: npm run generate-icons
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import toIco from "to-ico";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const publicDir = path.join(root, "public");
const svgPath = path.join(publicDir, "logo.svg");
const webIconsDir = path.join(publicDir, "icons", "web");

if (!fs.existsSync(svgPath)) {
  console.error("Missing", svgPath);
  process.exit(1);
}
fs.mkdirSync(webIconsDir, { recursive: true });

const png = (size) =>
  sharp(svgPath)
    .resize(size, size, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png();

await png(192).toFile(path.join(webIconsDir, "icon-192.png"));
await png(512).toFile(path.join(webIconsDir, "icon-512.png"));
await png(192).toFile(path.join(webIconsDir, "icon-192-maskable.png"));
await png(512).toFile(path.join(webIconsDir, "icon-512-maskable.png"));
await png(180).toFile(path.join(webIconsDir, "apple-touch-icon.png"));

const buf16 = await png(16).toBuffer();
const buf32 = await png(32).toBuffer();
const buf48 = await png(48).toBuffer();
const icoBuffer = await toIco([buf16, buf32, buf48]);
fs.writeFileSync(path.join(publicDir, "favicon.ico"), icoBuffer);

console.log("Wrote favicon.ico and icons/web/*.png from logo.svg");
