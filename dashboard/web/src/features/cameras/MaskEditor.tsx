'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import { DEFAULT_MASK, MASK_FRAME, MAX_MASK_POINTS, clampPolygon } from '@/lib/cameras/masks';
import { cn } from '@/lib/cn';

type Notice = { kind: 'ok' | 'error'; text: string } | null;

const HIT_RADIUS_PX = 14;

function pointOf(svg: SVGSVGElement, event: { clientX: number; clientY: number }): [number, number]
{
    const rect = svg.getBoundingClientRect();
    return [((event.clientX - rect.left) / rect.width) * MASK_FRAME[0], ((event.clientY - rect.top) / rect.height) * MASK_FRAME[1]];
}

// Click to spawn mask points, drag points to adjust, double-click to remove one.
// Saving writes the shared camera-masks.json the runner applies.
// Points stay in source-frame pixels (the SVG's viewBox) from load to save.
export function MaskEditor({ cameraIndex, code, videoUrl }: { cameraIndex: number; code: string; videoUrl: string | null })
{
    const svgRef = useRef<SVGSVGElement>(null);
    const [points, setPoints] = useState<[number, number][] | null>(null);
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const [saving, setSaving] = useState(false);
    const [notice, setNotice] = useState<Notice>(null);
    const [source, setSource] = useState('');

    useEffect(() =>
    {
        let cancelled = false;
        fetch('/api/cameras/masks')
            .then(response => response.json())
            .then(data =>
            {
                if (cancelled) return;
                const masks = data as { source?: string; cameras?: { camera: number; polygon: [number, number][] }[] };
                setSource(masks.source ?? '');
                const entry = (masks.cameras ?? []).find(candidate => candidate.camera === cameraIndex);
                setPoints(clampPolygon(entry?.polygon ?? DEFAULT_MASK));
            })
            .catch(() => { if (!cancelled) setPoints(clampPolygon(DEFAULT_MASK)); });
        return () => { cancelled = true; };
    }, [cameraIndex]);

    const nearestHandle = useCallback((pixel: [number, number]) =>
    {
        if (!points || !svgRef.current) return -1;
        const rect = svgRef.current.getBoundingClientRect();
        const scale = Math.max(MASK_FRAME[0] / rect.width, MASK_FRAME[1] / rect.height);
        let nearest = -1, best = HIT_RADIUS_PX * scale;
        points.forEach((point, index) =>
        {
            const distance = Math.hypot(point[0] - pixel[0], point[1] - pixel[1]);
            if (distance <= best)
            {
                best = distance;
                nearest = index;
            }
        });
        return nearest;
    }, [points]);

    const addPoint = useCallback((pixel: [number, number]) =>
    {
        setPoints(current =>
        {
            if (!current || current.length >= MAX_MASK_POINTS) return current;
            return [...current, [Math.max(0, Math.min(MASK_FRAME[0], pixel[0])), Math.max(0, Math.min(MASK_FRAME[1], pixel[1]))]];
        });
    }, []);

    const onSvgClick = useCallback((event: React.MouseEvent<SVGSVGElement>) =>
    {
        if (dragIndex !== null) return;
        const pixel = pointOf(svgRef.current!, event);
        if (nearestHandle(pixel) >= 0) return;
        addPoint(pixel);
    }, [addPoint, dragIndex, nearestHandle]);

    const startDrag = useCallback((index: number) => (event: React.PointerEvent) =>
    {
        event.stopPropagation();
        setDragIndex(index);
        event.currentTarget.setPointerCapture?.(event.pointerId);
    }, []);

    const moveDrag = useCallback((event: React.PointerEvent) =>
    {
        if (dragIndex === null) return;
        const pixel = pointOf(svgRef.current!, event);
        setPoints(current => current ? current.map((point, index) => index === dragIndex
            ? [Math.max(0, Math.min(MASK_FRAME[0], pixel[0])), Math.max(0, Math.min(MASK_FRAME[1], pixel[1]))]
            : point) : current);
    }, [dragIndex]);

    const endDrag = useCallback(() => setDragIndex(null), []);

    const removePoint = useCallback((index: number) =>
    {
        setPoints(current => current && current.length > 3 ? current.filter((_, i) => i !== index) : current);
    }, []);

    async function save()
    {
        if (!points) return;
        setSaving(true);
        setNotice(null);
        try
        {
            const response = await fetch('/api/cameras/masks', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ camera: cameraIndex, polygon: clampPolygon(points) }),
            });
            // Errors come back as plain text, successes as JSON.
            const text = await response.text();
            let data: { ok?: boolean; error?: string } = {};
            try { data = JSON.parse(text) as typeof data; } catch { /* plain-text error */ }
            if (!response.ok || !data.ok)
            {
                throw new Error(data.error ?? (text.trim() || `Save failed (${response.status})`));
            }
            setSource('public');
            setNotice({ kind: 'ok', text: `Saved ${code} mask — the next recorded clip will compute motion only inside it.` });
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

    const reset = () =>
    {
        setPoints(clampPolygon(DEFAULT_MASK));
        setNotice(null);
    };

    const drawing = points !== null;

    return (
        <div className="space-y-2">
            <div className="relative overflow-hidden rounded-lg border border-amber/25 bg-night-950">
                {videoUrl ? (
                    <video className="block aspect-video w-full object-cover" src={videoUrl} autoPlay muted loop playsInline />
                ) : (
                    <div className="grid aspect-video w-full place-items-center bg-gradient-to-b from-sky-950/60 to-night-900">
                        <p className="text-xs text-ink-muted">No footage recorded for {code} yet — draw the mask to define where motion will be watched.</p>
                    </div>
                )}
                {drawing && (
                    <svg
                        ref={svgRef}
                        viewBox={`0 0 ${MASK_FRAME[0]} ${MASK_FRAME[1]}`}
                        className={cn('absolute inset-0 h-full w-full cursor-crosshair', dragIndex !== null && 'cursor-grabbing')}
                        onClick={onSvgClick}
                        onPointerMove={moveDrag}
                        onPointerUp={endDrag}
                        onPointerLeave={() => dragIndex === null && undefined}
                        aria-label={`Edit ${code} watch mask`}
                    >
                        <polygon
                            points={points!.map(point => point.join(',')).join(' ')}
                            fill="rgba(255,181,71,0.10)"
                            stroke="#FFB547"
                            strokeWidth={1.5}
                            strokeDasharray="12 9"
                            vectorEffect="non-scaling-stroke"
                        />
                        {points!.map((point, index) => (
                            <circle
                                key={`${point[0]}-${point[1]}-${index}`}
                                cx={point[0]} cy={point[1]} r={9}
                                fill="#FFB547" stroke="#07151a" strokeWidth={2}
                                vectorEffect="non-scaling-stroke"
                                style={{ cursor: 'grab' }}
                                onPointerDown={startDrag(index)}
                                onDoubleClick={event => { event.stopPropagation(); removePoint(index); }}
                            />
                        ))}
                    </svg>
                )}
                <span className="absolute top-2 right-2 rounded-md bg-night-950/75 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-amber ring-1 ring-amber/30">
                    Editing mask · {code}
                </span>
            </div>
            <p className="text-[11px] leading-relaxed text-ink-muted">
                Click the frame to add a point, drag points to shape the sand area, double-click a point to remove it.
                Only motion inside the polygon is computed; the raw feed is unchanged.
                {source === 'default' && ' No saved mask yet — saving creates the shared config.'}
            </p>
            <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={save} disabled={saving || !drawing}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-amber px-3 text-xs font-semibold text-night-950 transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-amber disabled:opacity-40">
                    <Check aria-hidden className="h-4 w-4" /> {saving ? 'Saving…' : 'Save mask'}
                </button>
                <button type="button" onClick={reset} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/12 px-2.5 text-xs text-ink hover:bg-white/8">
                    <RotateCcw aria-hidden className="h-3.5 w-3.5" /> Reset
                </button>
                {notice?.kind === 'ok' ? (
                    <p className="text-xs text-emerald-400">{notice.text}</p>
                ) : notice?.kind === 'error' ? (
                    <p className="text-xs text-[#E2581F]">{notice.text}</p>
                ) : null}
            </div>
        </div>
    );
}