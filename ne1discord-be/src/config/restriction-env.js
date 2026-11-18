const required = [
  "DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD",
  "DISCORD_BOT_TOKEN", "DISCORD_GUILD_ID", "DISCORD_VERIFIED_ROLE_ID"
];

export function loadRestrictionConfig(env = process.env) {
  const missing = required.filter((key) => !env[key]);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  return Object.freeze({
    database: {
      host: env.DB_HOST,
      port: Number(env.DB_PORT || 3306),
      database: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      connectionLimit: Number(env.DB_CONNECTION_LIMIT || 3)
    },
    discordBot: {
      botToken: env.DISCORD_BOT_TOKEN,
      guildId: env.DISCORD_GUILD_ID,
      verifiedRoleId: env.DISCORD_VERIFIED_ROLE_ID
    }
  });
}
