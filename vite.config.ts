import react from "@vitejs/plugin-react";
import { defineConfig, type ProxyOptions } from "vite";

const localMemory = process.env.MAZE_MEMORY_LOCAL === "1";
const memoryProxy: Record<string, ProxyOptions> = localMemory
  ? { "/local-maze-memory": { target: "http://127.0.0.1:3016" } }
  : {};
const port = Number(process.env.PORT ?? 3000);
const base = process.env.BASE_PATH ?? "/";

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error(`Invalid PORT value: "${process.env.PORT}"`);
}

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    host: localMemory ? "127.0.0.1" : "0.0.0.0",
    port,
    strictPort: true,
    proxy: {
      ...memoryProxy,
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
        ws: true,
      },
    },
  },
  preview: {
    proxy: memoryProxy,
    host: localMemory ? "127.0.0.1" : "0.0.0.0",
    port,
    strictPort: true,
  },
});
