// Where to go after signing in. Only same-site absolute paths, so `?next=` can't send anyone off-site
// (`//host`, `/\host` and schemes are refused). Anything else falls back to the map.
export function safeNextPath(value: unknown): string
{
    if (typeof value !== 'string' || value.length > 200 || !/^\/(?![/\\])[\w\-./?=&%]*$/.test(value))
    {
        return '/';
    }
    return value;
}
