const HOST = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)$/i;

// https://<LAN_HOST>:3443, the address phones and camera boards use. Null when unset or malformed.
export function dashboardOrigin(lanHost: string | undefined): string | null
{
    const host = lanHost?.trim();
    return host && HOST.test(host) ? `https://${host}:3443` : null;
}

// The address phones open, from LAN_HOST (the laptop's Wi-Fi IP). Null when unset or malformed.
export function connectUrl(lanHost: string | undefined): string | null
{
    const origin = dashboardOrigin(lanHost);
    return origin ? `${origin}/cam` : null;
}
