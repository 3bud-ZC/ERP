import React from 'react';
import { cn } from '@/lib/utils';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant = 'default', size = 'default', ...props }, ref) => {
    const variants = {
      default: 'neo-raised text-indigo-700 hover:text-indigo-800 active:scale-[0.99]',
      destructive: 'neo-raised text-red-700 hover:text-red-800 active:scale-[0.99]',
      outline: 'neo-inset text-slate-700 hover:text-indigo-700',
      secondary: 'neo-raised text-violet-700 hover:text-violet-800 active:scale-[0.99]',
      ghost: 'text-slate-700 hover:bg-slate-100',
      link: 'text-indigo-700 hover:text-violet-700 underline-offset-4 hover:underline',
    } as const;
    const sizes = {
      default: 'h-10 px-4',
      sm: 'h-8 px-3 text-xs',
      lg: 'h-11 px-5',
      icon: 'h-10 w-10 p-0',
    } as const;
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors focus:outline-none focus:ring-4 focus:ring-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed',
          variants[variant],
          sizes[size],
          className,
        )}
        {...props}
      />
    );
  }
);

Button.displayName = 'Button';
