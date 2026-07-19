import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies /api to the local read-only console server so the
// browser only ever talks to localhost. No external requests are made.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    target: "es2022",
  },
});
