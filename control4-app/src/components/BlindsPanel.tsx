import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { BlindDevice } from "@/lib/types";

interface Props {
  devices: BlindDevice[];
}

const POLL_MS = 5000;

export function BlindsPanel({ devices }: Props) {
  const [levels, setLevels] = useState<Map<number, number | null>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef<Map<number, number>>(new Map());

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    async function refresh(): Promise<void> {
      try {
        const updated = new Map(levels);
        for (const device of devices) {
          const vars = await api.getItemVariables(device.id);
          if (cancelled) return;
          const levelVar = vars.find((v) => v.varName === "CURRENT_LEVEL");
          const level =
            levelVar && typeof levelVar.value === "number"
              ? levelVar.value
              : null;
          updated.set(device.id, level);
        }
        setLevels(updated);
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

  async function handleSetLevel(
    itemId: number,
    level: number,
  ): Promise<void> {
    const clamped = Math.max(0, Math.min(100, Math.round(level)));
    pendingRef.current.set(itemId, Date.now());
    setLevels((prev) => new Map(prev).set(itemId, clamped));
    try {
      await api.setBlindLevel(itemId, clamped);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleOpen(itemId: number): Promise<void> {
    setBusy(`open-${itemId}`);
    try {
      await api.openBlind(itemId);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleClose(itemId: number): Promise<void> {
    setBusy(`close-${itemId}`);
    try {
      await api.closeBlind(itemId);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleStop(itemId: number): Promise<void> {
    setBusy(`stop-${itemId}`);
    try {
      await api.stopBlind(itemId);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (devices.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-neutral-500">
        <div className="text-sm">No blinds in this room.</div>
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {devices.map((blind) => {
          const level = levels.get(blind.id) ?? 0;
          const isOpen = level > 50;
          return (
            <div
              key={blind.id}
              className={[
                "rounded-xl border p-4 transition-all",
                isOpen
                  ? "border-accent-500/40 bg-gradient-to-br from-accent-500/10 to-accent-900/10"
                  : "border-neutral-800 bg-neutral-900/40",
              ].join(" ")}
            >
              <div className="mb-3 flex items-baseline justify-between">
                <h3 className="text-sm font-medium">{blind.name}</h3>
                <span className="ml-2 text-xs text-neutral-500">
                  {level}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={level}
                onChange={(e) =>
                  void handleSetLevel(blind.id, Number(e.currentTarget.value))
                }
                className="mb-3 w-full"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => void handleOpen(blind.id)}
                  disabled={busy === `open-${blind.id}`}
                  className="flex-1 rounded-md border border-neutral-700 bg-neutral-800/60 px-2 py-1 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-600 disabled:opacity-40"
                >
                  Open
                </button>
                <button
                  onClick={() => void handleStop(blind.id)}
                  disabled={busy === `stop-${blind.id}`}
                  className="flex-1 rounded-md border border-neutral-700 bg-neutral-800/60 px-2 py-1 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-600 disabled:opacity-40"
                >
                  Stop
                </button>
                <button
                  onClick={() => void handleClose(blind.id)}
                  disabled={busy === `close-${blind.id}`}
                  className="flex-1 rounded-md border border-neutral-700 bg-neutral-800/60 px-2 py-1 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-600 disabled:opacity-40"
                >
                  Close
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
