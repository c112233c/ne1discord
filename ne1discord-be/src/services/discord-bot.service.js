import { createHash } from "node:crypto";

const DISCORD_API = "https://discord.com/api/v10";
const VERIFY_MESSAGE_MARKER = "ne1discord:verification-entrypoint";

export function buildDiscordNickname(userId, name) {
  const prefix = userId ? String(userId) : "";
  const suffix = name ? String(name) : "";
  if (!prefix) throw new Error("Keycloak user_id is required for Discord nickname");
  if (prefix.length > 32) throw new Error("Keycloak user_id exceeds Discord's 32-character nickname limit");
  if (!suffix || prefix.length === 32) return prefix;
  const available = 32 - prefix.length - 3;
  return `${prefix} - ${suffix.slice(0, Math.max(0, available))}`;
}

export function createDiscordBotService(config, database, fetchImpl = fetch) {
  const { botToken, guildId, verifiedRoleId } = config;
  const headers = {
    authorization: `Bot ${botToken}`,
    accept: "application/json",
    "content-type": "application/json"
  };

  async function request(path, options = {}) {
    const response = await fetchImpl(`${DISCORD_API}${path}`, {
      ...options,
      headers: { ...headers, ...(options.headers || {}) },
      signal: AbortSignal.timeout(10000)
    });
    if (response.status === 204) return null;
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(`Discord API failed: HTTP ${response.status} (${payload.message || "unknown error"})`);
      error.status = response.status;
      error.discordCode = payload.code;
      throw error;
    }
    return payload;
  }

  async function ensureVerificationMessage({ channelId, appBaseUrl }) {
    if (!channelId) throw new Error("Discord verification channel ID is required");
    const baseUrl = new URL(appBaseUrl);
    if (baseUrl.protocol !== "https:" && baseUrl.hostname !== "localhost") {
      throw new Error("APP_BASE_URL must use HTTPS for the Discord verification link");
    }
    const messages = await request(`/channels/${channelId}/messages?limit=100`);
    const existing = messages.find((message) =>
      message.author?.bot && message.embeds?.some((embed) => embed.footer?.text === VERIFY_MESSAGE_MARKER)
    );
    if (existing) {
      return { created: false, messageId: existing.id };
    }

    const message = await request(`/channels/${channelId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        embeds: [{
          title: "ยินดีต้อนรับสู่ Discord Server",
          description: "กรุณายืนยันตัวตนก่อนเข้าใช้งานระบบ โดยเข้าสู่ระบบผ่านบัญชี Keycloak OMD",
          color: 0x5865F2,
          footer: { text: VERIFY_MESSAGE_MARKER }
        }],
        components: [{
          type: 1,
          components: [{
            type: 2,
            style: 5,
            label: "Login with Keycloak",
            url: new URL("/auth/keycloak", baseUrl).toString()
          }]
        }]
      })
    });
    return { created: true, messageId: message.id };
  }

  async function getDepartmentRoleId(departmentName) {
    if (typeof departmentName !== "string" || !departmentName.trim()) {
      throw new Error("Keycloak departname is required");
    }
    if (departmentName.length > 100) throw new Error("Keycloak departname exceeds Discord's 100-character role name limit");

    const lockName = `ne1discord:${createHash("sha256").update(`${guildId}:${departmentName}`).digest("hex").slice(0, 48)}`;
    const connection = await database.getConnection();
    let locked = false;
    try {
      const [lockRows] = await connection.execute("SELECT GET_LOCK(?, 10) AS acquired", [lockName]);
      locked = Number(lockRows[0]?.acquired) === 1;
      if (!locked) throw new Error("Timed out waiting for department role synchronization lock");

      const roles = await request(`/guilds/${guildId}/roles`);
      let role = roles.find((item) => item.name === departmentName);
      if (role?.id === verifiedRoleId) {
        throw new Error("Keycloak departname matches the protected Verified role name; refusing to use it as a department role");
      }
      if (!role) {
        role = await request(`/guilds/${guildId}/roles`, {
          method: "POST",
          body: JSON.stringify({
            name: departmentName, permissions: "0", color: 0,
            hoist: true, mentionable: false
          })
        });
      } else if (String(role.permissions ?? "0") !== "0") {
        await request(`/guilds/${guildId}/roles/${role.id}`, {
          method: "PATCH", body: JSON.stringify({ permissions: "0" })
        });
      }

      await connection.execute(
        `INSERT INTO discord_department_roles (guild_id, department_name, role_id)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE role_id = VALUES(role_id), updated_at = CURRENT_TIMESTAMP(3)`,
        [guildId, departmentName, role.id]
      );
      return role.id;
    } finally {
      if (locked) {
        try { await connection.execute("SELECT RELEASE_LOCK(?)", [lockName]); } catch { /* connection cleanup */ }
      }
      connection.release();
    }
  }

  async function synchronizeMember({ discordId, userId, name, departmentName }) {
    try {
      const member = await request(`/guilds/${guildId}/members/${discordId}`);
      if (!member?.user?.id) throw new Error("Discord guild member response is invalid");
    } catch (error) {
      if (error.status === 404) {
        const missing = new Error("Discord account is not a member of the configured server. Join the server and retry Verify.");
        missing.code = "discord_member_not_in_guild";
        throw missing;
      }
      throw error;
    }

    const departmentRoleId = await getDepartmentRoleId(departmentName);
    const nickname = buildDiscordNickname(userId, name);
    await request(`/guilds/${guildId}/members/${discordId}`, {
      method: "PATCH", body: JSON.stringify({ nick: nickname })
    });
    await request(`/guilds/${guildId}/members/${discordId}/roles/${departmentRoleId}`, { method: "PUT" });
    await request(`/guilds/${guildId}/members/${discordId}/roles/${verifiedRoleId}`, { method: "PUT" });
    return { nickname, departmentRoleId, verifiedRoleId };
  }

  return { synchronizeMember, getDepartmentRoleId, ensureVerificationMessage };
}
