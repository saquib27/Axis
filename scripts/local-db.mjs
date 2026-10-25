import EmbeddedPostgres from '../.local-tools/postgres/node_modules/embedded-postgres/dist/index.js';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

const configFile = new URL('../backend/router/.env.local', import.meta.url);
const dataDir = fileURLToPath(new URL('../.local/postgres', import.meta.url));
await mkdir(new URL('../.local/', import.meta.url), { recursive: true, mode: 0o700 });
let config;
try { config = parse(await readFile(configFile)); } catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const password = randomBytes(24).toString('hex');
  config = {
    DATABASE_URL: `postgresql://axis:${password}@127.0.0.1:55432/axis`,
    JWT_SECRET: randomBytes(48).toString('hex'),
  };
  await writeFile(configFile, Object.entries(config).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600, flag: 'wx' });
}
const url = new URL(config.DATABASE_URL);
if (url.hostname !== '127.0.0.1' || url.port !== '55432') throw new Error('Expected the dedicated local database at 127.0.0.1:55432');
const pg = new EmbeddedPostgres({
  databaseDir: dataDir, port: 55432, user: url.username, password: url.password,
  authMethod: 'scram-sha-256', persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  postgresFlags: ['-h', '127.0.0.1', '-k', dataDir],
  onLog: () => {}, onError: (error) => console.error(error),
});
try { await access(`${dataDir}/PG_VERSION`); } catch { await pg.initialise(); }
await pg.start();
const client = pg.getPgClient();
await client.connect();
const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', ['axis']);
await client.end();
if (!existing.rowCount) await pg.createDatabase('axis');
console.log('Local PostgreSQL ready on 127.0.0.1:55432; data persists in .local/postgres');
