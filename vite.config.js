import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // GitHub Pages serves this repo at /gsc2026-problem-interest-form/, so
  // assets must be prefixed to match. A bare "/" here makes the built
  // index.html request /assets/... from the domain root, which 404s on a
  // project page. This MUST track the repo name — renaming the repo without
  // changing this breaks the deployed site. Set to "/" for a custom domain.
  base: "/gsc2026-problem-interest-form/",
});
