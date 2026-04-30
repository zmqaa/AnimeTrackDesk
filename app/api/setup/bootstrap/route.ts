import fs from 'fs/promises';
import path from 'path';
import mysql from 'mysql2/promise';
import { createDbConfig, loadDatabaseEnv, projectRoot } from '@/scripts/shared/db_env';
import { apiError, apiSuccess } from '@/lib/api-response';

type SetupStatus = {
  allowed: boolean;
  envReady: boolean;
  databaseReachable: boolean;
  seeded: boolean;
  animeCount: number;
  historyCount: number;
  message: string;
  missingEnvKeys: string[];
  envFileHint: string;
  databaseError?: string;
};

function isSetupAllowed() {
  return process.env.NODE_ENV !== 'production' || process.env.ALLOW_LOCAL_SETUP === 'true';
}

async function readSql(relativePath: string) {
  const absolutePath = path.join(projectRoot, relativePath);
  return fs.readFile(absolutePath, 'utf8');
}

async function getSetupStatus(): Promise<SetupStatus> {
  if (!isSetupAllowed()) {
    return {
      allowed: false,
      envReady: false,
      databaseReachable: false,
      seeded: false,
      animeCount: 0,
      historyCount: 0,
      message: '当前环境禁止通过网页初始化数据库。',
      missingEnvKeys: [],
      envFileHint: '仅开发环境或显式开启 ALLOW_LOCAL_SETUP=true 时可用。',
    };
  }

  try {
    loadDatabaseEnv();
    const databaseName = process.env.MYSQL_DATABASE?.trim();
    const host = process.env.MYSQL_HOST?.trim();
    const user = process.env.MYSQL_USER?.trim();
    const password = process.env.MYSQL_PASSWORD?.trim();
    const port = Number(process.env.MYSQL_PORT || '3306');
    const missingEnvKeys = [
      !host ? 'MYSQL_HOST' : null,
      !process.env.MYSQL_PORT?.trim() ? 'MYSQL_PORT' : null,
      !user ? 'MYSQL_USER' : null,
      !password ? 'MYSQL_PASSWORD' : null,
      !databaseName ? 'MYSQL_DATABASE' : null,
      !process.env.NEXTAUTH_URL?.trim() ? 'NEXTAUTH_URL' : null,
      !process.env.NEXTAUTH_SECRET?.trim() ? 'NEXTAUTH_SECRET' : null,
    ].filter((item): item is string => Boolean(item));

    if (missingEnvKeys.length > 0 || Number.isNaN(port)) {
      return {
        allowed: true,
        envReady: false,
        databaseReachable: false,
        seeded: false,
        animeCount: 0,
        historyCount: 0,
        message: '请先配置 .env.local 中的 MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE。',
        missingEnvKeys: Number.isNaN(port) ? [...missingEnvKeys, 'MYSQL_PORT'] : missingEnvKeys,
        envFileHint: '推荐先执行 cp .env.example .env.local，再按说明填写。',
      };
    }

    const connection = await mysql.createConnection(createDbConfig());
    try {
      const [animeRows] = await connection.query<mysql.RowDataPacket[]>('SELECT COUNT(*) AS count FROM anime');
      const [historyRows] = await connection.query<mysql.RowDataPacket[]>('SELECT COUNT(*) AS count FROM watch_history');
      const animeCount = Number(animeRows[0]?.count || 0);
      const historyCount = Number(historyRows[0]?.count || 0);

      return {
        allowed: true,
        envReady: true,
        databaseReachable: true,
        seeded: animeCount > 0,
        animeCount,
        historyCount,
        message: animeCount > 0
          ? '数据库已准备完成，当前已导入示例数据。'
          : '数据库可连接，但还没有导入示例数据。',
        missingEnvKeys: [],
        envFileHint: '环境变量已就绪。',
      };
    } catch (tableError) {
      return {
        allowed: true,
        envReady: true,
        databaseReachable: true,
        seeded: false,
        animeCount: 0,
        historyCount: 0,
        message: '数据库已连通，但表结构尚未初始化。',
        missingEnvKeys: [],
        envFileHint: '环境变量已就绪。',
        databaseError: tableError instanceof Error ? tableError.message : '读取数据表失败。',
      };
    } finally {
      await connection.end();
    }
  } catch (error) {
    return {
      allowed: true,
      envReady: true,
      databaseReachable: false,
      seeded: false,
      animeCount: 0,
      historyCount: 0,
      message: error instanceof Error ? error.message : '读取初始化状态失败。',
      missingEnvKeys: [],
      envFileHint: '环境变量看起来已填写，但数据库连接失败。',
      databaseError: error instanceof Error ? error.message : '数据库连接失败。',
    };
  }
}

export async function GET() {
  const status = await getSetupStatus();
  return apiSuccess(status, status.allowed ? 200 : 403);
}

export async function POST() {
  if (!isSetupAllowed()) {
    return apiError('当前环境禁止通过网页初始化数据库。', 403);
  }

  // 防止已初始化的数据库被重复执行
  const currentStatus = await getSetupStatus();
  if (currentStatus.seeded && currentStatus.animeCount > 0) {
    return apiError('数据库已初始化完成，不允许重复执行。如需重置请使用命令行工具。', 409);
  }

  try {
    loadDatabaseEnv();

    const host = process.env.MYSQL_HOST?.trim();
    const user = process.env.MYSQL_USER?.trim();
    const password = process.env.MYSQL_PASSWORD?.trim();
    const databaseName = process.env.MYSQL_DATABASE?.trim();
    const port = Number(process.env.MYSQL_PORT || '3306');

    if (!databaseName || !host || !user || Number.isNaN(port) || !password) {
      return apiError('请先完成 .env.local 里的 MySQL 配置。', 400);
    }

    const schemaSql = await readSql('database/schema.sql');
    const seedSql = await readSql('database/seed_anime_data.sql');
    const rootConnection = await mysql.createConnection({
      host,
      port,
      user,
      password,
      charset: 'utf8mb4',
      multipleStatements: true,
    });

    try {
      await rootConnection.query(`CREATE DATABASE IF NOT EXISTS \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      await rootConnection.query(`USE \`${databaseName}\``);
      await rootConnection.query(schemaSql);
      await rootConnection.query(seedSql);
    } finally {
      await rootConnection.end();
    }

    const status = await getSetupStatus();
    return apiSuccess({ ok: true, status });
  } catch (error) {
    const message = error instanceof Error ? error.message : '初始化失败';
    return apiError(message, 500);
  }
}