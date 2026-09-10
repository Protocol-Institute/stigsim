import { Router, type IRouter } from "express";
import { allowCodeRequest, bearerIdentity, deliverCode, issueCode, normalizeEmail, verifyCode } from "./auth";

export const requireOnlineAuth: IRouter = Router();
requireOnlineAuth.use((req, res, next) => {
  if (!bearerIdentity(req)) return res.status(401).json({ error: "Not signed in" });
  next();
});

const authRouter: IRouter = Router();

authRouter.post("/request-code", (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!email) return res.status(400).json({ error: "Enter a valid email address" });
  if (!allowCodeRequest(req.ip ?? "unknown")) return res.status(429).json({ error: "Too many sign-in attempts. Try again later." });
  try {
    const issued = issueCode(email);
    if (issued.retryAfterMs) return res.status(429).json({ error: "Please wait before requesting another code" });
    void deliverCode(email, issued.code).then(() => {
      res.json({ ok: true, ...(process.env.NODE_ENV !== "production" ? { developmentCode: issued.code } : {}) });
    }).catch(error => {
      console.error("[auth] Failed to send sign-in code", error);
      res.status(503).json({ error: "We could not send a sign-in code" });
    });
  } catch {
    res.status(503).json({ error: "Email authentication is not configured" });
  }
});

authRouter.post("/verify-code", (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const token = email ? verifyCode(email, req.body?.code) : null;
  if (!token) return res.status(401).json({ error: "That code is invalid or has expired" });
  res.json({ token });
});

authRouter.get("/session", (req, res) => {
  const identity = bearerIdentity(req);
  if (!identity) return res.status(401).json({ error: "Not signed in" });
  res.json(identity);
});

export default authRouter;
