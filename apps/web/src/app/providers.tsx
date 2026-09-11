"use client";

/**
 * FR-8.2 — familiar login.
 *
 * The only Privy value that crosses to the browser is `NEXT_PUBLIC_PRIVY_APP_ID`
 * (CLAUDE.md conventions). `PRIVY_APP_SECRET` and `PRIVY_AUTHORIZATION_KEY` stay
 * server-only, and nothing in this tree imports them.
 *
 * `createOnLogin: "off"`. A beneficiary's wallet was pregenerated server-side
 * before they ever arrived (FR-8.1) and already holds their money — letting the
 * client create a second one on login would hand them an empty wallet and hide
 * the funded one.
 *
 * Worked from privy-docs /basics/react/setup.mdx.
 */
import { PrivyProvider } from "@privy-io/react-auth";

export default function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) return <>{children}</>;

  return (
    <PrivyProvider
      appId={appId}
      config={{
        // No seed phrase, no chain picker, no bridge UI (FR-8.2). Email is the
        // whole of it; the wallet is already there.
        loginMethods: ["email"],
        embeddedWallets: { ethereum: { createOnLogin: "off" } },
        appearance: { walletList: [], showWalletLoginFirst: false }
      }}
    >
      {children}
    </PrivyProvider>
  );
}
