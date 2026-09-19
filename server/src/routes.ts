import { Router, type IRouter } from "express";
import { sim, getLeaderboard } from "./ws";
import { getWarResearchRecord } from "./war";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

router.get("/infinite/export", (_req, res) => {
  res.json(sim.serializeInit());
});

router.get("/infinite/leaderboard", (_req, res) => {
  void getLeaderboard().then(entries => res.json(entries)).catch(e => {
    res.status(500).json({ error: String(e) });
  });
});

router.get("/war/records/:recordId", (req, res) => {
  void getWarResearchRecord(req.params.recordId).then(record => {
    if (!record) return res.status(404).json({ error: "Research record not found" });
    res.set("Cache-Control", "private, max-age=300");
    return res.json(record);
  }).catch(e => {
    console.warn("[war] Failed to serve research record", e);
    res.status(500).json({ error: "Could not load research record" });
  });
});

export default router;
