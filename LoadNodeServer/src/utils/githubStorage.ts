function missingRepoEnvError(): Error {
    return new Error(
        'Set GITHUB_DEFAULT_REPO and GITHUB_REPO in environment (.env). ' +
            'GITHUB_DEFAULT_REPO = legacy bucket; GITHUB_REPO = active upload target.',
    );
}

export function defaultGithubRepoForStoredFile(): string {
    const legacy = process.env.GITHUB_DEFAULT_REPO?.trim();
    if (legacy) return legacy;
    const primary = process.env.GITHUB_REPO?.trim();
    if (primary) return primary;
    throw missingRepoEnvError();
}

export function defaultGithubRepoForSharedAssets(): string {
    const primary = process.env.GITHUB_REPO?.trim();
    if (primary) return primary;
    const legacy = process.env.GITHUB_DEFAULT_REPO?.trim();
    if (legacy) return legacy;
    throw missingRepoEnvError();
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
