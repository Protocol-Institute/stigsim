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
  server: {
    host: "0.0.0.0",
    port,
    strictPort: true,
  },
  preview: {
    host: "0.0.0.0",
    port,
    strictPort: true,
  },
});
