'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';

type Range = '24h' | '7d' | '30d' | 'all';
type Row = { window: string; videos: number; digging: number; crawl: number; danger: number; patrol: number; protected: number; noNest: number };
type History = { includesDemoPatrol?: boolean; range: Range; bucket: 'hour' | 'day' | 'month'; from: string; to: string; firstLoggedAt: string | null; rows: Row[] };
const ranges: { key: Range; label: string }[] = [{ key: '24h', label: '24 hours' }, { key: '7d', label: '7 days' }, { key: '30d', label: '30 days' }, { key: 'all', label: 'All time' }];
const dateTime = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
const month = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

export function HistorySheet()
{
    const [range, setRange] = useState<Range>('30d');
    const [history, setHistory] = useState<History | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    useEffect(() =>
    {
        const controller = new AbortController();
        setLoading(true);
        setError(null);
        fetch(`/api/analytics/history?range=${range}`, { cache: 'no-store', signal: controller.signal })
            .then(async response => { if (!response.ok) throw new Error('Historical records could not be loaded.'); return response.json() as Promise<History>; })
            .then(data => { setHistory(data); setLoading(false); })
            .catch(reason => { if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : 'Historical records could not be loaded.'); setLoading(false); } });
        return () => controller.abort();
    }, [range]);

    return <section className="mt-8 rounded-2xl border border-white/8 bg-night-900/70 p-4 sm:p-5" aria-labelledby="history-title">
        <div className="flex flex-wrap items-start justify-between gap-4">
            <div><h2 id="history-title" className="text-base font-semibold text-ink">Historical record</h2><p className="mt-1 text-xs text-ink-muted">Camera footage, detections and field actions saved in the database. Times are UTC.</p></div>
            <div role="group" aria-label="History time window" className="flex flex-wrap gap-1 rounded-lg bg-night-950/80 p-1">{ranges.map(item => <button key={item.key} type="button" aria-pressed={range === item.key} onClick={() => setRange(item.key)} className={cn('rounded-md px-2.5 py-1.5 text-xs focus-visible:outline-2 focus-visible:outline-amber', range === item.key ? 'bg-white/12 text-ink' : 'text-ink-muted hover:text-ink')}>{item.label}</button>)}</div>
        </div>
        {history && <p className="mt-3 text-xs text-ink-muted">{history.firstLoggedAt ? `First record ${dateTime.format(new Date(history.firstLoggedAt))}` : 'No records yet'} · Window {dateTime.format(new Date(history.from))} to {dateTime.format(new Date(history.to))}</p>}
        {history?.includesDemoPatrol && <p data-testid="demo-patrol-note" className="mt-1 text-xs text-amber">Includes demo patrol (simulated)</p>}
        {loading && <p className="mt-6 text-sm text-ink-muted" role="status">Loading history…</p>}
        {error && <p className="mt-6 text-sm text-alarm" role="alert">{error}</p>}
        {!loading && !error && history && (history.rows.length === 0 ? <p className="mt-6 text-sm text-ink-muted">No records in this window.</p> :
            <div className="mt-4 max-h-[32rem] overflow-auto rounded-lg border border-white/8">
                <table className="w-full min-w-[42rem] border-collapse text-left text-xs tabular-nums">
                    <thead className="sticky top-0 bg-night-900 text-ink-muted"><tr>{['Time window', 'Footage', 'Digging', 'Crawl only', 'Danger', 'Patrol', 'Protected', 'No nest'].map(label => <th key={label} scope="col" className="border-b border-white/10 px-3 py-2 font-medium">{label}</th>)}</tr></thead>
                    <tbody>{history.rows.map(row => <tr key={row.window} className="border-b border-white/6 last:border-0 hover:bg-white/4"><th scope="row" className="whitespace-nowrap px-3 py-2 font-medium text-ink">{history.bucket === 'month' ? month.format(new Date(row.window)) : dateTime.format(new Date(row.window))}</th>{[row.videos, row.digging, row.crawl, row.danger, row.patrol, row.protected, row.noNest].map((value, index) => <td key={index} className="px-3 py-2 text-ink-muted">{value}</td>)}</tr>)}</tbody>
                </table>
            </div>)}
    </section>;
}
