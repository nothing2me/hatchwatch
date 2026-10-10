// Caddy terminates TLS on :3443 and sets X-Forwarded-Proto. Port 3000 is loopback-only, so the header is trusted.
export function isHttpsRequest(headers: Headers): boolean
{
    return (headers.get('x-forwarded-proto') ?? '').split(',')[0].trim().toLowerCase() === 'https';
}
