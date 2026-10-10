import { describe, expect, it } from 'vitest';
import { boardSecretsBlock } from '@/lib/phones/boardSecrets';

describe('boardSecretsBlock', () =>
{
    it('writes the secrets.h lines with the dashboard address, id and token, and points at the existing CA block', () =>
    {
        const block = boardSecretsBlock({ dashboardUrl: 'https://10.47.138.152:3443', deviceId: 'ckboard1', token: 'T'.repeat(43) });
        expect(block).toContain('#define DASHBOARD_URL "https://10.47.138.152:3443"');
        expect(block).toContain('#define DEVICE_ID "ckboard1"');
        expect(block).toContain(`#define DEVICE_TOKEN "${'T'.repeat(43)}"`);
        expect(block).toContain('docker compose exec caddy cat /data/caddy/pki/authorities/local/root.crt');
        expect(block).toContain('DASHBOARD_CA');
        // secrets.h (from secrets.example.h) already defines DASHBOARD_CA; a second one would not compile.
        expect(block).not.toContain('static const char DASHBOARD_CA');
        expect(block.match(/^#define /gm)).toHaveLength(3);
    });

    it('leaves the address empty with a note when LAN_HOST is not set', () =>
    {
        const block = boardSecretsBlock({ dashboardUrl: null, deviceId: 'ckboard1', token: 'T'.repeat(43) });
        expect(block).toContain('#define DASHBOARD_URL ""');
        expect(block).toContain('Set LAN_HOST in dashboard/.env');
    });
});
