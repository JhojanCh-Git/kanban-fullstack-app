import { Router } from "express";
import { getAuth } from "../../lib/auth-context.js";

export function meRouter(): Router {
  const router = Router();

  router.get("/", (req, res) => {
    const { userId, email } = getAuth(req);
    res.json({ id: userId, email: email ?? null });
  });

  return router;
}
