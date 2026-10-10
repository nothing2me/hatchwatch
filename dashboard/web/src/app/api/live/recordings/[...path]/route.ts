import { currentUserOrNull } from '@/lib/auth/guard';
import { getRecorder } from '@/lib/phones/recorder';
import { recordingsRoot } from '@/lib/phones/recordingPaths';
import { getRecordingFile } from '@/lib/phones/recordingsHttp';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }): Promise<Response>
{
    const { path } = await context.params;
    return getRecordingFile({ user: await currentUserOrNull(), root: getRecorder()?.options.root ?? recordingsRoot() }, path.join('/'), request);
}
