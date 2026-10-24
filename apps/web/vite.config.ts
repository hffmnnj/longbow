import tailwindcss from "@tailwindcss/vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vitest/config";

const API_TARGET = "http://127.0.0.1:4520";

export default defineConfig({
  // `@tailwindcss/vite` MUST come before `sveltekit()`: reversing the order breaks
  // Tailwind processing of styles inside `.svelte` files.
  plugins: [tailwindcss(), sveltekit()],
  server: {
    host: "127.0.0.1",
    port: 5210,
    strictPort: true,
    proxy: {
      // SSE needs no buffering; plain proxying keeps it streaming.
      "/api": { target: API_TARGET, changeOrigin: false },
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
