import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { LockDevice } from "@/lib/types";

interface Props {
  devices: LockDevice[];
}

interface LockState {
  locked: boolean | null;
}

const POLL_MS = 5000;

export function LocksPanel({ devices }: Props) {
  const [states, setStates] = useState<Map<number, LockState>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    async function refresh(): Promise<void> {
      try {
        const updated = new Map(states);
        for (const device of devices) {
          const vars = await api.getItemVariables(device.id);
          if (cancelled) return;
          // Try both LOCKSTATE and LOCKED_STATE variable names
          const stateVar =
            vars.find((v) => v.varName === "LOCKSTATE") ||
            vars.find((v) => v.varName === "LOCKED_STATE");
          const locked =
            stateVar && typeof stateVar.value === "number"
              ? stateVar.value === 1
              : null;
          updated.set(device.id, { locked });
        }
        setStates(updated);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    }

    void refresh();
    timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [devices]);

  async function handleLock(itemId: number, locked: boolean): Promise<void> {
    const key = locked ? "locking" : "unlocking";
    setBusy(`${key}-${itemId}`);
    const prev = states.get(itemId);
    setStates((m) => new Map(m).set(itemId, { locked }));
    try {
      await api.setLock(itemId, locked);
      setError(null);
    } catch (e) {
      setStates((m) => new Map(m).set(itemId, prev || { locked: null }));
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
