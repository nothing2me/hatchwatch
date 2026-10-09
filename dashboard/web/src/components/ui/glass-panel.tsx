import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

// Translucent floating panel used over the map.
export function GlassPanel({ className, ...props }: HTMLAttributes<HTMLDivElement>)
{
    return (
        <div
            className={cn('rounded-xl border border-white/8 bg-[rgba(8,14,20,0.82)] shadow-2xl shadow-black/40 backdrop-blur-md', className)}
            {...props}
        />
    );
}
