'use client';

import { useId, useState, type FormEvent } from 'react';
import { LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { PERSON_EVENTS } from '@/lib/sites/summary';
import type { SiteEventType, SiteSummary } from '@/lib/types';
import { EVENT_LABELS } from './labels';

const NOTE_MAX = 1000;
// "Danger resolved" belongs to the danger alert itself; the server refuses it on a nest site.
const SITE_ENTRIES = PERSON_EVENTS.filter(type => type !== 'dangerResolved');
const field = 'w-full rounded-lg border border-white/10 bg-night-950/70 px-2.5 text-sm text-ink transition-colors placeholder:text-ink-muted/60 hover:border-white/20 focus:border-amber/70 focus:outline-none';

// Person entries for one site. The server re-checks role and the hatched rule; its message is shown as is.
export function PatrolForm({ alertId, summary, onSaved }: { alertId: string; summary: SiteSummary; onSaved: () => void })
{
    const ids = useId();
    const [type, setType] = useState<SiteEventType>('patrolVisit');
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const canHatch = summary.nesting === 'confirmed';

    async function submit(event: FormEvent)
    {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try
        {
            const trimmed = note.trim();
            const response = await fetch(`/api/sites/${alertId}/events`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(trimmed ? { type, note: trimmed } : { type }),
            });
            if (!response.ok)
            {
                const body = await response.json().catch(() => null) as { error?: string } | null;
                setError(body?.error ?? `Could not save the entry (${response.status}).`);
                return;
            }
            setNote('');
            setType('patrolVisit');
            onSaved();
        }
        catch
        {
            setError('Could not reach the server. Try again.');
        }
        finally
        {
            setBusy(false);
        }
    }

    return (
        <form onSubmit={submit} className="space-y-2.5">
            <div>
                <label htmlFor={`${ids}-type`} className="mb-1 block text-[10px] tracking-[0.12em] text-ink-muted uppercase">Entry</label>
                <select id={`${ids}-type`} value={type} onChange={event => setType(event.target.value as SiteEventType)} aria-describedby={canHatch ? undefined : `${ids}-hint`} className={cn(field, 'h-9 appearance-none bg-[url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%2016%2016%22%3E%3Cpath%20d%3D%22M4%206l4%204%204-4%22%20fill%3D%22none%22%20stroke%3D%22%238A9BA6%22%20stroke-width%3D%221.5%22/%3E%3C/svg%3E")] bg-[length:14px] bg-[right_10px_center] bg-no-repeat pr-8')}>
                    {SITE_ENTRIES.map(option => (
                        <option key={option} value={option} disabled={option === 'hatched' && !canHatch} className="bg-night-900">{EVENT_LABELS[option]}</option>
                    ))}
                </select>
                {!canHatch && <p id={`${ids}-hint`} className="mt-1 text-[11px] text-ink-muted">Hatched: <span className="text-ink/80">Confirm the nest first</span></p>}
            </div>
            <div>
                <label htmlFor={`${ids}-note`} className="mb-1 flex items-baseline justify-between text-[10px] tracking-[0.12em] text-ink-muted uppercase">
                    Note <span className="font-mono tracking-normal normal-case opacity-70">{note.length}/{NOTE_MAX} · optional</span>
                </label>
                <textarea id={`${ids}-note`} value={note} maxLength={NOTE_MAX} rows={2} onChange={event => setNote(event.target.value)} placeholder="What did you see on site?" className={cn(field, 'resize-none py-2 leading-snug')} />
            </div>
            {error && <p role="alert" className="rounded-md bg-danger/10 px-2.5 py-1.5 text-xs text-[#F08A5D] ring-1 ring-danger/30">{error}</p>}
            <button type="submit" disabled={busy} className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-amber text-sm font-semibold text-night-950 transition-colors hover:bg-amber/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber disabled:opacity-60">
                {busy && <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />}
                Add to log
            </button>
        </form>
    );
}
