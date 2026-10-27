import { cva, type VariantProps } from 'class-variance-authority';

// shadcn (base-nova) button on Base UI. Calm by design: no glow, no bounce (ADR-0007).
export const buttonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md',
    'text-sm font-medium select-none outline-none',
    'transition-colors duration-(--duration-fast)',
    'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    'disabled:pointer-events-none disabled:opacity-50 data-disabled:pointer-events-none data-disabled:opacity-50',
  ],
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        outline: 'border border-border bg-transparent hover:bg-muted',
        ghost: 'hover:bg-muted',
        up: 'bg-up text-up-foreground hover:bg-up/90',
        down: 'bg-down text-down-foreground hover:bg-down/90',
      },
      size: {
        sm: 'h-7 px-2.5 text-xs',
        default: 'h-8 px-3',
        lg: 'h-10 px-4',
        icon: "size-8 [&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export type ButtonVariantProps = VariantProps<typeof buttonVariants>;
