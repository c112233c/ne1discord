import mysql from "mysql2/promise";

export function createDatabase(config) {
  return mysql.createPool({
    ...config, waitForConnections: true, queueLimit: 0, enableKeepAlive: true
  });
}
