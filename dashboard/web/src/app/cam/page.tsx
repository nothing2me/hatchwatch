import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentUserOrNull } from '@/lib/auth/guard';
import { CamStreamer } from './CamStreamer';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'HatchWatch camera' };

// The phone (or laptop) side of a live camera. Any signed-in role; no map chrome.
export default async function CamPage()
{
    const user = await currentUserOrNull();
    if (!user)
    {
        redirect('/login?next=/cam');
    }
    return <CamStreamer userName={user.name} />;
}
