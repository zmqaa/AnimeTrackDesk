type EnvKey =
  | 'MYSQL_HOST'
  | 'MYSQL_PORT'
  | 'MYSQL_USER'
  | 'MYSQL_PASSWORD'
  | 'MYSQL_DATABASE';

function requiredEnv(key: EnvKey): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required env: ${key}`);
  }
  return value;
}

export const env = {
  mysqlHost: requiredEnv('MYSQL_HOST'),
  mysqlPort: Number(requiredEnv('MYSQL_PORT')),
  mysqlUser: requiredEnv('MYSQL_USER'),
  mysqlPassword: requiredEnv('MYSQL_PASSWORD'),
  mysqlDatabase: requiredEnv('MYSQL_DATABASE'),
};
