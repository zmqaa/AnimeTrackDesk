import 'server-only';
import mysql from 'mysql2/promise';
import { env } from './env';

// Prevent multiple pools in development
declare global {
  // eslint-disable-next-line no-var
  var mysqlPool: mysql.Pool | undefined;
}

export const pool =
  global.mysqlPool ||
  mysql.createPool({
    host: env.mysqlHost,
    port: env.mysqlPort,
    user: env.mysqlUser,
    password: env.mysqlPassword,
    database: env.mysqlDatabase,
    connectionLimit: 5, // 降低连接数，避免超出数据库限制
    waitForConnections: true,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
  });

if (process.env.NODE_ENV !== 'production') global.mysqlPool = pool;

export async function query<T = unknown>(sql: string, params?: unknown[]) {
  const [rows] = await pool.query(sql, params);
  return rows as T;
}
