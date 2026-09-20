import type { Config } from "@react-router/dev/config";

export default {
  // Config options...
  // Server-side render by default, to enable SPA mode set this to `false`
  ssr: true,
  /**
   * Hosts allowed to submit actions to UI routes.
   *
   * React Router 7.18 started refusing document mutations whose `origin`
   * header does not match `request.url`. Behind Cloudflare the browser sends
   * `https://memories.brozy.org` while the origin server is reached over plain
   * http, so every form POST, login and logout included, came back as a bare
   * 400 Bad Request. Naming the hosts here is the documented escape hatch for
   * proxied deployments. Dev is unaffected: there the two already match.
   */
  allowedActionOrigins: ["memories.brozy.org", "uploads.memories.brozy.org"],
  future: {
    v8_middleware: true, // 👈 Enable V8 middleware
    // Build-time-only chunk splitting (loader/action/component load separately).
    // Low risk: no runtime behavior change, just better caching. Safe on v7.
    v8_splitRouteModules: true,
    // The remaining v8 flags change runtime behavior and need testing before
    // enabling on this app  intentionally left off for now:
    //   v8_viteEnvironmentApi          custom vite.config.ts (manualChunks/ssr.external)
    //   v8_passThroughRequests         heavy raw Request/cookie handling in loaders/actions
    //   v8_trailingSlashAwareDataRequests  CDN/custom-host data-request URLs
  },
} satisfies Config;
