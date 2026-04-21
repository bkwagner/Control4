import { useEffect, useState } from "react";
import type { AppSettings } from "@/lib/control4";

interface Props {
  initial: AppSettings | null;
  onSaved: () => void;
  onCancel?: () => void;
}

export function SetupScreen({ initial, onSaved, onCancel }: Props) {
  const [username, setUsername] = useState(initial?.username ?? "");
  const [password, setPassword] = useState(initial?.password ?? "");
  const [directorIp, setDirectorIp] = useState(initial?.directorIp ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial) {
      setUsername(initial.username);
      setPassword(initial.password);
      setDirectorIp(initial.directorIp);
    }
  }, [initial]);

  const canSubmit =
    username.trim() && password.trim() && directorIp.trim() && !saving;

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await window.control4.saveConfig({
        username: username.trim(),
        password,
        directorIp: directorIp.trim(),
        controllerCommonName: initial?.controllerCommonName ?? null,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative flex h-screen w-screen items-center justify-center bg-neutral-950 text-neutral-100">
      <div
        className="absolute left-0 right-0 top-0 h-8"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      />
      <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900/60 p-8 shadow-2xl">
        <div className="mb-6">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-400">
            Control4
          </div>
          <h1 className="mt-1 text-2xl font-semibold">Connect your system</h1>
          <p className="mt-2 text-sm text-neutral-400">
            Your Control4 account credentials authenticate with the cloud once,
            then the app talks directly to your local controller. Credentials
            stay on this machine.
          </p>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label="Director IP" hint="LAN address of your controller">
            <input
              type="text"
              inputMode="decimal"
              autoFocus
              value={directorIp}
              onChange={(e) => setDirectorIp(e.target.value)}
              placeholder="10.0.0.1"
              className="input"
            />
          </Field>

          <Field label="Control4 account email">
            <input
              type="email"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="you@example.com"
              className="input"
            />
          </Field>

          <Field label="Password">
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
            />
          </Field>

          {error && (
            <div className="rounded-md border border-red-900/50 bg-red-950/40 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          <div className="mt-2 flex items-center justify-end gap-2">
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="rounded-md border border-neutral-800 bg-neutral-900 px-4 py-2 text-sm text-neutral-300 hover:border-neutral-700"
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded-md bg-accent-500 px-4 py-2 text-sm font-medium text-neutral-950 transition-colors hover:bg-accent-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Connecting…" : "Connect"}
            </button>
          </div>
        </form>
      </div>

      <style>{`
        .input {
          width: 100%;
          background: rgb(10 10 10 / 0.8);
          border: 1px solid rgb(38 38 38);
          border-radius: 0.375rem;
          padding: 0.5rem 0.75rem;
          color: rgb(245 245 245);
          font-size: 0.875rem;
          outline: none;
          transition: border-color 120ms;
        }
        .input:focus { border-color: var(--color-accent-500); }
      `}</style>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-[0.15em] text-neutral-500">
        {label}
      </span>
      {children}
      {hint && <span className="text-xs text-neutral-600">{hint}</span>}
    </label>
  );
}
