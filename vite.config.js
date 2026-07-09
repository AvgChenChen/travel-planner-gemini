import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The proxy forwards any request starting with /api to the Express
// backend on port 3001, so the browser never talks to Anthropic directly.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
