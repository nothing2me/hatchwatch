// The lines an admin pastes over the dashboard lines in firmware/esp32s3-cam/secrets.h. Built in the action result only; never stored.
// secrets.h (copied from secrets.example.h) already has the DASHBOARD_CA block, so this does not define it again.
export function boardSecretsBlock({ dashboardUrl, deviceId, token }: { dashboardUrl: string | null; deviceId: string; token: string }): string
{
    return [
        '// NestTrace dashboard upload. Replace the DASHBOARD_URL, DEVICE_ID and DEVICE_TOKEN lines in firmware/esp32s3-cam/secrets.h.',
        ...(dashboardUrl ? [] : ['// Set LAN_HOST in dashboard/.env, then put https://<LAN_HOST>:3443 here.']),
        `#define DASHBOARD_URL "${dashboardUrl ?? ''}"`,
        `#define DEVICE_ID "${deviceId}"`,
        `#define DEVICE_TOKEN "${token}"`,
        '// Paste Caddy\'s root certificate into the existing DASHBOARD_CA block in secrets.h.',
        '// In dashboard/: docker compose exec caddy cat /data/caddy/pki/authorities/local/root.crt',
        '',
    ].join('\n');
}
