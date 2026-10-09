import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import pg from 'pg';

// Creates the integration-test database if missing and applies migrations to it.
// Usage: `npm run db:test:prepare` (needs `docker compose up -d db`).
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl)
{
    throw new Error('TEST_DATABASE_URL is not set');
}

const url = new URL(testUrl);
const dbName = url.pathname.slice(1);
if (!dbName.endsWith('_test') || !/^[a-z0-9_]+$/.test(dbName))
{
    throw new Error(`Refusing to prepare database "${dbName}": name must end with _test`);
}

const adminUrl = new URL(testUrl);
adminUrl.pathname = '/postgres';
const client = new pg.Client({ connectionString: adminUrl.toString() });
await client.connect();
const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
if (exists.rowCount === 0)
{
    await client.query(`CREATE DATABASE "${dbName}"`);
    console.log(`Created database ${dbName}`);
}
await client.end();

execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: testUrl },
});
