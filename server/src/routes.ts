import { Router, type IRouter } from "express";
import { sim, getLeaderboard } from "./ws";
import authRouter, { requireOnlineAuth } from "./auth-router";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

router.use("/auth", authRouter);

router.get("/infinite/export", requireOnlineAuth, (_req, res) => {
  res.json(sim.serializeInit());
});

router.get("/infinite/leaderboard", requireOnlineAuth, (_req, res) => {
  void getLeaderboard().then(entries => res.json(entries)).catch(e => {
    res.status(500).json({ error: String(e) });
  });
});

export default router;
