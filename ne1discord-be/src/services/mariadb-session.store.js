import session from "express-session";

export class MariaDbSessionStore extends session.Store {
  constructor(database) {
    super();
    this.database = database;
  }

  async initialize() {
    // The schema is provisioned by migrations; the runtime account needs DML only.
    await this.database.execute("SELECT session_id FROM http_sessions LIMIT 0");
    await this.database.execute("DELETE FROM http_sessions WHERE expires <= ?", [Date.now()]);
  }

  get(sid, callback) {
    this.database.execute("SELECT session_data FROM http_sessions WHERE session_id = ? AND expires > ? LIMIT 1", [sid, Date.now()])
      .then(([rows]) => callback(null, rows.length ? JSON.parse(rows[0].session_data) : null))
      .catch(callback);
  }

  set(sid, value, callback = () => {}) {
    const expires = value.cookie?.expires ? new Date(value.cookie.expires).getTime() : Date.now() + 8 * 60 * 60 * 1000;
    this.database.execute("INSERT INTO http_sessions (session_id, expires, session_data) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE expires = VALUES(expires), session_data = VALUES(session_data)", [sid, expires, JSON.stringify(value)])
      .then(() => callback(null)).catch(callback);
  }

  destroy(sid, callback = () => {}) {
    this.database.execute("DELETE FROM http_sessions WHERE session_id = ?", [sid])
      .then(() => callback(null)).catch(callback);
  }

  touch(sid, value, callback = () => {}) {
    const expires = value.cookie?.expires ? new Date(value.cookie.expires).getTime() : Date.now() + 8 * 60 * 60 * 1000;
    this.database.execute("UPDATE http_sessions SET expires = ? WHERE session_id = ?", [expires, sid])
      .then(() => callback(null)).catch(callback);
  }
}
