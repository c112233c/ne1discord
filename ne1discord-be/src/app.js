import express from "express";
import session from "express-session";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { fileURLToPath } from "node:url";
import { createAuthRouter } from "./routes/auth.routes.js";
import { createBindingRouter } from "./routes/binding.routes.js";
import { createHealthRouter } from "./routes/health.routes.js";
import { MariaDbSessionStore } from "./services/mariadb-session.store.js";
import { createProfileSyncService } from "./services/profile-sync.service.js";
import { createMetricsService } from "./services/metrics.service.js";

const publicDirectory = fileURLToPath(new URL("../public", import.meta.url));

export async function createApp({ config, database }) {
  const app = express();
  const sessionStore = new MariaDbSessionStore(database);
  await sessionStore.initialize();

  if (config.trustProxy > 0) app.set("trust proxy", config.trustProxy);
  app.disable("x-powered-by");
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        // HTTP test environments must not upgrade local resources to HTTPS.
        // Keep the directive enabled when the app is served over HTTPS in production.
        upgradeInsecureRequests: config.nodeEnv === "production" ? [] : null
      }
    }
  }));
  const metrics = createMetricsService();
  app.use(metrics.middleware);
  app.get("/metrics", metrics.handler);

  app.use(express.json({ limit: "32kb" }));
  app.use(rateLimit({
    windowMs: 60 * 1000, limit: 60,
    standardHeaders: "draft-8", legacyHeaders: false
  }));
  app.use(session({
    name: "ne1discord.sid", secret: config.sessionSecret, store: sessionStore,
    resave: false, saveUninitialized: false,
    cookie: {
      httpOnly: true, secure: config.nodeEnv === "production",
      sameSite: "lax", maxAge: 8 * 60 * 60 * 1000
    }
  }));

  app.use(express.static(publicDirectory, { index: false }));
  app.use(createHealthRouter(database));
  app.use("/auth", createAuthRouter(config));
  const profileSync = createProfileSyncService({ config, database });
  app.use("/api/binding", createBindingRouter({ database, appBaseUrl: config.appBaseUrl, profileSync }));

  app.get("/verify", (_req, res) => res.sendFile(fileURLToPath(new URL("../public/verify.html", import.meta.url))));

  app.get("/api/me", (req, res) => {
    if (!req.session.authenticated) return res.status(401).json({ authenticated: false });
    res.json({
      authenticated: true, keycloak: req.session.keycloak,
      discord: req.session.discord, verifiedAt: req.session.verifiedAt
    });
  });

  app.use((error, _req, res, _next) => {
    console.error("[request-error]", error.message);
    res.status(500).json({ error: "authentication_failed", message: "Request failed" });
  });

  return { app, sessionStore };
}
