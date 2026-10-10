'use client';

import { useCallback, useRef, useState } from 'react';
import { Check, Maximize, RotateCcw } from 'lucide-react';
import { useLiveFrame } from '@/features/phones/useLiveFrame';
import { DEFAULT_CAMERA_MASK, MAX_MASK_POINTS, validCameraMask, type MaskPoint } from '@/lib/cameras/masks';
import { cn } from '@/lib/cn';

type Notice = { kind: 'ok' | 'error'; text: string } | null;

interface MaskEditorProps
{
    code: string;
    liveDeviceId: string | null;
    videoId: string | null;
    initial: MaskPoint[] | null;
    onSaved(mask: MaskPoint[] | null): void;
}

const HIT_RADIUS_PX = 14;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

// Normalised picture coordinates of a pointer: the picture fills the box (object-fill), so box = picture.
function pointOf(svg: SVGSVGElement, event: { clientX: number; clientY: number }): MaskPoint
{
    const rect = svg.getBoundingClientRect();
    return [clamp01((event.clientX - rect.left) / (rect.width || 1)), clamp01((event.clientY - rect.top) / (rect.height || 1))];
}

// Click to add a point, drag to move one, double-click to delete it. Draws over the camera's
// own picture: the linked device's live frame, else its latest clip.
export function MaskEditor({ code, liveDeviceId, videoId, initial, onSaved }: MaskEditorProps)
{
    const svgRef = useRef<SVGSVGElement>(null);
    const [points, setPoints] = useState<MaskPoint[]>(() => (initial ?? DEFAULT_CAMERA_MASK).map(([x, y]) => [x, y] as MaskPoint));
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const [aspect, setAspect] = useState(16 / 9);
    const [saving, setSaving] = useState(false);
    const [notice, setNotice] = useState<Notice>(null);
    const live = useLiveFrame(liveDeviceId);

    const nearestHandle = useCallback((point: MaskPoint) =>
    {
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect || rect.width === 0 || rect.height === 0)
        {
            return -1;
        }
        // Hit radius in CSS pixels, measured per axis since the box is not square.
        let nearest = -1, best = HIT_RADIUS_PX;
        points.forEach(([x, y], index) =>
        {
            const distance = Math.hypot((x - point[0]) * rect.width, (y - point[1]) * rect.height);
            if (distance <= best)
            {
                best = distance;
                nearest = index;
            }
        });
        return nearest;
    }, [points]);

    const onSvgClick = useCallback((event: React.MouseEvent<SVGSVGElement>) =>
    {
        if (dragIndex !== null)
        {
            return;
        }
        const point = pointOf(svgRef.current!, event);
        if (nearestHandle(point) >= 0)
        {
            return;
        }
        setPoints(current => (current.length >= MAX_MASK_POINTS ? current : [...current, point]));
        setNotice(null);
    }, [dragIndex, nearestHandle]);

    const startDrag = useCallback((index: number) => (event: React.PointerEvent) =>
    {
        event.stopPropagation();
        setDragIndex(index);
        event.currentTarget.setPointerCapture?.(event.pointerId);
    }, []);

    const moveDrag = useCallback((event: React.PointerEvent) =>
    {
        if (dragIndex === null)
        {
            return;
        }
        const point = pointOf(svgRef.current!, event);
        setPoints(current => current.map((existing, index) => (index === dragIndex ? point : existing)));
    }, [dragIndex]);

    const removePoint = useCallback((index: number) =>
    {
        setPoints(current => current.filter((_, i) => i !== index));
        setNotice(null);
    }, []);

    async function send(polygon: MaskPoint[] | null)
    {
        setSaving(true);
        setNotice(null);
        try
        {
            const response = await fetch('/api/cameras/masks', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, polygon }),
            });
            // Errors come back as plain text, successes as JSON.
            const text = await response.text();
            let data: { ok?: boolean; polygon?: MaskPoint[] | null; researchFile?: 'written' | 'failed' } = {};
            try { data = JSON.parse(text) as typeof data; } catch { /* plain-text error */ }
            if (!response.ok || !data.ok)
            {
                throw new Error(text.trim() || `Save failed (${response.status})`);
            }
            const saved = data.polygon ?? null;
            if (saved)
            {
                setPoints(saved);
            }
            onSaved(saved);
            setNotice({ kind: 'ok', text: data.researchFile === 'failed' ? 'Saved. The simulator\'s mask file could not be written (check MASKS_ROOT).' : 'Saved.' });
        }
        catch (error)
        {
            setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Save failed' });
        }
        finally
        {
            setSaving(false);
        }
    }

    const startOver = () =>
    {
        setPoints(DEFAULT_CAMERA_MASK.map(([x, y]) => [x, y] as MaskPoint));
        setNotice(null);
    };

    const picture = 'absolute inset-0 block h-full w-full object-fill';
    const button = 'inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/12 px-2.5 text-xs text-ink hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-amber disabled:opacity-40';

    return (
        <div className="space-y-2">
            <div className="relative w-full overflow-hidden rounded-lg border border-amber/25 bg-night-950" style={{ aspectRatio: aspect }}>
                {liveDeviceId
                    ? (live.url
                        ? <img src={live.url} alt={`Live picture from ${code}`} className={picture} onLoad={event => { const { naturalWidth: w, naturalHeight: h } = event.currentTarget; if (w && h) setAspect(w / h); }} />
                        : <div className="absolute inset-0 grid place-items-center bg-night-900"><p className="text-xs text-ink-muted">Waiting for the live picture…</p></div>)
                    : videoId
                        ? <video src={`/api/media/video/${videoId}?variant=raw`} muted loop autoPlay playsInline className={picture} onLoadedMetadata={event => { const { videoWidth: w, videoHeight: h } = event.currentTarget; if (w && h) setAspect(w / h); }} />
                        : <div className="absolute inset-0 grid place-items-center bg-white/[0.06]"><p className="text-xs text-ink-muted">No picture yet; you can still draw the area.</p></div>}
                <svg
                    ref={svgRef}
                    viewBox="0 0 1 1"
                    preserveAspectRatio="none"
                    className={cn('absolute inset-0 h-full w-full cursor-crosshair', dragIndex !== null && 'cursor-grabbing')}
                    onClick={onSvgClick}
                    onPointerMove={moveDrag}
                    onPointerUp={() => setDragIndex(null)}
                    aria-label={`Edit ${code} watch mask`}
                >
                    <polygon
                        points={points.map(point => point.join(',')).join(' ')}
                        fill="rgba(255,181,71,0.12)"
                        stroke="#FFB547"
                        strokeWidth={1.5}
                        strokeDasharray="10 7"
                        vectorEffect="non-scaling-stroke"
                    />
                    {points.map((point, index) => (
                        <ellipse
                            key={index}
                            cx={point[0]} cy={point[1]} rx={0.008} ry={0.008 * aspect}
                            fill="#FFB547" stroke="#07151a" strokeWidth={2}
                            vectorEffect="non-scaling-stroke"
                            data-handle
                            style={{ cursor: 'grab' }}
                            onPointerDown={startDrag(index)}
                            onDoubleClick={event => { event.stopPropagation(); removePoint(index); }}
                        />
                    ))}
                </svg>
                <span className="pointer-events-none absolute top-2 right-2 rounded-md bg-night-950/75 px-1.5 py-0.5 text-[10px] tracking-[0.12em] text-amber uppercase ring-1 ring-amber/30">
                    Watch area · {code}
                </span>
            </div>
            <p className="text-[11px] leading-relaxed text-ink-muted">This mask applies to camera {code} only. People whose feet are outside it are drawn in grey and never raise a camera alert. With no mask, the whole picture counts.</p>
            <p className="text-[11px] leading-relaxed text-ink-muted">Simulated clips: the simulator uses one watch area for all odd-numbered cameras and one for all even-numbered cameras, taken from the most recently saved mask of each kind.</p>
            <p className="text-[11px] leading-relaxed text-ink-muted">Click the picture to add a point, drag a point to move it, double-click a point to delete it.</p>
            <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => send(points)} disabled={saving || !validCameraMask(points)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-amber px-3 text-xs font-semibold text-night-950 transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-amber disabled:opacity-40">
                    <Check aria-hidden className="h-4 w-4" />{saving ? 'Saving…' : 'Save'}
                </button>
                <button type="button" onClick={() => send(null)} disabled={saving} className={button}>
                    <Maximize aria-hidden className="h-3.5 w-3.5" />Use whole picture
                </button>
                <button type="button" onClick={startOver} disabled={saving} className={button}>
                    <RotateCcw aria-hidden className="h-3.5 w-3.5" />Start over
                </button>
                <p role="status" aria-live="polite" className={cn('text-xs', notice?.kind === 'error' ? 'text-[#E2581F]' : 'text-emerald-400')}>{notice?.text}</p>
            </div>
        </div>
    );
}
