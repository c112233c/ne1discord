function mapBinding(row) {
  return {
    discordId: row.discord_id,
    discordUsername: row.discord_username,
    discordGlobalName: row.discord_global_name,
    bindingStatus: row.binding_status,
    accessStatus: row.access_status,
    verifiedAt: row.verified_at
  };
}

export async function getBindingOverview(database, keycloak, discord) {
  const [linkedRows] = await database.execute(
    `SELECT discord_id, discord_username, discord_global_name,
            binding_status, access_status, verified_at
       FROM account_bindings
      WHERE keycloak_sub = ? AND binding_status = 'active'
      ORDER BY created_at ASC`,
    [keycloak.sub]
  );

  const [discordRows] = await database.execute(
    `SELECT keycloak_sub, binding_status, access_status, verified_at
       FROM account_bindings WHERE discord_id = ? LIMIT 1`,
    [discord.id]
  );

  const existing = discordRows[0] ?? null;
  let currentStatus = "unbound";
  let currentAccessStatus = "restricted";
  let currentVerifiedAt = null;

  if (existing?.keycloak_sub !== undefined) {
    if (existing.keycloak_sub !== keycloak.sub && existing.binding_status === "active") {
      currentStatus = "conflict";
    } else if (existing.keycloak_sub === keycloak.sub && existing.binding_status === "active") {
      currentStatus = "active";
      currentAccessStatus = existing.access_status;
      currentVerifiedAt = existing.verified_at;
    }
  }

  return {
    status: currentStatus,
    accessStatus: currentAccessStatus,
    verifiedAt: currentVerifiedAt,
    linkedAccounts: linkedRows.map(mapBinding)
  };
}

export async function verifyAccountBinding(database, keycloak, discord) {
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.execute(
      `SELECT id, keycloak_sub, binding_status
         FROM account_bindings WHERE discord_id = ? LIMIT 1 FOR UPDATE`,
      [discord.id]
    );
    const existing = rows[0] ?? null;

    if (existing?.binding_status === "active") {
      if (existing.keycloak_sub !== keycloak.sub) {
        await connection.rollback();
        return { status: "conflict" };
      }
      await connection.commit();
      return { status: "already_bound" };
    }

    if (existing) {
      await connection.execute(
        `UPDATE account_bindings
            SET keycloak_sub = ?, user_id = ?, display_name = ?,
                discord_username = ?, discord_global_name = ?,
                binding_status = 'active', access_status = 'restricted',
                verified_at = CURRENT_TIMESTAMP(3)
          WHERE id = ?`,
        [keycloak.sub, keycloak.userId ?? null, keycloak.name ?? null,
          discord.username, discord.globalName ?? null, existing.id]
      );
    } else {
      await connection.execute(
        `INSERT INTO account_bindings
          (keycloak_sub, user_id, display_name, discord_id, discord_username,
           discord_global_name, binding_status, access_status, verified_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', 'restricted', CURRENT_TIMESTAMP(3))`,
        [keycloak.sub, keycloak.userId ?? null, keycloak.name ?? null,
          discord.id, discord.username, discord.globalName ?? null]
      );
    }

    await connection.execute(
      `INSERT INTO account_binding_audit_logs
        (actor_keycloak_sub, actor_discord_id, action, target_discord_id, details)
       VALUES (?, ?, 'account_bound', ?, ?)`,
      [keycloak.sub, discord.id, discord.id, JSON.stringify({
        userId: keycloak.userId ?? null,
        discordUsername: discord.username
      })]
    );

    await connection.commit();
    return { status: "bound" };
  } catch (error) {
    try { await connection.rollback(); } catch { /* transaction may already be closed */ }
    if (error.code === "ER_DUP_ENTRY") return { status: "conflict" };
    throw error;
  } finally {
    connection.release();
  }
}
