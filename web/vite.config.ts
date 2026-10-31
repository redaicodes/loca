import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: { fs: { allow: [".."] } },
  build: { outDir: "dist", emptyOutDir: true },
});
