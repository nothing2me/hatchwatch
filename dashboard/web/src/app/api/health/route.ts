// Liveness probe for Docker and tests. No database access.
export async function GET(): Promise<Response>
{
    return Response.json({ ok: true });
}
