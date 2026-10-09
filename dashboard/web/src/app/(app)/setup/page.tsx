import Link from 'next/link';
import { requireRole } from '@/lib/auth/guard';

// Admin gate in place now; the setup tools arrive in Plan 3.
export default async function SetupPage()
{
    await requireRole('ADMIN');
    return (
        <main className="grid min-h-full place-items-center bg-night-950 p-6 text-center">
            <div>
                <h1 className="text-xl font-semibold">Setup</h1>
                <p className="mt-1 text-ink-muted">Zone, camera and upload tools are coming in the next release.</p>
                <Link href="/" className="mt-4 inline-block text-amber hover:underline">Back to map</Link>
            </div>
        </main>
    );
}
