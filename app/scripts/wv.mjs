#!/usr/bin/env node
/**
 * npm run wv — publish a desktop build to GitHub Releases + desktop_versions (dev only).
 *
 * Flow:
 *  1. Platform (Windows | Mac)
 *  2. Version
 *  3. Confirm use of GITHUB_WV_* from .env (values not printed)
 *  4. Local installer path
 *  5. Upload to GitHub Release (progress bar)
 *  6. Upsert DB row (endpoint = relative path, not full URL)
 *
 * Env: GITHUB_WV_TOKEN, GITHUB_WV_OWNER, GITHUB_WV_REPO,
 *      SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY)
 */
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { Octokit } from '@octokit/rest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env');
loadDotenv({ path: envPath, override: false });

// Dev-only unless WV_ALLOW_PROD=1 (escape hatch for CI).
if (process.env.NODE_ENV === 'production' && process.env.WV_ALLOW_PROD !== '1') {
  console.error('npm run wv only works in development (NODE_ENV is production).');
  console.error('Set WV_ALLOW_PROD=1 if you really mean to run it in production.');
  process.exit(1);
}

const GITHUB_WV_TOKEN = (process.env.GITHUB_WV_TOKEN || '').trim();
const GITHUB_WV_OWNER = (process.env.GITHUB_WV_OWNER || '').trim();
const GITHUB_WV_REPO = (process.env.GITHUB_WV_REPO || '').trim();
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_KEY = (
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  ''
).trim();

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

const missingGithub = [
  !GITHUB_WV_TOKEN && 'GITHUB_WV_TOKEN',
  !GITHUB_WV_OWNER && 'GITHUB_WV_OWNER',
  !GITHUB_WV_REPO && 'GITHUB_WV_REPO',
].filter(Boolean);
if (missingGithub.length) {
  fail(
    `Missing in ${envPath}: ${missingGithub.join(', ')}\n` +
      '  Add them to free_file/app/.env (see .env.example).\n' +
      '  Use a PAT with access to the private releases repo (Contents + Releases).'
  );
}
if (!SUPABASE_URL || !SUPABASE_KEY) {
  fail('Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) in .env');
}

const rl = createInterface({ input, output });
const octokit = new Octokit({ auth: GITHUB_WV_TOKEN });
const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

function ask(q, def) {
  const hint = def != null && def !== '' ? ` [${def}]` : '';
  return rl.question(`${q}${hint}: `).then((a) => {
    const t = a.trim();
    return t || (def ?? '');
  });
}

function drawProgress(ratio, label = '') {
  const width = 28;
  const pct = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(width * pct);
  const bar = `${'#'.repeat(filled)}${'-'.repeat(width - filled)}`;
  const pctLabel = `${Math.round(pct * 100)}%`.padStart(4);
  process.stdout.write(`\r  [${bar}] ${pctLabel} ${label}`.slice(0, 100));
}

function safeFilename(name) {
  return path.basename(name).replace(/[^\w.\-()+ ]+/g, '_');
}

function platformSlug(choice) {
  const c = choice.toLowerCase();
  if (c.startsWith('w')) return 'windows';
  if (c.startsWith('m')) return 'mac';
  if (c.startsWith('l')) return 'linux';
  return null;
}

function releaseTagFor(platform, version) {
  const v = version.replace(/^v/i, '');
  return `desktop-${platform}-v${v}`;
}

function endpointFor(platform, version, filename) {
  const v = version.replace(/^v/i, '');
  return `desktop/${platform}/${v}/${filename}`;
}

async function ensureRelease(tag, version, platform) {
  try {
    const { data } = await octokit.rest.repos.getReleaseByTag({
      owner: GITHUB_WV_OWNER,
      repo: GITHUB_WV_REPO,
      tag,
    });
    return data;
  } catch (e) {
    if (e.status !== 404) throw e;
  }
  const { data } = await octokit.rest.repos.createRelease({
    owner: GITHUB_WV_OWNER,
    repo: GITHUB_WV_REPO,
    tag_name: tag,
    name: `Desktop ${platform} ${version}`,
    body: `Memories desktop build for ${platform} (${version}).`,
    draft: false,
    prerelease: false,
  });
  return data;
}

/**
 * Upload (or replace) a release asset with a simple progress bar.
 * Uses the GitHub uploads host + Content-Length so we can track bytes written.
 */
