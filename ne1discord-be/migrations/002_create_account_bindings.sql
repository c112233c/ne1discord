CREATE TABLE IF NOT EXISTS account_bindings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  keycloak_sub VARCHAR(255) NOT NULL,
  user_id VARCHAR(100) NULL,
  display_name VARCHAR(255) NULL,
  discord_id VARCHAR(32) NOT NULL,
  discord_username VARCHAR(100) NOT NULL,
  discord_global_name VARCHAR(100) NULL,
  binding_status ENUM('active', 'unlinked') NOT NULL DEFAULT 'active',
  access_status ENUM('verified', 'restricted') NOT NULL DEFAULT 'restricted',
  verified_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_account_bindings_discord_id (discord_id),
  KEY idx_account_bindings_keycloak_sub (keycloak_sub),
  KEY idx_account_bindings_status (binding_status, access_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS account_binding_audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_keycloak_sub VARCHAR(255) NOT NULL,
  actor_discord_id VARCHAR(32) NOT NULL,
  action VARCHAR(40) NOT NULL,
  target_discord_id VARCHAR(32) NOT NULL,
  details JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_binding_audit_actor (actor_keycloak_sub, created_at),
  KEY idx_binding_audit_target (target_discord_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
