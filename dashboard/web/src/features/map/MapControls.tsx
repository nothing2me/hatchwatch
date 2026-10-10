'use client';

import { Layers, Maximize, Minus, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { GlassPanel } from '@/components/ui/glass-panel';
import { cn } from '@/lib/cn';

export type LayerKey = 'zones' | 'cameras' | 'alerts' | 'trails';

interface MapControlsProps
{
    onZoomIn: () => void;
    onZoomOut: () => void;
    onFit: () => void;
    layers: Record<LayerKey, boolean>;
    onToggleLayer: (key: LayerKey) => void;
    // Present only for admins; the server re-checks every edit.
    editing?: boolean;
    onToggleEdit?: () => void;
}

const layerLabels: Record<LayerKey, string> = { zones: 'Zones', cameras: 'Cameras', alerts: 'Alerts', trails: 'Trails' };
const buttonClass = 'grid h-9 w-9 place-items-center text-ink-muted transition-colors hover:bg-white/10 hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-amber aria-expanded:bg-white/10 aria-expanded:text-ink';

export function MapControls({ onZoomIn, onZoomOut, onFit, layers, onToggleLayer, editing = false, onToggleEdit }: MapControlsProps)
{
    const [layersOpen, setLayersOpen] = useState(false);

    return (
        <div className="pointer-events-auto relative flex flex-col items-end gap-2">
            <GlassPanel className="flex flex-col divide-y divide-white/8 overflow-hidden">
                <button type="button" className={buttonClass} onClick={onZoomIn} aria-label="Zoom in"><Plus className="h-4 w-4" /></button>
                <button type="button" className={buttonClass} onClick={onZoomOut} aria-label="Zoom out"><Minus className="h-4 w-4" /></button>
                <button type="button" className={buttonClass} onClick={onFit} aria-label="Fit beach"><Maximize className="h-4 w-4" /></button>
                <button type="button" className={buttonClass} onClick={() => setLayersOpen(!layersOpen)} aria-label="Map layers" aria-expanded={layersOpen}><Layers className="h-4 w-4" /></button>
            </GlassPanel>
            {onToggleEdit && (
                <GlassPanel className={cn('overflow-hidden', editing && 'border-amber/50 ring-2 ring-amber/25')}>
                    <button
                        type="button"
                        className={cn(buttonClass, editing && 'bg-amber text-night-950 hover:bg-amber hover:text-night-950')}
                        onClick={onToggleEdit}
                        aria-label="Edit cameras"
                        aria-pressed={editing}
                        title={editing ? 'Finish editing cameras' : 'Edit cameras'}
                    >
                        <Pencil className="h-4 w-4" />
                    </button>
                </GlassPanel>
            )}
            {layersOpen && (
                <GlassPanel className="absolute top-27 right-11 w-40 p-1.5 text-sm">
                    <p className="px-2 pt-1 pb-1.5 text-[10px] font-semibold tracking-[0.16em] text-ink-muted uppercase">Layers</p>
                    {(Object.keys(layerLabels) as LayerKey[]).map(key => (
                        <label key={key} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-white/6">
                            <input type="checkbox" checked={layers[key]} onChange={() => onToggleLayer(key)} className="accent-amber" />
                            {layerLabels[key]}
                        </label>
                    ))}
                </GlassPanel>
            )}
        </div>
    );
}
