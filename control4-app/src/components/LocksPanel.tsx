import { useState } from "react";
import { api } from "@/lib/api";
import { useItemStates } from "@/hooks/useItemStates";
import type { LockDevice } from "@/lib/types";

interface Props {
  devices: LockDevice[];
}

export function LocksPanel({ devices }: Props) {
  const { states: rawStates } = useItemStates(devices.map((d) => d.id));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localOverrides, setLocalOverrides] = useState<
    Map<number, { locked: boolean | null }>
  >(new Map());

  const states = new Map(
    Array.from(rawStates.entries()).map(([id, vars]) => {
      const vars_arr = vars as Array<{ varName: string; value: unknown }>;
      const stateVar =
        vars_arr.find((v) => v.varName === "LOCKSTATE") ||
        vars_arr.find((v) => v.varName === "LOCKED_STATE");
      const locked =
        stateVar && typeof stateVar.value === "number"
          ? stateVar.value === 1
          : null;
      return [
        id,
        localOverrides.get(id) || { locked },
      ];
    }),
  );

  async function handleLock(itemId: number, locked: boolean): Promise<void> {
    const key = locked ? "locking" : "unlocking";
    setBusy(`${key}-${itemId}`);
    const prev = states.get(itemId);
    setLocalOverrides((m) => new Map(m).set(itemId, { locked }));
    try {
      await api.setLock(itemId, locked);
      setError(null);
      setLocalOverrides((m) => {
        const n = new Map(m);
        n.delete(itemId);
        return n;
      });
    } catch (e) {
      setLocalOverrides((m) => new Map(m).set(itemId, prev || { locked: null }));
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (devices.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-neutral-500">
        <div className="text-sm">No locks in this room.</div>
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-md border border-red-900/50 bg-red-950/40 px-4 py-2 text-xs text-red-300">
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {devices.map((lock) => {
          const state = states.get(lock.id);
          const locked = state?.locked ?? null;
          return (
            <div
              key={lock.id}
              className={[
                "rounded-xl border p-5 transition-all",
                locked
                  ? "border-accent-500/40 bg-gradient-to-br from-accent-500/10 to-accent-900/10"
                  : "border-neutral-800 bg-neutral-900/40",
              ].join(" ")}
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-medium">{lock.name}</h3>
                <div className="text-lg font-semibold">
                  {locked === null ? (
                    <span className="text-neutral-500">—</span>
                  ) : locked ? (
                    <span className="text-accent-400">🔒 Locked</span>
                  ) : (
                    <span className="text-neutral-400">🔓 Unlocked</span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => void handleLock(lock.id, true)}
                  disabled={busy === `locking-${lock.id}`}
                  className="flex-1 rounded-md border border-neutral-700 bg-neutral-800/60 px-3 py-2 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-600 disabled:opacity-40"
                >
                  Lock
                </button>
                <button
                  onClick={() => void handleLock(lock.id, false)}
                  disabled={busy === `unlocking-${lock.id}`}
                  className="flex-1 rounded-md border border-neutral-700 bg-neutral-800/60 px-3 py-2 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-600 disabled:opacity-40"
                >
                  Unlock
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
