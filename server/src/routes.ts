import { Router, type IRouter } from "express";
import { sim, getLeaderboard } from "./ws";

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

export default router;
