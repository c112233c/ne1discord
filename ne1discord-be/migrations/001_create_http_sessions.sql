CREATE TABLE IF NOT EXISTS http_sessions (
  session_id VARCHAR(128) NOT NULL,
  expires BIGINT UNSIGNED NOT NULL,
  session_data MEDIUMTEXT NOT NULL,
  PRIMARY KEY (session_id),
  KEY idx_http_sessions_expires (expires)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
