import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: path.resolve(__dirname, "../internal/frontend/dist"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": process.env.BACKEND_URL || "http://127.0.0.1:18888",
      // share-link landing pages live at /s/<code>; let the SPA dev server
      // handle them so visitors can paste a real share URL during dev.
    },
  },
});
