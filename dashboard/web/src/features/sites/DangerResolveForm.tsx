'use client';

import { useId, useState, type FormEvent } from 'react';
import { LoaderCircle, ShieldCheck } from 'lucide-react';
import { resolveDanger } from '@/features/alerts/resolveDanger';

const NOTE_MAX = 1000;

// Volunteers and admins close a level-1 danger, with an optional note. The server re-checks the role.
export function DangerResolveForm({ alertId, onSaved }: { alertId: string; onSaved: () => void })
{
    const ids = useId();
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function submit(event: FormEvent)
    {
        event.preventDefault();
        setBusy(true);
        setError(null);
        const result = await resolveDanger(alertId, note);
        setBusy(false);
        if (!result.ok)
        {
            setError(result.error);
            return;
        }
        setNote('');
        onSaved();
    }

    return (
        <form onSubmit={submit} className="space-y-2.5">
            <div>
                <label htmlFor={`${ids}-note`} className="mb-1 flex items-baseline justify-between text-[10px] tracking-[0.12em] text-ink-muted uppercase">
                    Note <span className="font-mono tracking-normal normal-case opacity-70">{note.length}/{NOTE_MAX} · optional</span>
                </label>
                <textarea
                    id={`${ids}-note`}
                    value={note}
                    maxLength={NOTE_MAX}
                    rows={2}
                    onChange={event => setNote(event.target.value)}
                    placeholder="Who was there, and what did you do?"
                    className="w-full resize-none rounded-lg border border-white/10 bg-night-950/70 px-2.5 py-2 text-sm leading-snug text-ink transition-colors placeholder:text-ink-muted/60 hover:border-white/20 focus:border-alarm/70 focus:outline-none"
                />
            </div>
            {error && <p role="alert" className="rounded-md bg-alarm/10 px-2.5 py-1.5 text-xs text-[#FF8A95] ring-1 ring-alarm/30">{error}</p>}
            <button type="submit" disabled={busy} className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-alarm text-sm font-semibold text-white shadow-[0_4px_18px_rgba(255,77,94,0.3)] transition-colors hover:bg-[#FF6674] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-alarm disabled:opacity-60">
                {busy ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : <ShieldCheck aria-hidden className="h-4 w-4" />}
                Resolve danger
            </button>
        </form>
    );
}
