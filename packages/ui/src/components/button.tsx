'use client';

import { Button as BaseButton } from '@base-ui/react/button';
import type { ComponentProps } from 'react';
import { cn } from '../lib/utils.ts';
import { buttonVariants, type ButtonVariantProps } from './button-variants.tsx';

export { buttonVariants };

export type ButtonProps = ComponentProps<typeof BaseButton> & ButtonVariantProps;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <BaseButton
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
