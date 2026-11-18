const required = [
  "APP_BASE_URL", "SESSION_SECRET", "DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD",
  "KEYCLOAK_ISSUER_URL", "KEYCLOAK_CLIENT_ID", "KEYCLOAK_CLIENT_SECRET", "KEYCLOAK_REDIRECT_URI",
  "DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "DISCORD_REDIRECT_URI",
  "DISCORD_BOT_TOKEN", "DISCORD_GUILD_ID", "DISCORD_VERIFIED_ROLE_ID", "DISCORD_VERIFY_CHANNEL_ID"
];

export function loadConfig(env = process.env) {
  const missing = required.filter((key) => !env[key]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  if (env.SESSION_SECRET.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters");

  const issuer = new URL(env.KEYCLOAK_ISSUER_URL);
  if (issuer.protocol !== "https:" && env.NODE_ENV === "production") {
    throw new Error("KEYCLOAK_ISSUER_URL must use HTTPS in production");
  }

  return Object.freeze({
    nodeEnv: env.NODE_ENV || "development",
    port: Number(env.PORT || 3000),
    trustProxy: Number(env.TRUST_PROXY || 0),
    appBaseUrl: env.APP_BASE_URL.replace(/\/$/, ""),
    sessionSecret: env.SESSION_SECRET,
    database: {
      host: env.DB_HOST, port: Number(env.DB_PORT || 3306), database: env.DB_NAME,
      user: env.DB_USER, password: env.DB_PASSWORD, connectionLimit: Number(env.DB_CONNECTION_LIMIT || 10)
    },
    keycloak: {
      issuerUrl: issuer.toString().replace(/\/$/, ""),
      clientId: env.KEYCLOAK_CLIENT_ID, clientSecret: env.KEYCLOAK_CLIENT_SECRET,
      redirectUri: env.KEYCLOAK_REDIRECT_URI, scopes: env.KEYCLOAK_SCOPES || "openid profile email"
    },
    discord: {
      clientId: env.DISCORD_CLIENT_ID, clientSecret: env.DISCORD_CLIENT_SECRET,
      redirectUri: env.DISCORD_REDIRECT_URI, scopes: env.DISCORD_SCOPES || "identify"
    },
    discordBot: {
      botToken: env.DISCORD_BOT_TOKEN, guildId: env.DISCORD_GUILD_ID,
      verifiedRoleId: env.DISCORD_VERIFIED_ROLE_ID,
      verifyChannelId: env.DISCORD_VERIFY_CHANNEL_ID
    }
  });
}
