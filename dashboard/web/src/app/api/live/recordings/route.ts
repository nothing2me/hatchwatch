import { currentUserOrNull } from '@/lib/auth/guard';
import { getRecorder } from '@/lib/phones/recorder';
import { getRecordingList } from '@/lib/phones/recordingsHttp';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response>
{
    return getRecordingList({ user: await currentUserOrNull(), recorder: getRecorder() });
}
