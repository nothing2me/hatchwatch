'use client';

import { Fragment, useState, useTransition } from 'react';
import { Check, Compass, Merge, Pencil, Plus, Trash2, X } from 'lucide-react';
import { addCameraPairNewZone, addCameraPairToZone, deleteCamera, faceOcean, mergeZoneInto, updateCamera } from '@/app/(app)/camera-actions';
import { SourceSelect } from '@/features/phones/SourceSelect';
import { TopBar } from '@/features/shell/TopBar';
import type { SessionUser } from '@/lib/auth/session';
import type { CameraRow } from '@/lib/cameras/manage';
import { CAMERA_CODE, CAMERA_LIMITS, rangeError } from '@/lib/cameras/limits';
import { nextZoneCode } from '@/lib/cameras/placePair';
import { compassPoint } from '@/lib/geo';
import type { CameraStatus, LiveDeviceView, LngLat } from '@/lib/types';
import { cn } from '@/lib/cn';

export interface ZoneOption
{
    code: string;
    name: string;
    suggested: LngLat | null;
    // Only zones an admin added on the map can be merged away.
    mergeable: boolean;
}

interface CamerasScreenProps
{
    user: SessionUser;
    zones: ZoneOption[];
    cameras: CameraRow[];
    devices?: LiveDeviceView[];
    bar: { camerasOnline: number; camerasTotal: number; activeSites: number; dangerCount?: number; firstDangerId?: string | null };
}

type NumberField = keyof typeof CAMERA_LIMITS;
type Draft = { code: string; status: CameraStatus } & Record<NumberField, string>;
type Notice = { kind: 'ok' | 'error'; text: string } | null;

const NUMBER_FIELDS: { key: NumberField; label: string; step: string }[] = [
    { key: 'lat', label: 'Latitude', step: '0.000001' },
    { key: 'lng', label: 'Longitude', step: '0.000001' },
    { key: 'headingDeg', label: 'Heading', step: '1' },
    { key: 'fovDeg', label: 'FOV', step: '1' },
    { key: 'rangeM', label: 'Range', step: '1' },
];

const field = 'h-9 w-full rounded-lg border border-white/12 bg-night-950/70 px-2 font-mono text-[13px] text-ink tabular-nums focus-visible:outline-2 focus-visible:outline-amber aria-invalid:border-[#E2581F]';
const button = 'inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-white/12 px-2.5 text-xs text-ink transition-colors hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-amber disabled:opacity-50';
const cell = 'px-3 py-2.5 max-md:p-0';

const fixed = (value: number, digits: number) => Number(value.toFixed(digits)).toString();

function draftOf(camera: CameraRow): Draft
{
    return {
        code: camera.code, status: camera.status,
        lat: fixed(camera.lat, 6), lng: fixed(camera.lng, 6), headingDeg: fixed(camera.headingDeg, 1), fovDeg: fixed(camera.fovDeg, 1), rangeM: fixed(camera.rangeM, 1),
    };
}

// Field-level messages for a draft; empty when it can be saved.
function draftErrors(draft: Draft): Partial<Record<NumberField | 'code', string>>
{
    const errors: Partial<Record<NumberField | 'code', string>> = {};
    if (!CAMERA_CODE.test(draft.code.trim().toUpperCase()))
    {
        errors.code = 'Codes are a zone letter and a number from 1 to 99, like B3.';
    }
    for (const { key } of NUMBER_FIELDS)
    {
        const message = draft[key].trim() === '' ? `${key === 'lat' ? 'Latitude' : key === 'lng' ? 'Longitude' : 'Value'} is required.` : rangeError(key, Number(draft[key]));
        if (message)
        {
            errors[key] = message;
        }
    }
    return errors;
}

// Pairs inside a zone: odd numbers with the next even one (B1·B2, D3·D4).
function pairsOf(cameras: CameraRow[]): string[][]
{
    const pairs: string[][] = [];
    for (const camera of cameras)
    {
        const n = Number(camera.code.slice(1));
        const partner = `${camera.code[0]}${n % 2 === 1 ? n + 1 : n - 1}`;
        if (n % 2 === 1 || !cameras.some(other => other.code === partner))
        {
            pairs.push(cameras.some(other => other.code === partner) ? [camera.code, partner] : [camera.code]);
        }
    }
    return pairs;
}

