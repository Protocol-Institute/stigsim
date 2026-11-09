import { Router, type IRouter } from "express";
import { memoryRequestHandler } from "../../scripts/maze-memory-server";
import { providerConfig } from "../../scripts/maze-memory-provider";
import { previewAccess, previewEnabled } from "./model-ant-preview-access";

// Mounted only by the isolated preview host; ordinary production has no route.
export function mazeMemoryPreviewRouter(env = process.env, request: typeof fetch = fetch): IRouter {
  const router = Router();
  router.use((_req, res, next) => {
    if (!previewEnabled(env)) { res.status(403).json({ error: "Protected preview is disabled." }); return; }
    next();
  });
  router.use(previewAccess(env.MODEL_ANT_PREVIEW_PASSWORD ?? ""));
  const handler = memoryRequestHandler(providerConfig(env), request, req => {
    if (!req.headers.origin) return true;
    const origin = new URL(req.headers.origin);
    return origin.host === req.headers.host &&
      (origin.protocol === "https:" ||
        (origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)));
  });
  router.use((req, res) => { void handler(req, res); });
  return router;
}
