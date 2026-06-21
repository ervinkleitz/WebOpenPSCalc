import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// Allows importing the repo-root CHANGELOG.md (?raw) from outside this
// project's own directory -- this frontend lives two levels under the
// actual repo root.
const repoRoot = path.resolve(__dirname, "../..");

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
    fs: {
      allow: [repoRoot],
    },
  },
});
