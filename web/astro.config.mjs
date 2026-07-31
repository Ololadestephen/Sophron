import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import icon from "astro-icon";

const deploymentHost =
  process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
const site =
  process.env.SITE_URL ??
  (deploymentHost ? `https://${deploymentHost}` : "http://localhost:4321");

export default defineConfig({
  site,
  vite: { plugins: [tailwindcss()] },
  integrations: [icon()],
});
