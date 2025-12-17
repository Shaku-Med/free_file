import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

import { config } from "dotenv";
config()

export default defineConfig(({mode}) => {
  // const env = loadEnv(mode, process.cwd(), '');
  // console.log(env);
  return {
    plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
    server: {
      port: 3000,
      host: true,
      headers: {
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Opener-Policy': 'same-origin',
      },
      allowedHosts: ['localhost', 'memories.brozy.org'],
      cors: true,
    },
    build: {
      rollupOptions: {
        external: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
      }
    },
    ssr: {
      noExternal: [],
      external: ['bullmq']
    }
  }
});
