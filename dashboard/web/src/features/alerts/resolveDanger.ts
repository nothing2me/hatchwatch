// Posts `dangerResolved` on one danger alert (the server also resolves the site's other open dangers).
export async function resolveDanger(alertId: string, note?: string): Promise<{ ok: true } | { ok: false; error: string }>
{
    const trimmed = note?.trim();
    try
    {
        const response = await fetch(`/api/sites/${alertId}/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(trimmed ? { type: 'dangerResolved', note: trimmed } : { type: 'dangerResolved' }),
        });
        if (!response.ok)
        {
            const body = await response.json().catch(() => null) as { error?: string } | null;
            return { ok: false, error: body?.error ?? `Could not resolve the danger (${response.status}).` };
        }
        return { ok: true };
    }
    catch
    {
        return { ok: false, error: 'Could not reach the server. Try again.' };
    }
}
