'use client';

import type { DetectedObject, DetectionsView } from '@/lib/types';
import { cn } from '@/lib/cn';

export const DETECTION_NOTE = 'Detection is a viewing aid; it can miss people and mistake objects.';
const RULE_NOTE = 'Possible turtle (rule): a slow, wide moving shape, not a confirmed turtle.';

const PALETTE = ['#F5B544', '#5AC8FA', '#FF7AB6', '#7CE38B', '#B69CFF', '#FF9F5A'];

// One colour per track; possible turtles start half way round the palette so P1 and T1 differ.
export function trackColor(track: string): string
{
    const n = Number(String(track ?? '').slice(1));
    const index = (Number.isFinite(n) ? n - 1 : 0) + (String(track ?? '')[0] === 'T' ? 3 : 0);
    return PALETTE[((Math.trunc(index) % 6) + 6) % 6];
}

export function objectLabel(object: DetectedObject): string
{
    if (object.label === 'person')
    {
        return typeof object.score === 'number' && Number.isFinite(object.score) ? `person ${object.score.toFixed(2)}` : 'person';
    }
    return 'possible turtle';
}

export function detectionCounts(d: DetectionsView): { people: number; turtles: number }
{
    const objects = Array.isArray(d?.objects) ? d.objects : [];
    return {
        people: objects.filter(object => object?.label === 'person').length,
        turtles: objects.filter(object => object?.label === 'possible turtle').length,
    };
}

function clamp(value: number, max: number): number
{
    return Math.min(Math.max(value, 0), max);
}

// The box cut to the picture, or null when it is broken or falls outside it.
function clampBox(box: unknown, width: number, height: number): [number, number, number, number] | null
{
    if (!Array.isArray(box) || box.length !== 4 || !box.every(value => typeof value === 'number' && Number.isFinite(value)))
    {
        return null;
    }
    const [x, y, w, h] = box as number[];
    const x0 = clamp(x, width);
    const y0 = clamp(y, height);
    const x1 = clamp(x + w, width);
    const y1 = clamp(y + h, height);
    return x1 > x0 && y1 > y0 ? [x0, y0, x1 - x0, y1 - y0] : null;
}

function trailPoints(points: unknown, width: number, height: number): [number, number][]
{
    if (!Array.isArray(points))
    {
        return [];
    }
    return points
        .filter((point): point is number[] => Array.isArray(point) && point.length >= 3 && Number.isFinite(point[1]) && Number.isFinite(point[2]))
        .map(point => [clamp(point[1], width), clamp(point[2], height)]);
}

// Boxes, labels and fading trails in the picture's own pixels; object-contain letterboxing is matched by xMidYMid meet.
export function DetectionOverlay({ detections }: { detections: DetectionsView })
{
    const { width, height } = detections ?? {};
    if (!(typeof width === 'number' && width > 0 && typeof height === 'number' && height > 0))
    {
        return null;
    }
    const objects = Array.isArray(detections.objects) ? detections.objects : [];
    const trails = Array.isArray(detections.trails) ? detections.trails : [];
    const fontSize = Math.max(10, height / 22);
    return (
        <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
            {trails.map((trail, t) =>
            {
                const points = trailPoints(trail?.points, width, height);
                const n = points.length - 1;
                if (n < 1)
                {
                    return null;
                }
                const color = trackColor(trail.track);
                return (
                    <g key={`trail-${trail.track}-${t}`}>
                        {points.slice(1).map((point, i) => (
                            <line key={i} data-track={trail.track} x1={points[i][0]} y1={points[i][1]} x2={point[0]} y2={point[1]} stroke={color} strokeOpacity={n === 1 ? 1 : 0.2 + 0.8 * i / (n - 1)} strokeWidth={2} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                        ))}
                    </g>
                );
            })}
            {objects.map((object, i) =>
            {
                const box = clampBox(object?.box, width, height);
                if (!box)
                {
                    return null;
                }
                const [x, y, w, h] = box;
                const color = trackColor(object.track);
                const turtle = object.label !== 'person';
                return (
                    <g key={`object-${object.track}-${i}`} data-track={object.track}>
                        {turtle && <title>Possible turtle (rule)</title>}
                        <rect data-track={object.track} x={x} y={y} width={w} height={h} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
                        <text x={x + 1} y={y < 12 ? y + fontSize : y - 3} fontSize={fontSize} fontFamily="ui-monospace, monospace" fontWeight={600} fill={color} stroke="#070D13" strokeWidth={3} strokeLinejoin="round" paintOrder="stroke">{objectLabel(object)}</text>
                    </g>
                );
            })}
        </svg>
    );
}

// The counts line, or why there are none.
export function DetectionStatus({ detections, className }: { detections: DetectionsView | null; className?: string })
{
    if (!detections)
    {
        return <p className={cn('text-[11px] text-ink-muted', className)}>Detection off</p>;
    }
    if (detections.dark)
    {
        return <p className={cn('text-[11px] text-ink-muted', className)}>Too dark to detect</p>;
    }
    const { people, turtles } = detectionCounts(detections);
    return <p className={cn('font-mono text-[11px] text-ink', className)}>People {people} · Possible turtles {turtles}</p>;
}

export function DetectionNote({ detections, className }: { detections: DetectionsView | null; className?: string })
{
    if (!detections)
    {
        return null;
    }
    return (
        <div className={cn('space-y-0.5', className)}>
            <p className="text-[11px] text-ink-muted">{DETECTION_NOTE}</p>
            <p className="text-[11px] text-ink-muted">{RULE_NOTE}</p>
        </div>
    );
}