export function CamerasScreen({ user, zones, cameras, devices = [], bar }: CamerasScreenProps)
{
    const [pending, startTransition] = useTransition();
    const [notice, setNotice] = useState<Notice>(null);
    const [editing, setEditing] = useState<string | null>(null);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [showErrors, setShowErrors] = useState(false);
    const [confirmMerge, setConfirmMerge] = useState<string | null>(null);
    const firstZone = zones[0];
    const [pairMode, setPairMode] = useState<'join' | 'new'>('join');
    const [pairZone, setPairZone] = useState(firstZone?.code ?? '');
    const [pairLat, setPairLat] = useState(firstZone?.suggested ? fixed(firstZone.suggested[1], 6) : '');
    const [pairLng, setPairLng] = useState(firstZone?.suggested ? fixed(firstZone.suggested[0], 6) : '');

    function run<T extends object>(work: () => Promise<({ ok: true } & T) | { ok: false; error: string }>, done: (result: T) => string, after?: () => void)
    {
        setNotice(null);
        startTransition(async () =>
        {
            try
            {
                const result = await work();
                if (result.ok)
                {
                    setNotice({ kind: 'ok', text: done(result) });
                    after?.();
                }
                else
                {
                    setNotice({ kind: 'error', text: result.error });
                }
            }
            catch
            {
                setNotice({ kind: 'error', text: 'That did not save. Check your connection and try again.' });
            }
        });
    }

    function startEdit(camera: CameraRow)
    {
        setEditing(camera.code);
        setDraft(draftOf(camera));
        setShowErrors(false);
        setNotice(null);
    }

    function cancelEdit()
    {
        setEditing(null);
        setDraft(null);
        setShowErrors(false);
    }

    function save(camera: CameraRow)
    {
        if (!draft)
        {
            return;
        }
        if (Object.keys(draftErrors(draft)).length > 0)
        {
            setShowErrors(true);
            return;
        }
        // Send only what changed, so an untouched code or heading is never rewritten.
        const original = draftOf(camera);
        const patch: Parameters<typeof updateCamera>[1] = {};
        const code = draft.code.trim().toUpperCase();
        if (code !== camera.code)
        {
            patch.code = code;
        }
        for (const { key } of NUMBER_FIELDS)
        {
            if (draft[key].trim() !== original[key])
            {
                patch[key] = Number(draft[key]);
            }
        }
        if (draft.status !== camera.status)
        {
            patch.status = draft.status;
        }
        if (Object.keys(patch).length === 0)
        {
            cancelEdit();
            return;
        }
        run(() => updateCamera(camera.code, patch), ({ code: saved }: { code: string }) => `${saved} saved`, cancelEdit);
    }

    function choosePairZone(code: string)
    {
        setPairZone(code);
        const suggested = zones.find(zone => zone.code === code)?.suggested;
        if (suggested)
        {
            setPairLat(fixed(suggested[1], 6));
            setPairLng(fixed(suggested[0], 6));
        }
    }

    let nextZone: string | null = null;
    try
    {
        nextZone = nextZoneCode(zones.map(zone => zone.code));
    }
    catch
    {
        // Zone Z exists; the server explains when the pair is added.
    }

    const pairErrors = [rangeError('lat', pairLat.trim() === '' ? NaN : Number(pairLat)), rangeError('lng', pairLng.trim() === '' ? NaN : Number(pairLng))].filter(Boolean) as string[];

    function addPair(event: React.FormEvent)
    {
        event.preventDefault();
        if (pairErrors.length > 0)
        {
            setNotice({ kind: 'error', text: pairErrors.join(' ') });
            return;
        }
        const done = ({ codes, zoneCode, newZone }: { codes: [string, string]; zoneCode: string; newZone: boolean }) =>
            (newZone ? `New Zone ${zoneCode} · ${codes.join(' · ')} facing the sea` : `${codes.join(' · ')} added to Zone ${zoneCode}, facing the sea`);
        run(() => (pairMode === 'new' ? addCameraPairNewZone(Number(pairLng), Number(pairLat)) : addCameraPairToZone(pairZone, Number(pairLng), Number(pairLat))), done);
    }

    const errors = draft && showErrors ? draftErrors(draft) : {};

    return (
        <main className="min-h-full bg-night-950">
            <div className="sticky top-0 z-20 p-3">
                <TopBar user={user} current="setup" camerasOnline={bar.camerasOnline} camerasTotal={bar.camerasTotal} activeSites={bar.activeSites} dangerCount={bar.dangerCount} firstDangerId={bar.firstDangerId} />
            </div>
            <div className="mx-auto max-w-6xl px-4 pt-6 pb-16 sm:px-6 sm:pt-10">
                <h1 className="text-3xl font-semibold tracking-tight text-ink">Cameras</h1>
                <p className="mt-1.5 max-w-2xl text-sm text-ink-muted">New pairs join a zone, or start a new zone on open beach, and face the sea, each turned 20° toward the other. Edit any camera&apos;s position, heading, view or status here, or drag it on the map in edit mode. Source: simulation loop or a linked phone.</p>

                <section aria-labelledby="pair-heading" className="mt-6 rounded-xl border border-white/8 bg-white/[0.03] p-4">
                    <h2 id="pair-heading" className="flex items-center gap-2 text-sm font-semibold text-ink"><Plus aria-hidden className="h-4 w-4 text-amber" />Add camera pair</h2>
                    <form onSubmit={addPair} className="mt-3 space-y-3">
                        <fieldset className="flex flex-wrap items-center gap-3">
                            <legend className="sr-only">Where the pair goes</legend>
                            <div className="inline-flex rounded-lg border border-white/12 bg-night-950/70 p-0.5">
                                {([['join', 'Add to zone'], ['new', 'New zone at this location']] as const).map(([mode, label]) => (
                                    <label key={mode} className={cn('relative cursor-pointer rounded-md px-3 py-1.5 text-xs transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-amber',
                                        pairMode === mode ? 'bg-amber/15 font-medium text-amber ring-1 ring-amber/40' : 'text-ink-muted hover:text-ink')}>
                                        <input type="radio" name="pair-mode" value={mode} checked={pairMode === mode} onChange={() => setPairMode(mode)} className="sr-only" />
                                        {label}
                                    </label>
                                ))}
                            </div>
                        </fieldset>
                        <div className="grid gap-3 sm:grid-cols-[8rem_1fr_1fr_auto] sm:items-end">
                            {pairMode === 'join'
                                ? (
                                    <label className="text-xs text-ink-muted">Zone
                                        <select className={cn(field, 'mt-1 font-sans')} value={pairZone} onChange={e => choosePairZone(e.target.value)}>
                                            {zones.map(zone => <option key={zone.code} value={zone.code}>Zone {zone.code}</option>)}
                                        </select>
                                    </label>
                                )
                                : (
                                    <p className="text-xs text-ink-muted">Zone
                                        <span className="mt-1 flex h-9 items-center justify-between gap-2 rounded-lg border border-dashed border-amber/35 px-2 text-[13px] text-amber">
                                            <span data-testid="next-zone">{nextZone ? `Zone ${nextZone}` : 'None left'}</span>
                                            <span className="font-mono text-[10px] tracking-[0.12em] text-amber/70 uppercase">new</span>
                                        </span>
                                    </p>
                                )}
                            <label className="text-xs text-ink-muted">Centre latitude
                                <input className={cn(field, 'mt-1')} inputMode="decimal" value={pairLat} onChange={e => setPairLat(e.target.value)} aria-invalid={rangeError('lat', Number(pairLat)) !== null || undefined} />
                            </label>
                            <label className="text-xs text-ink-muted">Centre longitude
                                <input className={cn(field, 'mt-1')} inputMode="decimal" value={pairLng} onChange={e => setPairLng(e.target.value)} aria-invalid={rangeError('lng', Number(pairLng)) !== null || undefined} />
                            </label>
                            <button type="submit" disabled={pending || (pairMode === 'join' && zones.length === 0)} className={cn(button, 'h-9 bg-amber/90 px-3 text-sm font-medium text-night-950 hover:bg-amber')}>Add pair</button>
                        </div>
                    </form>
                    <p className="mt-2 text-xs text-ink-muted">
                        {pairMode === 'join'
                            ? 'The two cameras stand 40 m apart along the shore, centred on this point. Prefilled with the middle of the zone\u2019s dune edge.'
                            : 'A 120 m × 60 m zone with its dune edge centred on this point, lined up with the nearest zone; its two cameras stand on that edge 40 m apart. Refused if it would overlap a zone.'}
                    </p>
                </section>

                {/* Pinned to the bottom of the screen so the result shows next to whichever row was changed. */}
                <p role="status" aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-4 z-30 flex justify-center">
                    {notice && (
                        <span className={cn('pointer-events-auto flex items-center gap-2 rounded-lg border px-3 py-2 text-sm shadow-2xl shadow-black/60 backdrop-blur-md', notice.kind === 'ok' ? 'border-amber/40 bg-night-900/95 text-amber' : 'border-red-400/40 bg-night-900/95 text-red-200')}>
                            {notice.kind === 'ok' ? <Check aria-hidden className="h-4 w-4" /> : <X aria-hidden className="h-4 w-4" />}{notice.text}
                        </span>
                    )}
                </p>

                {zones.map(zone =>
                {
                    const rows = cameras.filter(camera => camera.zoneCode === zone.code);
                    return (
                        <section key={zone.code} aria-labelledby={`zone-${zone.code}`} className="mt-6">
                            <div className="flex flex-wrap items-center gap-2">
                                <h2 id={`zone-${zone.code}`} className="mr-auto text-lg font-semibold text-ink">Zone {zone.code}<span className="ml-2 text-sm font-normal text-ink-muted">{rows.length} camera{rows.length === 1 ? '' : 's'}</span></h2>
                                {pairsOf(rows).map(pair => (
                                    <button key={pair[0]} type="button" disabled={pending} className={button} onClick={() => run(() => faceOcean(pair[0]), ({ codes }: { codes: string[] }) => `${codes.join(' · ')} now face the sea`)}>
                                        <Compass aria-hidden className="h-3.5 w-3.5 text-amber" />Face ocean {pair.join('·')}
                                    </button>
                                ))}
                                {zone.mergeable && zones.length > 1 && (confirmMerge === zone.code
                                    ? (
                                        <span role="group" aria-label={`Merge Zone ${zone.code}`} className="flex items-center gap-2 rounded-lg border border-[#E2581F]/40 bg-[#E2581F]/10 px-2 py-1 text-xs text-ink">
                                            Move its cameras, footage and alerts to the nearest zone and remove Zone {zone.code}?
                                            <button type="button" className={button} onClick={() => setConfirmMerge(null)}>Keep</button>
                                            <button type="button" disabled={pending} className={cn(button, 'border-transparent bg-[#E2581F] font-semibold text-white hover:bg-[#ef6a33]')}
                                                onClick={() => run(() => mergeZoneInto(zone.code), ({ targetCode, moved }: { targetCode: string; moved: { from: string; to: string }[] }) => `Zone ${zone.code} merged into Zone ${targetCode}: ${moved.map(m => `${m.from} → ${m.to}`).join(', ') || 'no cameras'}`, () => setConfirmMerge(null))}>
                                                Merge zone
                                            </button>
                                        </span>
                                    )
                                    : (
                                        <button type="button" disabled={pending} className={button} onClick={() => setConfirmMerge(zone.code)}><Merge aria-hidden className="h-3.5 w-3.5" />Merge into nearest zone</button>
                                    ))}
                            </div>
                            <div className="mt-2 overflow-x-auto rounded-xl border border-white/8">
                                <table className="w-full min-w-[56rem] text-left text-sm max-md:block max-md:min-w-0">
                                    <thead className="bg-white/[0.04] text-xs text-ink-muted max-md:sr-only">
                                        <tr>
                                            <th scope="col" className="px-3 py-2 font-medium">Code</th>
                                            {NUMBER_FIELDS.map(f => <th key={f.key} scope="col" className="px-3 py-2 font-medium">{f.label}{f.key === 'headingDeg' || f.key === 'fovDeg' ? ' °' : f.key === 'rangeM' ? ' m' : ''}</th>)}
                                            <th scope="col" className="px-3 py-2 font-medium">Status</th>
                                            <th scope="col" className="px-3 py-2 font-medium">Footage</th>
                                            <th scope="col" className="px-3 py-2 font-medium">Source</th>
                                            <th scope="col" className="px-3 py-2 font-medium"><span className="sr-only">Actions</span></th>
                                        </tr>
                                    </thead>
                                    <tbody className="max-md:block">
                                        {rows.length === 0 && <tr><td colSpan={10} className="px-3 py-3 text-ink-muted">No cameras in this zone.</td></tr>}
                                        {rows.map(camera =>
                                        {
                                            const open = editing === camera.code && draft;
                                            return (
                                                <Fragment key={camera.code}>
                                                    <tr data-camera={camera.code} className="border-t border-white/8 align-top max-md:grid max-md:grid-cols-2 max-md:gap-2 max-md:p-3">
                                                        <td className={cn(cell, 'font-mono font-semibold text-ink')}>
                                                            {open
                                                                ? <input aria-label={`Code for ${camera.code}`} className={cn(field, 'w-20')} value={draft.code} disabled={camera.liveSlot} title={camera.liveSlot ? 'Live footage arrives on this code' : undefined} onChange={e => setDraft({ ...draft, code: e.target.value })} aria-invalid={Boolean(errors.code) || undefined} />
                                                                : <span className="inline-flex h-9 items-center">{camera.code}</span>}
                                                        </td>
                                                        {NUMBER_FIELDS.map(f => (
                                                            <td key={f.key} className={cell}>
                                                                {open
                                                                    ? <input aria-label={`${f.label} for ${camera.code}`} className={cn(field, f.key === 'lat' || f.key === 'lng' ? 'w-32' : 'w-20')} inputMode="decimal" type="number" step={f.step} value={draft[f.key]} onChange={e => setDraft({ ...draft, [f.key]: e.target.value })} aria-invalid={Boolean(errors[f.key]) || undefined} />
                                                                    : (
                                                                        <span className="inline-flex h-9 items-center font-mono text-[13px] text-ink tabular-nums">
                                                                            <span className="mr-1 text-ink-muted md:hidden">{f.label}</span>
                                                                            {f.key === 'lat' || f.key === 'lng' ? camera[f.key].toFixed(6) : fixed(camera[f.key], 1)}
                                                                            {f.key === 'headingDeg' && <span className="ml-1.5 text-xs text-ink-muted">{compassPoint(camera.headingDeg)}</span>}
                                                                        </span>
                                                                    )}
                                                            </td>
                                                        ))}
                                                        <td className={cell}>
                                                            {open
                                                                ? (
                                                                    <select aria-label={`Status for ${camera.code}`} className={cn(field, 'w-24 font-sans')} value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value as CameraStatus })}>
                                                                        <option value="ONLINE">Online</option>
                                                                        <option value="OFFLINE">Offline</option>
                                                                    </select>
                                                                )
                                                                : <span className={cn('inline-flex h-6 translate-y-1.5 items-center rounded-full px-2 text-xs', camera.status === 'ONLINE' ? 'bg-ok/15 text-ok' : 'bg-white/8 text-ink-muted')}>{camera.status === 'ONLINE' ? 'Online' : 'Offline'}</span>}
                                                        </td>
                                                        <td className={cn(cell, 'text-ink-muted')}>
                                                            <span className="inline-flex h-9 items-center text-[13px] whitespace-nowrap">{camera.footage} video{camera.footage === 1 ? '' : 's'} · {camera.alerts} alert{camera.alerts === 1 ? '' : 's'}</span>
                                                        </td>
                                                        <td className={cn(cell, 'max-md:col-span-2')}>
                                                            <span className="mb-1 block text-xs text-ink-muted md:hidden">Source</span>
                                                            <SourceSelect cameraCode={camera.code} value={camera.liveDeviceId} devices={devices} label={`Source for ${camera.code}`} hideLabel className="w-52 max-md:w-full" />
                                                        </td>
                                                        <td className={cell}>
                                                            <div className="flex justify-end gap-1.5 max-md:justify-start">
                                                                {open
                                                                    ? (
                                                                        <>
                                                                            <button type="button" disabled={pending} className={cn(button, 'bg-amber/90 font-medium text-night-950 hover:bg-amber')} onClick={() => save(camera)}>Save</button>
                                                                            <button type="button" className={button} onClick={cancelEdit}>Cancel</button>
                                                                        </>
                                                                    )
                                                                    : (
                                                                        <>
                                                                            <button type="button" disabled={pending} className={button} onClick={() => startEdit(camera)} aria-label={`Edit ${camera.code}`}><Pencil aria-hidden className="h-3.5 w-3.5" />Edit</button>
                                                                            <button type="button" disabled={pending} className={cn(button, 'hover:border-[#E2581F]/50 hover:bg-[#E2581F]/15')} onClick={() => run(() => deleteCamera(camera.code), ({ code }: { code: string }) => `${code} removed`)} aria-label={`Delete ${camera.code}`}><Trash2 aria-hidden className="h-3.5 w-3.5" /></button>
                                                                        </>
                                                                    )}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                    {open && Object.keys(errors).length > 0 && (
                                                        <tr className="max-md:block">
                                                            <td colSpan={10} className="px-3 pb-3 max-md:block">
                                                                <ul role="alert" className="space-y-0.5 text-xs text-red-200">
                                                                    {Object.values(errors).map(message => <li key={message}>{message}</li>)}
                                                                </ul>
                                                            </td>
                                                        </tr>
                                                    )}
                                                </Fragment>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </section>
                    );
                })}
            </div>
        </main>
    );
}
