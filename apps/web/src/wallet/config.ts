import { baseSepolia } from 'viem/chains';

/** Privy app id (ADR-0020). Empty: wallet sign-in is hidden and only the dev login shows. */
export const PRIVY_APP_ID = process.env['NEXT_PUBLIC_PRIVY_APP_ID'] ?? '';
export const walletSignInEnabled = PRIVY_APP_ID !== '';

/** Base Sepolia only (brief §12). */
export const CHAIN = baseSepolia;
