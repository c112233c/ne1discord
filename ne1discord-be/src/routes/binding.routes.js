import { Router } from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { getBindingOverview, verifyAccountBinding } from "../services/binding.service.js";

function requireAuthenticated(req, res, next) {
  if (!req.session.authenticated || !req.session.keycloak?.sub || !req.session.discord?.id) {
    return res.status(401).json({ error: "authentication_required" });
  }
  next();
}

function validCsrfToken(expected, supplied) {
  if (typeof expected !== "string" || typeof supplied !== "string") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createBindingRouter({ database, appBaseUrl, profileSync }) {
  const router = Router();
  router.use(requireAuthenticated);

  router.get("/", async (req, res, next) => {
    try {
      req.session.bindingCsrfToken ??= randomBytes(32).toString("base64url");
      const binding = await getBindingOverview(database, req.session.keycloak, req.session.discord);
      res.set("Cache-Control", "no-store");
      res.json({
        identity: {
          userId: req.session.keycloak.userId,
          name: req.session.keycloak.name,
          departmentName: req.session.keycloak.departmentName,
          discordId: req.session.discord.id,
          discordUsername: req.session.discord.username,
          discordGlobalName: req.session.discord.globalName
        },
        csrfToken: req.session.bindingCsrfToken,
        binding
      });
    } catch (error) { next(error); }
  });

  router.post("/verify", async (req, res, next) => {
    try {
      const origin = req.get("origin");
      if (origin && new URL(origin).origin !== new URL(appBaseUrl).origin) {
        return res.status(403).json({ error: "invalid_origin" });
      }
      if (!validCsrfToken(req.session.bindingCsrfToken, req.get("x-csrf-token"))) {
        return res.status(403).json({ error: "invalid_csrf_token" });
      }

      const result = await verifyAccountBinding(database, req.session.keycloak, req.session.discord);
      if (result.status === "conflict") {
        return res.status(409).json({
          error: "discord_account_already_bound",
          message: "This Discord account is already linked to another account."
        });
      }

      try {
        const sync = await profileSync.synchronize(req.session.keycloak, req.session.discord);
        res.status(result.status === "bound" ? 201 : 200).json({
          success: true, status: result.status, accessStatus: "verified",
          synchronization: sync,
          message: "Account linked and Discord profile and roles synchronized successfully."
        });
      } catch (syncError) {
        console.error("[discord-profile-sync]", syncError.code || syncError.status || syncError.message);
        res.status(502).json({
          success: false, status: result.status, accessStatus: "restricted",
          error: syncError.code || "discord_profile_sync_failed",
          message: syncError.code === "discord_member_not_in_guild"
            ? syncError.message
            : "Account is linked, but Discord synchronization failed. Access remains restricted; retry Verify."
        });
      }
    } catch (error) { next(error); }
  });

  return router;
}
