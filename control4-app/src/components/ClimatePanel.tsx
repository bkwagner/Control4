import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ClimateDevice } from "@/lib/types";

interface Props {
  devices: ClimateDevice[];
}

const POLL_MS = 10000;
const MODES = ["Off", "Heat", "Cool", "Auto"] as const;

interface ClimateReading {
  temperature_f: number | null;
  heat_setpoint_f: number | null;
  cool_setpoint_f: number | null;
  hvac_mode: string | null;
  hvac_state: string | null;
}

function toNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseReading(
  vars: Array<{ varName: string; value: unknown }>,
): ClimateReading {
  const out: ClimateReading = {
    temperature_f: null,
    heat_setpoint_f: null,
    cool_setpoint_f: null,
    hvac_mode: null,
    hvac_state: null,
  };
  for (const v of vars) {
    const name = v.varName;
    if (name === "TEMPERATURE_F" || name === "CURRENT_TEMPERATURE_F") {
      out.temperature_f = toNum(v.value);
    } else if (name === "HEAT_SETPOINT_F") {
      out.heat_setpoint_f = toNum(v.value);
    } else if (name === "COOL_SETPOINT_F") {
      out.cool_setpoint_f = toNum(v.value);
    } else if (name === "HVAC_MODE") {
      out.hvac_mode = String(v.value ?? "") || null;
    } else if (name === "HVAC_STATE" || name === "HVAC_CURRENT_STATE") {
      out.hvac_state = String(v.value ?? "") || null;
    }
  }
  return out;
}

export function ClimatePanel({ devices }: Props) {
  if (devices.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-neutral-500">
        <div className="text-sm">No climate devices in this room.</div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {devices.map((d) => (
        <ClimateCard key={d.id} device={d} />
      ))}
    </div>
  );
}

function ClimateCard({ device }: { device: ClimateDevice }) {
  const [reading, setReading] = useState<ClimateReading | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    async function refresh(): Promise<void> {
      try {
        const vars = await api.getItemVariables(device.id);
        if (cancelled) return;
        setReading(parseReading(vars));
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
  }, [device.id]);

  async function nudge(
    key: "heat" | "cool",
    current: number | null,
    delta: number,
  ): Promise<void> {
    if (current == null) return;
    const next = Math.round(current + delta);
    const prev = reading;
    setReading((r) =>
      r
        ? {
            ...r,
            heat_setpoint_f: key === "heat" ? next : r.heat_setpoint_f,
            cool_setpoint_f: key === "cool" ? next : r.cool_setpoint_f,
          }
        : r,
    );
    setBusy(`${key}-${delta > 0 ? "up" : "down"}`);
    try {
      await api.setClimate(
        device.id,
        key === "heat" ? { heat_setpoint_f: next } : { cool_setpoint_f: next },
      );
    } catch (e) {
      setReading(prev);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function setMode(mode: string): Promise<void> {
    setBusy(`mode-${mode}`);
    try {
      await api.setClimate(device.id, { hvac_mode: mode });
      setReading((r) => (r ? { ...r, hvac_mode: mode } : r));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const heating = reading?.hvac_state?.toLowerCase().includes("heat");
  const cooling = reading?.hvac_state?.toLowerCase().includes("cool");

  return (
    <div
      className={[
        "rounded-xl border p-5 transition-all",
        heating
          ? "border-accent-500/40 bg-gradient-to-br from-accent-500/10 to-accent-900/10"
          : cooling
          ? "border-sky-500/40 bg-gradient-to-br from-sky-500/10 to-sky-900/10"
          : "border-neutral-800 bg-neutral-900/40",
      ].join(" ")}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
            {reading?.hvac_state || reading?.hvac_mode || "Thermostat"}
          </div>
          <div className="mt-1 text-lg font-medium">{device.name}</div>
        </div>
        <div className="text-right">
          <div className="text-3xl font-semibold tabular-nums">
            {reading?.temperature_f != null
              ? `${Math.round(reading.temperature_f)}°`
              : "—"}
          </div>
          <div className="mt-0.5 text-[10px] uppercase tracking-wider text-neutral-500">
            Current
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-md border border-red-900/50 bg-red-950/40 px-3 py-1.5 text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-3">
        <SetpointControl
          label="Heat"
          icon={<FlameIcon />}
          color="accent"
          value={reading?.heat_setpoint_f ?? null}
          busyUp={busy === "heat-up"}
          busyDown={busy === "heat-down"}
          onUp={() => void nudge("heat", reading?.heat_setpoint_f ?? null, +1)}
          onDown={() =>
            void nudge("heat", reading?.heat_setpoint_f ?? null, -1)
          }
        />
        <SetpointControl
          label="Cool"
          icon={<SnowflakeIcon />}
          color="sky"
          value={reading?.cool_setpoint_f ?? null}
          busyUp={busy === "cool-up"}
          busyDown={busy === "cool-down"}
          onUp={() => void nudge("cool", reading?.cool_setpoint_f ?? null, +1)}
          onDown={() =>
            void nudge("cool", reading?.cool_setpoint_f ?? null, -1)
          }
        />
      </div>

      <div className="mt-5">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-neutral-500">
          Mode
        </div>
        <div className="flex gap-1.5">
          {MODES.map((mode) => {
            const active =
              (reading?.hvac_mode || "").toLowerCase() === mode.toLowerCase();
            return (
              <button
                key={mode}
                onClick={() => void setMode(mode)}
                disabled={busy === `mode-${mode}`}
                className={[
                  "flex-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? "border-accent-500/50 bg-accent-500/20 text-accent-200"
                    : "border-neutral-800 bg-neutral-900/60 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200",
                ].join(" ")}
              >
                {mode}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SetpointControl({
  label,
  icon,
  color,
  value,
  busyUp,
  busyDown,
  onUp,
  onDown,
}: {
  label: string;
  icon: React.ReactNode;
  color: "accent" | "sky";
  value: number | null;
  busyUp: boolean;
  busyDown: boolean;
  onUp: () => void;
  onDown: () => void;
}) {
  const accent =
    color === "accent" ? "text-accent-400" : "text-sky-400";
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-neutral-500">
        <span className={accent}>{icon}</span>
        {label}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={onDown}
          disabled={busyDown || value == null}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-neutral-800 bg-neutral-900 text-neutral-300 hover:border-neutral-700 disabled:opacity-40"
          aria-label={`${label} down`}
        >
          −
        </button>
        <div className="flex-1 text-center font-mono text-xl tabular-nums">
          {value != null ? `${Math.round(value)}°` : "—"}
        </div>
        <button
          onClick={onUp}
          disabled={busyUp || value == null}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-neutral-800 bg-neutral-900 text-neutral-300 hover:border-neutral-700 disabled:opacity-40"
          aria-label={`${label} up`}
        >
          +
        </button>
      </div>
    </div>
  );
}

function FlameIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 17c1.5 0 2.5-1 2.5-2.5 0-1-.5-2-1.5-2.5 0 0 1-2 1-3.5a4 4 0 1 0-8 0c0 3 2 5 3.5 6Z" />
    </svg>
  );
}

function SnowflakeIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" y1="2" x2="12" y2="22" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
      <line x1="19.07" y1="4.93" x2="4.93" y2="19.07" />
    </svg>
  );
}
