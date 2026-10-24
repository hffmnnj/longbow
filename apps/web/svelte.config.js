import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/**
 * Static single-page app: `adapter-static` with a `fallback` document makes every
 * route client-rendered. The Node server serves `build/` and falls back to
 * `index.html` for non-/api paths. Tailwind's Vite plugin lives in `vite.config.ts`.
 *
 * @type {import('@sveltejs/kit').Config}
 */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      fallback: "index.html",
      pages: "build",
      assets: "build",
      precompress: false,
      strict: true,
    }),
    alias: { $lib: "src/lib" },
    // Registered by hand in lib/pwa.svelte.ts so the update toast can watch the waiting worker.
    serviceWorker: { register: false },
  },
  compilerOptions: {
    // Force runes for project files; node_modules libraries keep their own setting.
    runes: ({ filename }) => (filename.split(/[/\\]/).includes("node_modules") ? undefined : true),
  },
};

export default config;
