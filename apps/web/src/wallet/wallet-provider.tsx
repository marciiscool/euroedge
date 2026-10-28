'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { createConfig, WagmiProvider } from '@privy-io/wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { http } from 'viem';
import { CHAIN, PRIVY_APP_ID } from './config';

const wagmiConfig = createConfig({ chains: [CHAIN], transports: { [CHAIN.id]: http() } });

/** Privy (email, Google, external wallets) + wagmi 2, ADR-0020. Loaded lazily on the trade page. */
export function WalletProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ['email', 'google', 'wallet'],
        appearance: {
          theme: 'dark',
          walletChainType: 'ethereum-only',
          showWalletLoginFirst: false,
        },
        defaultChain: CHAIN,
        supportedChains: [CHAIN],
        embeddedWallets: {
          ethereum: { createOnLogin: 'users-without-wallets' },
          // Embedded wallets sign the SIWE message without a dialog: one-step login.
          showWalletUIs: false,
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>{children}</WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
