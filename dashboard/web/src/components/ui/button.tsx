import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'ghost';
type Size = 'sm' | 'md' | 'icon';

const variants: Record<Variant, string> = {
    primary: 'bg-amber text-night-950 hover:bg-amber/90 font-semibold',
    ghost: 'bg-white/5 text-ink hover:bg-white/10 border border-white/10',
};

const sizes: Record<Size, string> = {
    sm: 'h-8 px-3 text-sm',
    md: 'h-10 px-4',
    icon: 'h-9 w-9 p-0',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>
{
    variant?: Variant;
    size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    { className, variant = 'ghost', size = 'md', type = 'button', ...props }, ref)
{
    return (
        <button
            ref={ref}
            type={type}
            className={cn(
                'inline-flex items-center justify-center gap-2 rounded-lg transition-colors',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber disabled:opacity-50',
                variants[variant], sizes[size], className)}
            {...props}
        />
    );
});
