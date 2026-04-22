import { useEffect, useState } from "react";
import type { UpdaterState } from "@/lib/control4";

// Shows the current app version and auto-update state. Always displays the version,
// and surfaces update notifications when available.
export function UpdateIndicator() {
  const [state, setState] = useState<UpdaterState>({ status: "idle" });
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.control4.getVersion().then((v) => {
      if (!cancelled) setVersion(v);
    });
    void window.control4.updater.getState().then((s) => {
      if (!cancelled) setState(s);
    });
    const off = window.control4.updater.onState((s) => setState(s));
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  if (state.status === "idle" || state.status === "not-available") {
    return version ? (
      <div className="text-xs text-neutral-500" title={`Control4 v${version}`}>
        v{version}
      </div>
    ) : null;
  }
  if (state.status === "checking") return null;

  if (state.status === "downloading") {
    return (
      <div className="flex flex-col gap-1">
        <div
          className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-400"
          title={`Downloading ${state.version}`}
        >
          Updating… {state.percent}%
        </div>
        {version && <div className="text-xs text-neutral-500">v{version}</div>}
      </div>
    );
  }

  if (state.status === "available") {
    return (
      <div className="flex flex-col gap-1">
        <div
          className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-400"
          title={`New version ${state.version} found`}
        >
          Update found
        </div>
        {version && <div className="text-xs text-neutral-500">v{version}</div>}
      </div>
    );
  }

  if (state.status === "downloaded") {
    return (
      <div className="flex flex-col gap-1">
        <button
          onClick={() => void window.control4.updater.installNow()}
          title={`Install ${state.version} and restart`}
          className="rounded-md border border-accent-500/60 bg-accent-500/10 px-3 py-1.5 text-xs font-medium text-accent-400 transition-colors hover:border-accent-400 hover:text-accent-300"
        >
          Restart to update
        </button>
        {version && <div className="text-xs text-neutral-500">v{version}</div>}
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex flex-col gap-1">
        <div
          className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-1.5 text-xs text-red-400"
          title={state.message}
        >
          Update failed
        </div>
        {version && <div className="text-xs text-neutral-500">v{version}</div>}
      </div>
    );
  }

  return null;
}
