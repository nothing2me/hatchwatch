import Link from 'next/link';

export default function Forbidden()
{
    return (
        <main className="grid min-h-full place-items-center bg-night-950 p-6 text-center">
            <div>
                <p className="font-mono text-sm text-amber">403</p>
                <h1 className="mt-2 text-xl font-semibold">Admins only</h1>
                <p className="mt-1 text-ink-muted">Your account can view the map and alerts but cannot change setup.</p>
                <Link href="/" className="mt-4 inline-block text-amber underline-offset-4 hover:underline">Back to map</Link>
            </div>
        </main>
    );
}
