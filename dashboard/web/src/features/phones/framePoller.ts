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
    // Aborted by stop(): cancels the request in flight, and a late answer never becomes an unrevoked URL.
    private readonly stopper = new AbortController();

    // A request that hangs (Wi-Fi gone without a reset) counts as offline after `timeoutMs`.
    constructor(private deviceId: string, private deps: PollerDeps, private timeoutMs = 3000) {}

    // One request; true when the picture or the state changed. Never throws.
    async poll(): Promise<boolean>
    {
        if (this.stopper.signal.aborted)
        {
            return false;
        }
        // Combined by hand: AbortSignal.any and AbortSignal.timeout need Safari 17.4 or later.
        const request = new AbortController();
        const abort = () => request.abort();
        const timer = setTimeout(abort, this.timeoutMs);
        this.stopper.signal.addEventListener('abort', abort);
        const signal = request.signal;
        let next: string;
        let etag: string | null;
        try
        {
            const response = await this.deps.fetch(`/api/live/frame/${encodeURIComponent(this.deviceId)}`, { cache: 'no-store', signal, headers: this.etag ? { 'If-None-Match': this.etag } : {} });
            if (this.stopper.signal.aborted)
            {
                return false;
            }
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
            const blob = await response.blob();
            if (this.stopper.signal.aborted)
            {
                return false;
            }
            etag = response.headers.get('ETag');
            next = this.deps.createObjectURL(blob);
        }
        catch
        {
            // Network error or timeout; after stop() nothing changes.
            if (this.stopper.signal.aborted)
            {
                return false;
            }
            this.etag = null;
            return this.setState('offline');
        }
        finally
        {
            clearTimeout(timer);
            this.stopper.signal.removeEventListener('abort', abort);
        }
        // Keep one spare: an <img> still decoding the previous frame must not lose it.
        if (this.spare)
        {
            this.deps.revokeObjectURL(this.spare);
        }
        this.spare = this.url;
        this.url = next;
        this.etag = etag;
        this.state = 'live';
        return true;
    }

    stop(): void
    {
        this.stopper.abort();
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
