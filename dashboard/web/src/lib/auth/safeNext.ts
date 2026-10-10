// A same-site path to return to after sign-in (e.g. the phone's /cam); anything else is ignored.
export function safeNext(value: unknown): string | null
{
    return typeof value === 'string' && value.length <= 200 && /^\/(?![/\\])[\x21-\x7e]*$/.test(value) ? value : null;
}
