import { useEffect, useRef, useState } from "react";
import type { Light } from "@/lib/types";

interface Props {
  light: Light;
  onChange: (level: number) => Promise<void>;
}

const SLIDER_COMMIT_MS = 150;

export function LightCard({ light, onChange }: Props) {
  const [level, setLevel] = useState(light.level ?? (light.state ? 100 : 0));
  const [busy, setBusy] = useState(false);
  const pending = useRef<number | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    setLevel(light.level ?? (light.state ? 100 : 0));
  }, [light.level, light.state]);

  const isOn = level > 0;

  async function commit(target: number): Promise<void> {
    setBusy(true);
    try {
      await onChange(target);
    } finally {
      setBusy(false);
    }
  }

  function scheduleCommit(target: number): void {
    pending.current = target;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (pending.current !== null) void commit(pending.current);
    }, SLIDER_COMMIT_MS);
  }

  const pct = Math.max(0, Math.min(100, level));

  return (
    <div
      className={[
        "group relative flex flex-col gap-3 rounded-xl border p-4 transition-all",
        isOn
          ? "border-accent-500/40 bg-gradient-to-br from-accent-500/10 to-accent-900/10 shadow-[0_0_40px_-12px] shadow-accent-500/40"
          : "border-neutral-800 bg-neutral-900/40 hover:border-neutral-700",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-neutral-100">
            {light.name}
          </div>
          <div className="mt-0.5 truncate text-xs text-neutral-500">
            {light.dimmable ? "Dimmer" : "Switch"}
          </div>
        </div>
        <button
          onClick={() => {
            const target = isOn ? 0 : 100;
            setLevel(target);
            void commit(target);
          }}
          disabled={busy}
          className={[
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition-all",
            isOn
              ? "border-accent-500/50 bg-accent-500/20 text-accent-200 hover:bg-accent-500/30"
              : "border-neutral-700 bg-neutral-800/60 text-neutral-500 hover:border-neutral-600 hover:text-neutral-300",
            busy && "opacity-50",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-label={isOn ? "Turn off" : "Turn on"}
        >
          <PowerIcon />
        </button>
      </div>

      {light.dimmable ? (
        <div className="flex items-center gap-3">
          <input
            type="range"
            className="brightness flex-1"
            min={0}
            max={100}
            value={pct}
            style={{ ["--pct" as string]: `${pct}%` }}
            onChange={(e) => {
              const next = Number(e.target.value);
              setLevel(next);
              scheduleCommit(next);
            }}
            disabled={busy}
          />
          <div className="w-10 text-right font-mono text-xs tabular-nums text-neutral-400">
            {pct}%
          </div>
        </div>
      ) : (
        <div className="text-xs text-neutral-500">
          {isOn ? "On" : "Off"}
        </div>
      )}
    </div>
  );
}

function PowerIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2v10" />
      <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
    </svg>
  );
}
