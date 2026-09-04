import { copyFile, mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const outputDir = resolve("dist");
const entryPage = resolve(outputDir, "index.html");
const fallbackPage = resolve(outputDir, "404.html");
const staticRoutes = ["maze", "war", "multiplayer", "infinite"];

const entryHtml = await readFile(entryPage, "utf8");

// GitHub Pages serves unknown nested paths through 404.html. Keeping the SPA
// entry there lets direct match URLs such as /multiplayer/:matchId hydrate and
// resolve client-side instead of showing the hosting provider's 404 page.
await copyFile(entryPage, fallbackPage);

const fallbackHtml = await readFile(fallbackPage, "utf8");
if (fallbackHtml !== entryHtml) {
  throw new Error("Static route verification failed for /404.html");
}

for (const route of staticRoutes) {
  const routeDir = resolve(outputDir, route);
  const routePage = resolve(routeDir, "index.html");

  await mkdir(routeDir, { recursive: true });
  await copyFile(entryPage, routePage);

  const routeHtml = await readFile(routePage, "utf8");
  if (routeHtml !== entryHtml) {
    throw new Error(`Static route verification failed for /${route}`);
  }

  console.log(`[static-route] /${route}/ -> ${routePage}`);
}