async function uploadAssetWithProgress(release, filePath, filename) {
  const existing = release.assets?.find((a) => a.name === filename);
  if (existing) {
    process.stdout.write(`  Replacing existing asset ${filename}…\n`);
    await octokit.rest.repos.deleteReleaseAsset({
      owner: GITHUB_WV_OWNER,
      repo: GITHUB_WV_REPO,
      asset_id: existing.id,
    });
  }

  const stat = await fsp.stat(filePath);
  const total = stat.size;
  const uploadUrl = release.upload_url.replace(/\{[^}]+\}$/, '');
  const url = `${uploadUrl}?name=${encodeURIComponent(filename)}`;

  await new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${GITHUB_WV_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/octet-stream',
          'Content-Length': total,
          'User-Agent': 'Memories-wv-cli',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          process.stdout.write('\n');
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(Buffer.concat(chunks).toString('utf8'));
          } else {
            reject(
              new Error(
                `Upload failed (${res.statusCode}): ${Buffer.concat(chunks).toString('utf8').slice(0, 400)}`,
              ),
            );
          }
        });
      },
    );
    req.on('error', reject);

    let sent = 0;
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => {
      sent += chunk.length;
      drawProgress(sent / total, filename);
    });
    stream.on('error', reject);
    stream.pipe(req);
  });
}

async function upsertVersionRow(row) {
  const { data, error } = await db.rpc('publish_desktop_version', {
    p_platform: row.platform,
    p_version: row.version,
    p_endpoint: row.endpoint,
    p_github_repo: row.github_repo,
    p_release_tag: row.release_tag,
    p_filename: row.filename,
    p_notes: row.notes ?? null,
  });
  if (error) throw new Error(`DB publish failed: ${error.message}`);
  return data;
}

async function main() {
  console.log('\nMemories desktop publish (wv)\n');

  const platformAns = await ask('Device (Windows | Mac)', 'Windows');
  const platform = platformSlug(platformAns);
  if (!platform || (platform !== 'windows' && platform !== 'mac')) {
    fail('Pick Windows or Mac');
  }

  const version = (await ask('Version number', '1.0.0')).replace(/^v/i, '');
  if (!/^\d+\.\d+\.\d+/.test(version)) {
    fail('Version should look like 1.0.0');
  }

  const repoConfirm = await ask('Publish using GITHUB_WV_* from .env? (Y/n)', 'Y');
  if (repoConfirm && !/^y(es)?$/i.test(repoConfirm)) {
    fail('Aborted — change GITHUB_WV_* in .env if you need another target');
  }

  const filePathRaw = await ask('Path to the installer file');
  const filePath = path.resolve(filePathRaw.replace(/^["']|["']$/g, ''));
  try {
    const st = await fsp.stat(filePath);
    if (!st.isFile()) fail('Path is not a file');
  } catch {
    fail(`File not found: ${filePath}`);
  }

  const filename = safeFilename(path.basename(filePath));
  const tag = releaseTagFor(platform, version);
  const endpoint = endpointFor(platform, version, filename);

  console.log('\nPlan:');
  console.log(`  platform:     ${platform}`);
  console.log(`  version:      ${version}`);
  console.log(`  release_tag:  ${tag}`);
  console.log(`  endpoint:     ${endpoint}`);
  console.log(`  filename:     ${filename}`);
  console.log(`  file:         ${filePath}`);

  const go = await ask('\nUpload now? (Y/n)', 'Y');
  if (go && !/^y(es)?$/i.test(go)) {
    console.log('Cancelled.');
    rl.close();
    return;
  }

  process.stdout.write('\nCreating / loading GitHub release…\n');
  const release = await ensureRelease(tag, version, platform);

  process.stdout.write('Uploading asset…\n');
  await uploadAssetWithProgress(release, filePath, filename);

  process.stdout.write('Updating database…\n');
  await upsertVersionRow({
    platform,
    version,
    endpoint,
    github_repo: GITHUB_WV_REPO,
    release_tag: tag,
    filename,
    active: true,
    notes: null,
  });

  console.log('\n✓ Ready');
  console.log(`  Active ${platform} build is ${version}`);
  console.log(
    `  Desktop will check /api/desktop/version and download /api/desktop/${platform === 'windows' ? 'win' : 'mac'}/download`,
  );
  rl.close();
}

main().catch((e) => {
  console.error('\n✗', e?.message || e);
  rl.close();
  process.exit(1);
});
