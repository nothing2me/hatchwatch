export type LiveFrameState = 'loading' | 'live' | 'offline' | 'signed-out';

export interface PollerDeps
{
    fetch: typeof fetch;
    createObjectURL(blob: Blob): string;
    revokeObjectURL(url: string): void;
}

// One device's newest frame as an object URL. Short polls instead of a held stream: browsers allow
// only six HTTP/1.1 connections per site, and a grid of open streams would stall new pages.
export class FramePoller
{
    url: string | null = null;
    state: LiveFrameState = 'loading';
    private spare: string | null = null;
    private etag: string | null = null;

    constructor(private deviceId: string, private deps: PollerDeps) {}

    // One request; true when the picture or the state changed.
    async poll(): Promise<boolean>
    {
        const response = await this.deps.fetch(`/api/live/frame/${encodeURIComponent(this.deviceId)}`, { cache: 'no-store', headers: this.etag ? { 'If-None-Match': this.etag } : {} });
        if (response.status === 304)
        {
            return this.setState('live');
        }
        if (response.status === 401)
        {
            return this.setState('signed-out');
        }
        if (!response.ok)
        {
            this.etag = null;
            return this.setState('offline');
        }
        const next = this.deps.createObjectURL(await response.blob());
        // Keep one spare: an <img> still decoding the previous frame must not lose it.
        if (this.spare)
        {
            this.deps.revokeObjectURL(this.spare);
        }
        this.spare = this.url;
        this.url = next;
        this.etag = response.headers.get('ETag');
        this.state = 'live';
        return true;
    }

    stop(): void
    {
        for (const url of [this.spare, this.url])
        {
            if (url)
            {
                this.deps.revokeObjectURL(url);
            }
        }
        this.spare = null;
        this.url = null;
    }

    private setState(state: LiveFrameState): boolean
    {
        const changed = state !== this.state;
        this.state = state;
        return changed;
    }
}
