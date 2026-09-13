"use client";

/**
 * The operator seat's data, fetched once and sliced by every screen.
 *
 * `/api/operator/business` is deliberately one call for coverage, accounts,
 * activity, mandates, unlocks and findings — the route says so itself. The
 * workflow store is a separate call because "no unlock requests exist" and "we
 * could not ask" are different screens and must never collapse into one.
 *
 * Both routes need the browser's Privy access token as a bearer
 * (privy-docs /authentication/user-authentication/access-tokens: the token
 * comes from `usePrivy().getAccessToken()`).
 */
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import type { ChainPayload, WorkflowPayload } from "./chain";

export interface SessionPayload {
  session?: { userId: string; expiresAt: number };
  businesses?: { slug: string; id: string }[];
  indexError?: string | null;
  workflowStore?: { ok: boolean; error?: string };
  scope?: string;
  error?: string;
  detail?: string;
}

interface OperatorValue {
  ready: boolean;
  authenticated: boolean;
  loading: boolean;
  slug: string | null;
  setSlug: (s: string) => void;
  session: SessionPayload | null;
  chain: ChainPayload | null;
  workflow: WorkflowPayload | null;
  /** Transport-level failure — not a business-level "not found". */
  fetchError: string | null;
  refresh: () => void;
  authedFetch: (input: string, init?: RequestInit) => Promise<Response>;
}

const Ctx = createContext<OperatorValue | null>(null);

const SLUG_KEY = "bolt.business";

export function OperatorProvider({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const [slug, setSlugState] = useState<string | null>(null);
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [chain, setChain] = useState<ChainPayload | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const authedFetch = useCallback(
    async (input: string, init?: RequestInit): Promise<Response> => {
      const token = await getAccessToken();
      return fetch(input, {
        ...init,
        headers: {
          ...(init?.body ? { "content-type": "application/json" } : {}),
          ...(init?.headers ?? {}),
          ...(token ? { authorization: `Bearer ${token}` } : {})
        }
      });
    },
    [getAccessToken]
  );

  const setSlug = useCallback((s: string) => {
    setSlugState(s);
    try {
      localStorage.setItem(SLUG_KEY, s);
    } catch {
      /* a browser that refuses storage still works; the choice just won't stick */
    }
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SLUG_KEY);
      if (stored) setSlugState(stored);
    } catch {
      /* ignore */
    }
  }, []);

  // Session first — it is what tells us which businesses the index has heard of.
  useEffect(() => {
    if (!ready || !authenticated) return;
    let live = true;
    void (async () => {
      try {
        const res = await authedFetch("/api/operator/session");
        const body = (await res.json()) as SessionPayload;
        if (!live) return;
        setSession(body);
        if (!slug && body.businesses?.[0]) setSlug(body.businesses[0].slug);
      } catch (error) {
        if (live) setFetchError(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      live = false;
    };
    // `slug` is read but deliberately not a dependency: re-reading the session
    // every time the operator switches business would be a wasted round trip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, authenticated, authedFetch, nonce]);

  useEffect(() => {
    if (!ready || !authenticated || !slug) return;
    let live = true;
    setLoading(true);
    void (async () => {
      try {
        const [c, w] = await Promise.all([
          authedFetch(`/api/operator/business?business=${encodeURIComponent(slug)}`),
          authedFetch(`/api/operator/workflow?business=${encodeURIComponent(slug)}`)
        ]);
        if (!live) return;
        setChain((await c.json()) as ChainPayload);
        setWorkflow((await w.json()) as WorkflowPayload);
        setFetchError(null);
      } catch (error) {
        if (live) setFetchError(error instanceof Error ? error.message : String(error));
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [ready, authenticated, slug, authedFetch, nonce]);

  return (
    <Ctx.Provider
      value={{
        ready,
        authenticated,
        loading,
        slug,
        setSlug,
        session,
        chain,
        workflow,
        fetchError,
        refresh: () => setNonce((n) => n + 1),
        authedFetch
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useOperator(): OperatorValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useOperator outside OperatorProvider");
  return v;
}
