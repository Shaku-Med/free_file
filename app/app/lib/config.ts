/** Server-side GitHub settings for API routes / workers only (never import this from client-only code). */
export const config = {
  github: {
    token: process.env.GITHUB_TOKEN || "",
    owner: process.env.GITHUB_OWNER || "",
    /** Default repo for raw.githubusercontent.com (must match Go GITHUB_REPO). */
    repo: (process.env.GITHUB_REPO || "Memories").trim() || "Memories",
  },
};
