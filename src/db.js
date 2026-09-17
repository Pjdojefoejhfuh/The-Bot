import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@libsql/client";
import bcrypt from "bcrypt";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Charge le .env situé à la racine du projet
dotenv.config({
  path: path.join(__dirname, "../.env"),
});

const url = process.env.TURSO_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

console.log("[DB] .env path:", path.join(__dirname, "../.env"));
console.log("[DB] TURSO_URL:", url ? "OK" : "MISSING");
console.log("[DB] TURSO_AUTH_TOKEN:", authToken ? "OK" : "MISSING");

if (!url || !authToken) {
  console.error("[ERROR] TURSO_URL ou TURSO_AUTH_TOKEN manquant dans .env");
  process.exit(1);
}

const db = createClient({
  url,
  authToken,
});

async function initSchema() {
  await db.batch(
    [
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'user',
        api_key TEXT UNIQUE,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        last_login INTEGER,
        obfuscation_count INTEGER DEFAULT 0,
        theme TEXT DEFAULT 'dark',
        default_vm INTEGER DEFAULT 1,
        default_strings INTEGER DEFAULT 1,
        default_flow INTEGER DEFAULT 1,
        default_max INTEGER DEFAULT 1,
        webhook_url TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        action TEXT NOT NULL,
        details TEXT,
        ip TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY(user_id) REFERENCES users(id)
      )`,
      `CREATE TABLE IF NOT EXISTS obfuscations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        filename TEXT,
        input_size INTEGER,
        output_size INTEGER,
        options TEXT,
        success INTEGER DEFAULT 1,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY(user_id) REFERENCES users(id)
      )`,
    ],
    "write"
  );
}

await initSchema();

export async function createUser(username, email, password) {
  const hash = bcrypt.hashSync(password, 10);

  const apiKey =
    "so_" +
    Math.random().toString(36).slice(2, 18) +
    Math.random().toString(36).slice(2, 18);

  try {
    const result = await db.execute({
      sql: "INSERT INTO users (username, email, password_hash, api_key) VALUES (?, ?, ?, ?)",
      args: [username, email, hash, apiKey],
    });

    return {
      id: Number(result.lastInsertRowid),
      username,
      email,
      apiKey,
    };
  } catch (e) {
    if (e.message && e.message.includes("UNIQUE")) {
      return {
        error: "Username or email already exists",
      };
    }

    throw e;
  }
}

export async function loginUser(username, password) {
  const result = await db.execute({
    sql: "SELECT * FROM users WHERE username = ?",
    args: [username],
  });

  const user = result.rows[0];

  if (!user) {
    return {
      error: "Invalid credentials",
    };
  }

  if (!bcrypt.compareSync(password, user.password_hash)) {
    return {
      error: "Invalid credentials",
    };
  }

  await db.execute({
    sql: "UPDATE users SET last_login = strftime('%s','now') WHERE id = ?",
    args: [user.id],
  });

  return {
    id: Number(user.id),
    username: user.username,
    role: user.role,
    apiKey: user.api_key,
  };
}

export async function getUserById(id) {
  const result = await db.execute({
    sql: `SELECT
      id,
      username,
      email,
      role,
      api_key,
      created_at,
      last_login,
      obfuscation_count,
      theme,
      default_vm,
      default_strings,
      default_flow,
      default_max,
      webhook_url
      FROM users
      WHERE id = ?`,
    args: [id],
  });

  return result.rows[0] || null;
}

export async function getUserByApiKey(key) {
  const result = await db.execute({
    sql: "SELECT * FROM users WHERE api_key = ?",
    args: [key],
  });

  return result.rows[0] || null;
}

export async function logAction(userId, action, details, ip) {
  await db.execute({
    sql: "INSERT INTO logs (user_id, action, details, ip) VALUES (?, ?, ?, ?)",
    args: [
      userId,
      action,
      JSON.stringify(details || {}),
      ip || null,
    ],
  });
}

export async function getLogs(userId = null, limit = 100) {
  if (userId) {
    const result = await db.execute({
      sql: "SELECT * FROM logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
      args: [userId, limit],
    });

    return result.rows;
  }

  const result = await db.execute({
    sql: "SELECT * FROM logs ORDER BY created_at DESC LIMIT ?",
    args: [limit],
  });

  return result.rows;
}

export async function updateUser(id, fields) {
  const allowed = [
    "theme",
    "default_vm",
    "default_strings",
    "default_flow",
    "default_max",
    "webhook_url",
    "password_hash",
  ];

  const keys = Object.keys(fields).filter((k) =>
    allowed.includes(k)
  );

  if (keys.length === 0) return;

  const sets = keys
    .map((k) => `${k} = ?`)
    .join(", ");

  const values = keys.map((k) => fields[k]);

  values.push(id);

  await db.execute({
    sql: `UPDATE users SET ${sets} WHERE id = ?`,
    args: values,
  });
}

export async function recordObfuscation(
  userId,
  filename,
  inputSize,
  outputSize,
  options,
  success
) {
  await db.batch(
    [
      {
        sql: "INSERT INTO obfuscations (user_id, filename, input_size, output_size, options, success) VALUES (?, ?, ?, ?, ?, ?)",
        args: [
          userId,
          filename,
          inputSize,
          outputSize,
          JSON.stringify(options || {}),
          success ? 1 : 0,
        ],
      },
      {
        sql: "UPDATE users SET obfuscation_count = obfuscation_count + 1 WHERE id = ?",
        args: [userId],
      },
    ],
    "write"
  );
}

export async function getUserObfuscations(
  userId,
  limit = 50
) {
  const result = await db.execute({
    sql: "SELECT * FROM obfuscations WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
    args: [userId, limit],
  });

  return result.rows;
}

export async function getAllUsers() {
  const result = await db.execute(
    "SELECT id, username, email, role, created_at, last_login, obfuscation_count FROM users ORDER BY created_at DESC"
  );

  return result.rows;
}

export default db;