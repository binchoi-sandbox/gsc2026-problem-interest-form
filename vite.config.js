import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // IMPORTANT for GitHub Pages: set to "/<repo-name>/" before deploying,
  // e.g. base: "/gs-sg-interest-form/". Leave "/" for local dev or custom domain.
  base: "/",
});
