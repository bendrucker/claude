import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://bendrucker.github.io",
  base: "/claude",
  output: "static",
  vite: {
    plugins: [tailwindcss()],
  },
});
