import type { Config } from "@react-router/dev/config";

export default {
  // Config options...
  // Server-side render by default, to enable SPA mode set this to `false`
  ssr: true,
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
