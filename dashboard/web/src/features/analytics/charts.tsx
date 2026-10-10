'use client';

import { useEffect, useRef, useState } from 'react';
import type { Bar } from './metrics';
import { percentOf } from './metrics';

// Hand-built SVG charts. Text stays in ink tokens; only marks carry colour.
const INK = '#D7E3EA';
const MUTED = '#8A9BA6';
const GRID = 'rgba(215, 227, 234, 0.07)';
const BASELINE = 'rgba(215, 227, 234, 0.22)';

// Width of the element, measured so SVG text stays at its real pixel size.
function useWidth(fallback: number)
{
    const ref = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(fallback);
    useEffect(() =>
    {
        const element = ref.current;
        if (!element || typeof ResizeObserver === 'undefined')
        {
            return undefined;
        }
        const observer = new ResizeObserver(entries =>
        {
            const next = Math.round(entries[0].contentRect.width);
            if (next > 0)
            {
                setWidth(next);
            }
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    return [ref, width] as const;
}

// Clean tick step (1, 2, 5 × 10ⁿ) giving at most four intervals.
export function niceTicks(max: number): number[]
{
    const top = Math.max(max, 1);
    let step = 1;
    for (let magnitude = 1; ; magnitude *= 10)
    {
        const candidate = [1, 2, 5].map(m => m * magnitude).find(s => Math.ceil(top / s) <= 4);
        if (candidate)
        {
            step = candidate;
            break;
        }
    }
    const end = Math.ceil(top / step) * step;
    const ticks: number[] = [];
    for (let value = 0; value <= end; value += step)
    {
        ticks.push(value);
    }
    return ticks;
}

// A bar growing right from x0: square at the baseline, 4px rounded data end.
function barPath(x0: number, y: number, length: number, thickness: number): string
{
    const r = Math.min(4, length / 2, thickness / 2);
    const x1 = x0 + length;
    return `M${x0},${y}H${x1 - r}A${r},${r} 0 0 1 ${x1},${y + r}V${y + thickness - r}A${r},${r} 0 0 1 ${x1 - r},${y + thickness}H${x0}Z`;
}

const fit = (text: string, px: number, charPx: number) => (text.length * charPx <= px ? text : `${text.slice(0, Math.max(1, Math.floor(px / charPx) - 1))}…`);

interface BarChartProps
{
    title: string;
    bars: Bar[];
    total: number;           // denominator for the tooltip percentage
    axisLabel?: string;
}

export function BarChart({ title, bars, total, axisLabel = 'Sites' }: BarChartProps)
{
    const [ref, width] = useWidth(340);
    const [hover, setHover] = useState<number | null>(null);
    const hasDetail = bars.some(bar => bar.detail);

    // Label column sized to the longest label, capped so the bars keep most of the width.
    const wanted = 22 + Math.max(...bars.map(bar => Math.max(bar.label.length * 6.6, (bar.detail?.length ?? 0) * 5.6)), 40);
    const labelW = Math.round(Math.min(wanted, width * 0.42));
    const valueW = 34;
    const rowH = hasDetail ? 44 : 36;
    const thickness = 14;
    const top = 6;
    const plotH = bars.length * rowH;
    const axisH = 40;
    const height = top + plotH + axisH;
    const x0 = labelW + 4;
    const plotW = Math.max(40, width - x0 - valueW);
    const ticks = niceTicks(Math.max(0, ...bars.map(bar => bar.count)));
    const xMax = ticks[ticks.length - 1];
    const x = (value: number) => x0 + (value / xMax) * plotW;
    const summary = `${title}: ${bars.map(bar => `${bar.label} ${bar.count}`).join(', ')}`;
    const hovered = hover === null ? null : bars[hover];

    return (
        <div ref={ref} className="relative">
            <svg role="img" aria-label={summary} width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block max-w-full overflow-visible" onMouseLeave={() => setHover(null)}>
                {/* Vertical gridlines + tick labels */}
                {ticks.map(tick => (
                    <g key={tick}>
                        <line x1={x(tick)} x2={x(tick)} y1={top - 2} y2={top + plotH} stroke={tick === 0 ? BASELINE : GRID} strokeWidth={1} shapeRendering="crispEdges" />
                        <text x={x(tick)} y={top + plotH + 15} textAnchor="middle" fontSize={10} fill={MUTED} className="font-mono tabular-nums">{tick}</text>
                    </g>
                ))}
                <text x={x0 + plotW / 2} y={top + plotH + 33} textAnchor="middle" fontSize={10} letterSpacing="0.14em" fill={MUTED} className="uppercase">{axisLabel}</text>

                {bars.map((bar, index) =>
                {
                    const rowTop = top + index * rowH;
                    const barY = rowTop + (rowH - thickness) / 2;
                    const length = (bar.count / xMax) * plotW;
                    const active = hover === index;
                    const labelY = bar.detail ? rowTop + rowH / 2 - 3 : rowTop + rowH / 2 + 4;
                    return (
                        <g key={bar.key} onMouseEnter={() => setHover(index)} data-testid={`bar-${bar.key}`}>
                            <rect x={0} y={rowTop + 2} width={width} height={rowH - 4} rx={6} fill={active ? 'rgba(215,227,234,0.045)' : 'transparent'} />
                            <circle cx={6} cy={bar.detail ? labelY - 4 : labelY - 4} r={3.5} fill={bar.color} />
                            <text x={16} y={labelY} fontSize={12} fill={INK}>{fit(bar.label, labelW - 18, 6.6)}</text>
                            {bar.detail && <text x={16} y={labelY + 14} fontSize={10.5} fill={MUTED}>{fit(bar.detail, labelW - 18, 5.6)}</text>}
                            {length > 0 && <path d={barPath(x0, barY, length, thickness)} fill={bar.color} opacity={hover === null || active ? 1 : 0.55} />}
                            <text x={x0 + length + 7} y={barY + thickness / 2 + 4} fontSize={12} fill={bar.count > 0 ? INK : MUTED} fontWeight={600} className="font-mono tabular-nums">{bar.count}</text>
                        </g>
                    );
                })}
            </svg>
            {hovered && hover !== null && (
                <div
                    role="tooltip"
                    className="pointer-events-none absolute z-10 -translate-y-full rounded-lg border border-white/10 bg-night-900/95 px-2.5 py-1.5 text-xs whitespace-nowrap shadow-xl shadow-black/50"
                    style={x(hovered.count) > width / 2 ? { right: 0, top: top + hover * rowH + 2 } : { left: x(hovered.count) + 8, top: top + hover * rowH + 2 }}
                >
                    <span className="flex items-center gap-1.5 text-ink"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: hovered.color }} />{hovered.label}{hovered.detail ? ` · ${hovered.detail}` : ''}</span>
                    <span className="mt-0.5 block font-mono text-ink-muted tabular-nums">{hovered.count} {hovered.count === 1 ? 'site' : 'sites'} · {percentOf(hovered.count, total)}%</span>
                </div>
            )}
        </div>
    );
}

export interface Segment
{
    key: string;
    label: string;
    count: number;
    color: string;
}

// One stacked bar; 2px surface gaps between segments, rounded only at the outer ends.
export function StackedBar({ title, segments }: { title: string; segments: Segment[] })
{
    const [ref, width] = useWidth(600);
    const height = 16;
    const gap = 2;
    const total = segments.reduce((sum, segment) => sum + segment.count, 0);
    const shown = segments.filter(segment => segment.count > 0);
    const usable = width - gap * Math.max(0, shown.length - 1);
    const summary = `${title}: ${segments.map(segment => `${segment.count} ${segment.label.toLowerCase()}`).join(', ')}`;
    let cursor = 0;

    return (
        <div ref={ref}>
            <svg role="img" aria-label={summary} width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block max-w-full">
                <defs>
                    <clipPath id={`clip-${title.replace(/\W/g, '')}`}>
                        <rect width={width} height={height} rx={height / 2} />
                    </clipPath>
                </defs>
                <g clipPath={`url(#clip-${title.replace(/\W/g, '')})`}>
                    <rect width={width} height={height} fill="rgba(215,227,234,0.06)" />
                    {total > 0 && shown.map(segment =>
                    {
                        const w = (segment.count / total) * usable;
                        const start = cursor;
                        cursor += w + gap;
                        return (
                            <rect key={segment.key} x={start} width={w} height={height} fill={segment.color}>
                                <title>{`${segment.label}: ${segment.count} (${percentOf(segment.count, total)}%)`}</title>
                            </rect>
                        );
                    })}
                </g>
            </svg>
        </div>
    );
}
