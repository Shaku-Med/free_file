#!/usr/bin/env node
/**
 * Generates VAPID keys for Web Push notifications and writes them
 * to .env.notification.  If the file already exists with valid keys
 * the script leaves them untouched so subscriptions stay valid.
 *
 * Run:  node scripts/generate-vapid-keys.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.resolve(__dirname, "..", ".env.notification");

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, "utf-8");
  const vars = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

function writeEnvFile(filePath, vars) {
  const header = [
    "# ===========================================",
    "# Push Notification VAPID Keys (auto-generated)",
    "# ===========================================",
    "# These keys are used for Web Push (RFC 8291).",
    "# Do NOT commit this file to version control.",
    "# Regenerating keys will invalidate all existing",
    "# push subscriptions for your users.",
    "#",
  ].join("\n");

  const body = Object.entries(vars)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  fs.writeFileSync(filePath, `${header}\n\n${body}\n`, "utf-8");
}

async function main() {
  const existing = parseEnvFile(ENV_FILE);
  const hasPublic = existing.VAPID_PUBLIC_KEY && existing.VAPID_PUBLIC_KEY.length > 10;
  const hasPrivate = existing.VAPID_PRIVATE_KEY && existing.VAPID_PRIVATE_KEY.length > 10;

  if (hasPublic && hasPrivate) {
    console.log("[vapid] .env.notification already has VAPID keys — skipping generation.");
    return;
  }

  console.log("[vapid] Generating new VAPID key pair...");
  const webpush = (await import("web-push")).default ?? (await import("web-push"));
  const { publicKey, privateKey } = webpush.generateVAPIDKeys();

  existing.VAPID_PUBLIC_KEY = publicKey;
  existing.VAPID_PRIVATE_KEY = privateKey;

  writeEnvFile(ENV_FILE, existing);
  console.log("[vapid] VAPID keys written to .env.notification");
}

main().catch((err) => {
  console.error("[vapid] Failed to generate keys:", err);
  process.exit(1);
});
