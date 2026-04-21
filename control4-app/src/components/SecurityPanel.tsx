import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { SecurityDevice } from "@/lib/types";

interface Props {
  devices: SecurityDevice[];
}

interface SecurityState {
  partitionState: string | null;
  alarmState: string | null;
}

const POLL_MS = 3000;

export function SecurityPanel({ devices }: Props) {
  const [states, setStates] = useState<Map<number, SecurityState>>(
    new Map(),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disarmCode, setDisarmCode] = useState<Map<number, string>>(
    new Map(),
  );
  const [expandDisarm, setExpandDisarm] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    async function refresh(): Promise<void> {
      try {
        const updated = new Map(states);
        for (const device of devices) {
          const vars = await api.getItemVariables(device.id);
          if (cancelled) return;
          const partVar = vars.find((v) => v.varName === "PARTITION_STATE");
          const alarmVar = vars.find((v) => v.varName === "ALARM_STATE");
          updated.set(device.id, {
            partitionState:
              partVar && typeof partVar.value === "string"
                ? (partVar.value as string)
                : null,
            alarmState:
              alarmVar && typeof alarmVar.value === "string"
                ? (alarmVar.value as string)
                : null,
          });
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

  async function handleArm(
    itemId: number,
    mode: "away" | "stay" | "night",
  ): Promise<void> {
    setBusy(`arm-${mode}-${itemId}`);
    try {
      await api.armSecurity(itemId, mode);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleDisarm(itemId: number): Promise<void> {
    const code = disarmCode.get(itemId) || "";
    setBusy(`disarm-${itemId}`);
    try {
      await api.disarmSecurity(itemId, code);
      setError(null);
      setDisarmCode((m) => {
        const n = new Map(m);
        n.delete(itemId);
        return n;
      });
      setExpandDisarm(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (devices.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-neutral-500">
        <div className="text-sm">No security panels in this room.</div>
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
        {devices.map((panel) => {
          const state = states.get(panel.id);
          const partState = state?.partitionState || "UNKNOWN";
          const alarmActive = state?.alarmState === "ALARM";
          const isDisarmed = partState === "DISARMED";

          return (
            <div
              key={panel.id}
              className={[
                "rounded-xl border p-5 transition-all",
                alarmActive
                  ? "border-red-500/40 bg-red-950/10"
                  : !isDisarmed
                    ? "border-accent-500/40 bg-gradient-to-br from-accent-500/10 to-accent-900/10"
                    : "border-neutral-800 bg-neutral-900/40",
              ].join(" ")}
            >
              <div className="mb-4 flex items-baseline justify-between">
                <h3 className="text-sm font-medium">{panel.name}</h3>
                <div className="text-lg font-semibold">
                  {alarmActive ? (
                    <span className="text-red-400">🚨 ALARM</span>
                  ) : (
                    <span
                      className={
                        isDisarmed
                          ? "text-neutral-400"
                          : "text-accent-400"
                      }
                    >
                      {partState}
                    </span>
                  )}
                </div>
              </div>

              <div className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-neutral-600">
                Arm Mode
              </div>
              <div className="mb-4 flex gap-1.5">
                {(
                  [
                    { label: "Away", mode: "away" as const },
                    { label: "Stay", mode: "stay" as const },
                    { label: "Night", mode: "night" as const },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.mode}
                    onClick={() => void handleArm(panel.id, opt.mode)}
                    disabled={busy === `arm-${opt.mode}-${panel.id}`}
                    className={[
                      "flex-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors",
                      partState === `ARMED_${opt.mode.toUpperCase()}`
                        ? "border-accent-500/50 bg-accent-500/20 text-accent-200"
                        : "border-neutral-800 bg-neutral-900/60 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200 disabled:opacity-40",
                    ].join(" ")}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {expandDisarm === panel.id ? (
                <div className="mb-3 flex gap-2">
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="PIN"
                    value={disarmCode.get(panel.id) || ""}
                    onChange={(e) => {
                      const val = e.currentTarget.value;
                      setDisarmCode((m) => {
                        const n = new Map(m);
                        n.set(panel.id, val);
                        return n;
                      });
                    }}
                    className="flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 placeholder-neutral-600"
                  />
                  <button
                    onClick={() => void handleDisarm(panel.id)}
                    disabled={busy === `disarm-${panel.id}`}
                    className="rounded-md border border-neutral-700 bg-neutral-800/60 px-2 py-1 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-600 disabled:opacity-40"
                  >
                    OK
                  </button>
                  <button
                    onClick={() => setExpandDisarm(null)}
                    className="rounded-md border border-neutral-700 bg-neutral-800/60 px-2 py-1 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-600"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setExpandDisarm(panel.id)}
                  className="w-full rounded-md border border-neutral-700 bg-neutral-800/60 px-3 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-600"
                >
                  Disarm
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
