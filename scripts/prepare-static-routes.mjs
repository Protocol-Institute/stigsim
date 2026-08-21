import { copyFile, mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const outputDir = resolve("dist");
const entryPage = resolve(outputDir, "index.html");
const staticRoutes = ["infinite"];

const entryHtml = await readFile(entryPage, "utf8");

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
