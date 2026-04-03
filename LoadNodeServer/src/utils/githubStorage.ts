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

export function githubRawFileUrl(
    owner: string,
    repo: string,
    branch: string,
    path: string,
): string {
    return `https://github.com/${owner}/${repo}/raw/${branch}/${path}`;
}
