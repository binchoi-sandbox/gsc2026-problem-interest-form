import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // GitHub Pages serves this repo at /gs-sg-form/, so assets must be
  // prefixed to match. A bare "/" here makes the built index.html request
  // /assets/... from the domain root, which 404s on a project page.
  // Change this if the repo is renamed, or set it to "/" for a custom domain.
  base: "/gs-sg-form/",
});
