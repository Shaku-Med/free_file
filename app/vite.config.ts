import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

import { config } from "dotenv";
config()

export default defineConfig(({mode}) => {
  let isProduction = mode === 'production';
  const serverOnlyModules = [
    'bullmq',
    'ioredis',
    'web-push',
    'worker_threads',
    'child_process',
    'fs',
    'fs/promises',
    'path',
    'crypto',
    'http',
    'https',
    'net',
    'tls',
    'stream',
    'util',
    'os',
    'dns',
    'assert',
    'url',
    'events',
    'canvas',
    'sharp',
  ];

  let addedModules = isProduction ? {
    build: {
      rollupOptions: {
        external: (id: string) => {
          if (serverOnlyModules.some(mod => id === mod || id.startsWith(`${mod}/`))) return true;
          if (id.startsWith('node:') || ['fs', 'path', 'crypto', 'stream', 'util', 'events', 'url', 'net', 'tls', 'dns', 'os', 'assert', 'child_process', 'worker_threads'].includes(id)) return true;
          return false;
        },
      }
    },
    ssr: {
      noExternal: [],
      external: serverOnlyModules
    },
    optimizeDeps: {
      exclude: serverOnlyModules
    },
    resolve: {
      alias: serverOnlyModules.reduce((acc, mod) => {
        acc[mod] = mod;
        return acc;
      }, {} as Record<string, string>)
    }
  } : {};

  return {
    plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
    ...addedModules,
    server: {
      port: 3000,
      host: true,
      headers: {
        // 'Cross-Origin-Embedder-Policy': 'require-corp',
        // 'Cross-Origin-Opener-Policy': 'same-origin',
        // disable iframeing 
        'X-Frame-Options': 'DENY',
        'X-Content-Type-Options': 'nosniff',
        'X-XSS-Protection': '1; mode=block',
      },
      allowedHosts: ['localhost', 'memories.brozy.org'],
      cors: true,
    },
  }
});
