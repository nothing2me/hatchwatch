import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEMO_VIEWER } from '../../prisma/seed-data';

const compose = readFileSync(join(import.meta.dirname, '../../../docker-compose.yml'), 'utf8');

// Spec §6 keeps these on purpose: they name stored data, not the product.
describe('names kept through the HatchWatch rename', () =>
{
    it('keeps the Compose project name', () =>
    {
        // Renaming the project creates new, empty volumes: Postgres would come up without any data.
        expect(compose).toMatch(/^name: nesttrace-dashboard$/m);
    });

    it('keeps the Postgres user and database', () =>
    {
        // Renaming these makes Postgres refuse the existing data directory's credentials or start an empty database.
        expect(compose).toMatch(/^\s+POSTGRES_USER: nesttrace$/m);
        expect(compose).toMatch(/^\s+POSTGRES_DB: nesttrace$/m);
        // The web container must keep connecting to the same database, or it sees no data.
        expect(compose).toContain('DATABASE_URL: postgresql://nesttrace:nesttrace@db:5432/nesttrace');
    });

    it('keeps the volume names', () =>
    {
        // Renamed volumes are new, empty volumes: the database and Caddy's certificates would be lost.
        expect(compose).toMatch(/^volumes:\n {2}pgdata:\n {2}caddy_data:$/m);
        expect(compose).toContain('- pgdata:/var/lib/postgresql/data');
        expect(compose).toContain('- caddy_data:/data');
    });

    it('keeps the seeded viewer email', () =>
    {
        // Renaming the email makes the seed create a second viewer account instead of updating the existing one.
        expect(DEMO_VIEWER.email).toBe('viewer@nesttrace.local');
    });
});
