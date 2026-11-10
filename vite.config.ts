import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const port = Number(process.env.PORT ?? 3000);
const base = process.env.BASE_PATH ?? "/";

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error(`Invalid PORT value: "${process.env.PORT}"`);
}

export default defineConfig({
  base,
  plugins: [react()],
  worker: { format: "es" },
  server: {
    host: "0.0.0.0",
    port,
    strictPort: true,
    proxy: {
      "/api/maze-memory": {
        target: process.env.DEV_MEMORY_API_TARGET ?? "http://127.0.0.1:3016",
        rewrite: path => process.env.DEV_MEMORY_API_TARGET ? path : path.replace(/^\/api\/maze-memory/, "/local-maze-memory"),
        changeOrigin: true,
      },
      "/api": {
        target: process.env.DEV_API_TARGET ?? "http://localhost:3001",
        changeOrigin: true,
        ws: true,
      },
    },
  },
  preview: {
    host: "0.0.0.0",
    port,
    strictPort: true,
  },
});
