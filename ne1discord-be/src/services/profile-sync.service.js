import { createDiscordBotService } from "./discord-bot.service.js";

export function createProfileSyncService({ config, database, discordBot = createDiscordBotService(config.discordBot, database) }) {
  async function synchronize(keycloak, discord) {
    const result = await discordBot.synchronizeMember({
      discordId: discord.id,
      userId: keycloak.userId,
      name: keycloak.name,
      departmentName: keycloak.departmentName
    });

    const connection = await database.getConnection();
    try {
      await connection.beginTransaction();
      const [updateResult] = await connection.execute(
        `UPDATE account_bindings
            SET access_status = 'verified', verified_at = CURRENT_TIMESTAMP(3)
          WHERE keycloak_sub = ? AND discord_id = ? AND binding_status = 'active'`,
        [keycloak.sub, discord.id]
      );
      if (updateResult.affectedRows !== 1) {
        throw new Error("Active account binding was not found after Discord synchronization");
      }
      await connection.execute(
        `INSERT INTO account_binding_audit_logs
          (actor_keycloak_sub, actor_discord_id, action, target_discord_id, details)
         VALUES (?, ?, 'profile_role_synced', ?, ?)`,
        [keycloak.sub, discord.id, discord.id, JSON.stringify(result)]
      );
      await connection.commit();
      return result;
    } catch (error) {
      try { await connection.rollback(); } catch { /* transaction may already be closed */ }
      throw error;
    } finally {
      connection.release();
    }
  }

  return { synchronize };
}
