import { Router } from "express";
import { createKeycloakAuthorizationUrl, completeKeycloakLogin } from "../services/keycloak.service.js";
import { createDiscordAuthorizationUrl, completeDiscordLogin } from "../services/discord.service.js";

export function createAuthRouter(config) {
  const router = Router();

  router.get("/keycloak", async (req, res, next) => {
    try {
      res.redirect(await createKeycloakAuthorizationUrl(config.keycloak, req.session));
    } catch (error) { next(error); }
  });

  router.get("/keycloak/callback", async (req, res, next) => {
    try {
      if (req.query.error) throw new Error(`Keycloak authorization failed: ${String(req.query.error)}`);
      if (typeof req.query.code !== "string" || typeof req.query.state !== "string") {
        return res.status(400).json({ error: "invalid_callback", message: "Missing authorization code or state" });
      }
      const identity = await completeKeycloakLogin(config.keycloak, req.session, req.query.code, req.query.state);
      req.session.keycloak = identity;
      req.session.save((error) => {
        if (error) return next(error);
        res.redirect("/auth/discord");
      });
    } catch (error) { next(error); }
  });

  router.get("/discord", (req, res, next) => {
    if (!req.session.keycloak?.sub) {
      return res.status(401).json({ error: "keycloak_login_required", message: "Login with Keycloak first at /auth/keycloak" });
    }
    try { res.redirect(createDiscordAuthorizationUrl(config.discord, req.session)); }
    catch (error) { next(error); }
  });

  router.get("/discord/callback", async (req, res, next) => {
    try {
      if (req.query.error) throw new Error(`Discord authorization failed: ${String(req.query.error)}`);
      if (typeof req.query.code !== "string" || typeof req.query.state !== "string") {
        return res.status(400).json({ error: "invalid_callback", message: "Missing authorization code or state" });
      }
      const discord = await completeDiscordLogin(config.discord, req.session, req.query.code, req.query.state);
      const keycloak = req.session.keycloak;
      if (!keycloak?.sub) return res.status(401).json({ error: "keycloak_session_missing" });

      req.session.regenerate((error) => {
        if (error) return next(error);
        req.session.authenticated = true;
        req.session.keycloak = keycloak;
        req.session.discord = discord;
        req.session.verifiedAt = new Date().toISOString();
        req.session.save((saveError) => {
          if (saveError) return next(saveError);
          res.redirect("/verify");
        });
      });
    } catch (error) { next(error); }
  });

  router.post("/logout", (req, res, next) => {
    req.session.destroy((error) => {
      if (error) return next(error);
      res.clearCookie("ne1discord.sid");
      res.status(204).end();
    });
  });

  return router;
}
