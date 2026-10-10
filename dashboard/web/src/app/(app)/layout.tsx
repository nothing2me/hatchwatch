import { requireCurrentUser } from '@/lib/auth/guard';

// Every page in (app) requires a signed-in user. TopBar is rendered by each
// page because it needs page data (camera and alert counts).
export default async function AppLayout({ children }: { children: React.ReactNode })
{
    await requireCurrentUser();
    return <div className="h-full">{children}</div>;
}
