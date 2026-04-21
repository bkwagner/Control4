import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export function useItemStates(
  itemIds: number[],
): { states: Map<number, unknown[]>; error: string | null } {
  const [states, setStates] = useState<Map<number, unknown[]>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const key = itemIds.join(",");

  useEffect(() => {
    if (itemIds.length === 0) return;
    let cancelled = false;

    async function fetchOne(id: number): Promise<void> {
      try {
        const vars = await api.getItemVariables(id);
        if (cancelled) return;
        setStates((prev) => {
          const next = new Map(prev);
          next.set(id, vars as unknown[]);
          return next;
        });
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }

    void Promise.all(itemIds.map(fetchOne));

    const unsub = window.control4.onItemChanged((changedId) => {
      if (itemIds.includes(changedId)) void fetchOne(changedId);
    });

    return () => {
      cancelled = true;
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { states, error };
}
