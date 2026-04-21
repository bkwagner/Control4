import { useEffect, useState } from "react";
import type { UpdaterState } from "@/lib/control4";

// Shows the current auto-update state in the header. Invisible most of the
// time — only surfaces when there's something the user might act on (an
// update is downloading, ready to install, or a check failed).
export function UpdateIndicator() {
  const [state, setState] = useState<UpdaterState>({ status: "idle" });

  useEffect(() => {
    let cancelled = false;
    void window.control4.updater.getState().then((s) => {
      if (!cancelled) setState(s);
    });
    const off = window.control4.updater.onState((s) => setState(s));
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  if (state.status === "idle" || state.status === "not-available") return null;
  if (state.status === "checking") return null;

  if (state.status === "downloading") {
    return (
      <div
        className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-400"
        title={`Downloading ${state.version}`}
      >
        Updating… {state.percent}%
      </div>
    );
  }

  if (state.status === "available") {
    return (
      <div
        className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-400"
        title={`New version ${state.version} found`}
      >
        Update found
      </div>
    );
  }

  if (state.status === "downloaded") {
    return (
      <button
        onClick={() => void window.control4.updater.installNow()}
        title={`Install ${state.version} and restart`}
        className="rounded-md border border-accent-500/60 bg-accent-500/10 px-3 py-1.5 text-xs font-medium text-accent-400 transition-colors hover:border-accent-400 hover:text-accent-300"
      >
        Restart to update
      </button>
    );
  }

  if (state.status === "error") {
    return (
      <div
        className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-1.5 text-xs text-red-400"
        title={state.message}
      >
        Update failed
      </div>
    );
  }

  return null;
}
