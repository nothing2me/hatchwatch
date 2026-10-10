import { redirect } from 'next/navigation';
import { currentUserOrNull } from '@/lib/auth/guard';
import { CamSender } from '@/features/phones/CamSender';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'HatchWatch camera' };

export default async function CamPage()
{
    const user = await currentUserOrNull();
    if (!user)
    {
        redirect('/login?next=/cam');
    }
    return <CamSender user={{ name: user.name, role: user.role }} />;
}
