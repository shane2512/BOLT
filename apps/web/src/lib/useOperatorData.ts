"use client";

import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";

/**
 * The one demo business this operator seat manages. There is no
 * business-selection step in this build — every operator screen in this
 * product's demo is scoped to this slug, same as the public/simulator pages.
 */
export const OPERATOR_BUSINESS_SLUG = "acme-marketplace";

/**
 * Shared auth + fetch for every operator screen: redirects to sign-in if
 * there's no Privy session, attaches the access token as a bearer (the
 * shape `withOperator` in api/operator/* requires), and surfaces the
 * server's own error body rather than a generic failure.
 */
export function useOperatorData<T>(path: string) {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const router = useRouter();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) {
      router.replace("/operator/login");
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const token = await getAccessToken();
        const res = await fetch(
          `${path}${path.includes("?") ? "&" : "?"}business=${OPERATOR_BUSINESS_SLUG}`,
          { headers: { authorization: `Bearer ${token}` } }
        );
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(json.detail || json.error || `HTTP ${res.status}`);
        } else {
          setData(json);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, authenticated, path]);

  return { data, loading, error, ready, authenticated };
}

/** For interactive POSTs (the mandate editor, the setup wizard's preview) —
 * same auth header, no polling loop. */
export async function postOperator<T>(
  path: string,
  body: unknown,
  getAccessToken: () => Promise<string | null>
): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });
  return res.json();
}
