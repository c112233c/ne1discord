import { Router } from "express";

export function createHealthRouter(database) {
  const router = Router();
  const live = (_req, res) => res.json({
    status: "ok",
    timestamp: new Date().toISOString()
  });
  const ready = async (_req, res) => {
    try {
      await database.query("SELECT 1");
      res.json({
        status: "ok",
        database: "ok",
        timestamp: new Date().toISOString()
      });
    } catch {
      res.status(503).json({
        status: "degraded",
        database: "unavailable",
        timestamp: new Date().toISOString()
      });
    }
  };

  router.get("/live", live);
  router.get(["/ready", "/health"], ready);
  return router;
}
