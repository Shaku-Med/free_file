/**
 * GitHub raw storage: per-file `github_repo` + env (server-only).
 * Set in .env: GITHUB_REPO = active upload bucket; GITHUB_DEFAULT_REPO = legacy reads when row is null.
 */

function missingRepoEnvError(): Error {
    return new Error(
        'Set GITHUB_DEFAULT_REPO and GITHUB_REPO in environment (server .env). ' +
            'GITHUB_DEFAULT_REPO = legacy bucket for old rows; GITHUB_REPO = current upload target.',
    );
}

/**
 * When `files.github_repo` is null: prefer legacy bucket (matches DB default for old rows).
 */
export function defaultGithubRepoForStoredFile(): string {
    const legacy = process.env.GITHUB_DEFAULT_REPO?.trim();
    if (legacy) return legacy;
    const primary = process.env.GITHUB_REPO?.trim();
    if (primary) return primary;
    throw missingRepoEnvError();
}

/**
 * Paths not tied to a file row (e.g. comment-images/): use the active upload repo first.
 */
export function defaultGithubRepoForSharedAssets(): string {
    const primary = process.env.GITHUB_REPO?.trim();
    if (primary) return primary;
    const legacy = process.env.GITHUB_DEFAULT_REPO?.trim();
    if (legacy) return legacy;
    throw missingRepoEnvError();
}

/** @deprecated Use defaultGithubRepoForStoredFile or defaultGithubRepoForSharedAssets */
export function defaultGithubRepo(): string {
    return defaultGithubRepoForStoredFile();
}

export function defaultGithubBranch(): string {
    const b = process.env.GITHUB_BRANCH?.trim();
    if (b) return b;
    return 'main';
}

export function resolveGithubRepoForFile(
    file: { github_repo?: string | null } | null | undefined,
): string {
    const fromRow = file?.github_repo?.trim();
    if (fromRow) return fromRow;
    return defaultGithubRepoForStoredFile();
}

/** Paths like `02_04_2026/<unique_id>/comments/<file>.png` (Go `commentimg` handler). */
const VIDEO_FOLDER_COMMENT_PATH_RE = /^\d{2}_\d{2}_\d{4}\/[^/]+\/comments\//;

export function isVideoFolderCommentAttachmentPath(storagePath: string): boolean {
    return VIDEO_FOLDER_COMMENT_PATH_RE.test(storagePath);
}

/**
 * Repos to try for video-folder comment images. Go always uploads to `GITHUB_REPO`, so that must be tried
 * before `files.github_repo` (often stale after a repo migration). Then comment row, file row, legacy.
 */
export function githubReposToTryForVideoCommentAttachment(
    file: { github_repo?: string | null } | null | undefined,
    commentImageGithubRepo?: string | null | undefined,
): string[] {
    const out: string[] = [];
    const add = (r: string | undefined) => {
        const t = r?.trim();
        if (t && !out.includes(t)) out.push(t);
    };
    add(process.env.GITHUB_REPO?.trim());
    add(commentImageGithubRepo ?? undefined);
    add(file?.github_repo ?? undefined);
    add(process.env.GITHUB_DEFAULT_REPO?.trim());
    if (out.length === 0) throw missingRepoEnvError();
    return out;
}

export function githubRawFileUrl(
    owner: string,
    repo: string,
    branch: string,
    path: string,
): string {
    return `https://github.com/${owner}/${repo}/raw/${branch}/${path}`;
}

/** Remove server-only storage field before sending file rows to the browser. */
export function stripGithubRepoForClient<T extends Record<string, unknown>>(
    row: T,
): Omit<T, 'github_repo'> {
    const { github_repo: _omit, ...rest } = row as T & { github_repo?: unknown };
    return rest as Omit<T, 'github_repo'>;
}

/** Remove server-only comment image storage field before sending comment rows to the browser. */
export function stripCommentImageGithubRepoForClient<T extends Record<string, unknown>>(
    row: T,
): Omit<T, 'image_github_repo'> {
    const { image_github_repo: _omit, ...rest } = row as T & { image_github_repo?: unknown };
    return rest as Omit<T, 'image_github_repo'>;
}
