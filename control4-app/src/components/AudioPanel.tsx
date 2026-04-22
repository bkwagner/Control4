import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { MediaBrowseGroup, MediaSource, RoomAvState } from "@/lib/types";

interface Props {
  roomId: number;
  roomName: string;
  roomHasMatrixAudio: boolean;
  sources: MediaSource[];
}

const POLL_MS = 3000;
const VOLUME_COMMIT_MS = 150;
const VOLUME_STEP = 3;

function sourceVisibleInRoom(
  source: MediaSource,
  roomId: number,
  canRouteMatrixAudio: boolean,
): boolean {
  if (source.roomIds.includes(roomId)) return true;
  // Matrix-audio sources reach every room wired to the shared amp / media
  // hub. We also accept the IP-volume fallback (TVs with absolute volume
  // that happen to accept matrix audio — e.g. Family Room's BRAVIA).
  if (source.matrixAudio && canRouteMatrixAudio) return true;
  return false;
}

interface BrowseSession {
  source: MediaSource;
  isVideo: boolean;
  groups: MediaBrowseGroup[] | null;
  loading: boolean;
}

export function AudioPanel({
  roomId,
  roomName,
  roomHasMatrixAudio,
  sources,
}: Props) {
  const [state, setState] = useState<RoomAvState | null>(null);
  const [volume, setVolume] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [browse, setBrowse] = useState<BrowseSession | null>(null);
  const volTimer = useRef<number | null>(null);
  const volPending = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    async function refresh(): Promise<void> {
      try {
        const s = await api.getRoomAvState(roomId);
        if (cancelled) return;
        setState(s);
        setVolume(s.volume >= 0 ? s.volume : 0);
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
  }, [roomId]);

  // Two signals for "can play distributed-audio services":
  //   - room has a non-TV audio endpoint (amp / matrix zone), OR
  //   - room currently reports an absolute CURRENT_VOLUME (IP-controlled TV
  //     that happens to accept audio-matrix routing, e.g. Family Room).
  // Rooms like Office are TV-only + pulse volume → skip universal audio.
  const canRouteMatrixAudio =
    roomHasMatrixAudio || (state !== null && state.volume >= 0);
  const roomSources = useMemo(
    () =>
      sources.filter((s) =>
        sourceVisibleInRoom(s, roomId, canRouteMatrixAudio),
      ),
    [sources, roomId, canRouteMatrixAudio],
  );
  const audioSources = useMemo(
    () => roomSources.filter((s) => s.kind === "audio" || s.kind === "both"),
    [roomSources],
  );
  const videoSources = useMemo(
    () => roomSources.filter((s) => s.kind === "video" || s.kind === "both"),
    [roomSources],
  );
  const activeSource = useMemo(() => {
    if (!state) return null;
    const id = state.video_source_id ?? state.audio_source_id;
    if (id == null) return null;
    return sources.find((s) => s.id === id) ?? null;
  }, [state, sources]);

  async function run(key: string, fn: () => Promise<unknown>): Promise<void> {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  // Tapping a source tile: probe the source's deep content first. If Control4
  // has sub-items for it in this room (SiriusXM channels, NAS playlists,
  // Pandora stations, etc.), open a picker. Otherwise just select the source
  // directly (streaming apps, TVs — these launch instead of browse).
  async function handleSourcePick(
    source: MediaSource,
    isVideo: boolean,
  ): Promise<void> {
    setBrowse({ source, isVideo, groups: null, loading: true });
    setError(null);
    try {
      const groups = await api.browseSourceMedia(
        roomId,
        source.id,
        isVideo,
        source.aggregator,
      );
      if (groups.length === 0) {
        setBrowse(null);
        // Aggregator tiles aren't selectable as devices — bail silently.
        if (source.aggregator) return;
        await run(`src-${source.id}`, () =>
          isVideo
            ? api.setRoomVideoSource(roomId, source.id)
            : api.setRoomAudioSource(roomId, source.id),
        );
        return;
      }
      setBrowse({ source, isVideo, groups, loading: false });
    } catch (e) {
      setBrowse(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleBrowsePick(
    kind: string,
    isVideo: boolean,
    mediaId: number,
  ): Promise<void> {
    if (!browse) return;
    setBrowse(null);
    await run(`media-${mediaId}`, () =>
      api.selectRoomMedia(roomId, kind, isVideo, mediaId),
    );
  }

  async function handleBrowseSelectSource(): Promise<void> {
    if (!browse) return;
    const { source, isVideo } = browse;
    setBrowse(null);
    await run(`src-${source.id}`, () =>
      isVideo
        ? api.setRoomVideoSource(roomId, source.id)
        : api.setRoomAudioSource(roomId, source.id),
    );
  }

  function scheduleVolumeCommit(target: number): void {
    volPending.current = target;
    if (volTimer.current !== null) window.clearTimeout(volTimer.current);
    volTimer.current = window.setTimeout(() => {
      if (volPending.current !== null) {
        void run("volume", () => api.setRoomVolume(roomId, volPending.current!));
      }
    }, VOLUME_COMMIT_MS);
  }

  function nudgeVolume(delta: number): void {
    const next = Math.max(0, Math.min(100, volume + delta));
    if (next === volume) return;
    setVolume(next);
    scheduleVolumeCommit(next);
  }

  // Some rooms (typically TV-speaker only) don't expose an absolute
  // CURRENT_VOLUME — Control4 reports -1. We can still send relative
  // VOLUME_UP/DOWN pulses, which the room routes to the TV's IR.
  const hasSlider = state ? state.volume >= 0 : true;
  const hasAudio = state !== null;
  const mode = state?.mode ?? "off";
  const muted = state?.muted ?? false;

  const headerLabel =
    mode === "video"
      ? "Watching"
      : mode === "audio"
        ? "Listening to"
        : "Off";

  return (
    <div className="flex flex-col gap-5">
      {error && (
        <div className="rounded-md border border-red-900/50 bg-red-950/40 px-4 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Now-playing / room state card */}
      <div
        className={[
          "rounded-xl border p-5 transition-all",
          mode !== "off"
            ? "border-accent-500/40 bg-gradient-to-br from-accent-500/10 to-accent-900/10"
            : "border-neutral-800 bg-neutral-900/40",
        ].join(" ")}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            {state?.now_playing?.img_url && (
              <img
                src={state.now_playing.img_url}
                alt=""
                className="h-16 w-16 shrink-0 rounded-md border border-neutral-800 object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            )}
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
                {headerLabel}
                {activeSource && mode !== "off" ? ` · ${activeSource.name}` : ""}
              </div>
              <div className="mt-1 truncate text-lg font-medium">
                {state?.now_playing?.title ??
                  state?.now_playing?.channel ??
                  activeSource?.name ??
                  (mode === "off" ? "Nothing playing" : "—")}
              </div>
              {(state?.now_playing?.artist ?? state?.now_playing?.album) && (
                <div className="mt-0.5 truncate text-sm text-neutral-400">
                  {[state.now_playing?.artist, state.now_playing?.album]
                    .filter(Boolean)
                    .join(" — ")}
                </div>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => void run("mute", () => api.toggleRoomMute(roomId))}
              disabled={!hasAudio || busy === "mute"}
              className={[
                "rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
                muted
                  ? "border-accent-500/50 bg-accent-500/20 text-accent-200"
                  : "border-neutral-700 bg-neutral-800/60 text-neutral-300 hover:border-neutral-600",
                !hasAudio && "opacity-40",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {muted ? "Unmute" : "Mute"}
            </button>
            <button
              onClick={() => void run("roomoff", () => api.roomOff(roomId))}
              disabled={mode === "off" || busy === "roomoff"}
              className="rounded-lg border border-neutral-700 bg-neutral-800/60 px-3 py-2 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-600 disabled:opacity-40"
            >
              Turn off
            </button>
          </div>
        </div>

        {hasSlider ? (
          <div className="mt-5 flex items-center gap-3">
            <button
              aria-label="Volume down"
              onClick={() => nudgeVolume(-VOLUME_STEP)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-neutral-700 bg-neutral-800/60 text-neutral-300 transition-colors hover:border-accent-500/40 hover:text-accent-200"
            >
              <MinusIcon />
            </button>
            <input
              type="range"
              className="brightness flex-1"
              min={0}
              max={100}
              value={volume}
              style={{ ["--pct" as string]: `${volume}%` }}
              onChange={(e) => {
                const next = Number(e.target.value);
                setVolume(next);
                scheduleVolumeCommit(next);
              }}
            />
            <button
              aria-label="Volume up"
              onClick={() => nudgeVolume(VOLUME_STEP)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-neutral-700 bg-neutral-800/60 text-neutral-300 transition-colors hover:border-accent-500/40 hover:text-accent-200"
            >
              <PlusIcon />
            </button>
            <div className="w-12 text-right font-mono text-sm tabular-nums text-neutral-300">
              {volume}
            </div>
          </div>
        ) : hasAudio ? (
          <div className="mt-5 flex items-center gap-3">
            <button
              aria-label="Volume down"
              onClick={() =>
                void run("voldn", () => api.roomCommand(roomId, "PULSE_VOL_DOWN"))
              }
              className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800/60 px-4 text-neutral-300 transition-colors hover:border-accent-500/40 hover:text-accent-200"
            >
              <MinusIcon />
              <span className="text-xs font-medium">Vol</span>
            </button>
            <button
              aria-label="Volume up"
              onClick={() =>
                void run("volup", () => api.roomCommand(roomId, "PULSE_VOL_UP"))
              }
              className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800/60 px-4 text-neutral-300 transition-colors hover:border-accent-500/40 hover:text-accent-200"
            >
              <PlusIcon />
              <span className="text-xs font-medium">Vol</span>
            </button>
            <div className="text-xs text-neutral-500">TV volume</div>
          </div>
        ) : null}
      </div>

      {/* Transport + video navigation */}
      {mode !== "off" && (
        <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <TransportButton
                label="Rewind"
                busy={busy === "rew"}
                onClick={() =>
                  void run("rew", () => api.roomCommand(roomId, "REWIND"))
                }
              >
                <RewindIcon />
              </TransportButton>
              <TransportButton
                label="Play"
                busy={busy === "play"}
                onClick={() => void run("play", () => api.mediaPlay(roomId))}
              >
                <PlayIcon />
              </TransportButton>
              <TransportButton
                label="Pause"
                busy={busy === "pause"}
                onClick={() => void run("pause", () => api.mediaPause(roomId))}
              >
                <PauseIcon />
              </TransportButton>
              <TransportButton
                label="Stop"
                busy={busy === "stop"}
                onClick={() => void run("stop", () => api.mediaStop(roomId))}
              >
                <StopIcon />
              </TransportButton>
              <TransportButton
                label="Fast forward"
                busy={busy === "ff"}
                onClick={() =>
                  void run("ff", () => api.roomCommand(roomId, "FAST_FORWARD"))
                }
              >
                <FastForwardIcon />
              </TransportButton>
              {mode === "video" && (
                <>
                  <div className="mx-1 h-6 w-px bg-neutral-800" />
                  <SecondaryButton
                    onClick={() =>
                      void run("chdn", () =>
                        api.roomCommand(roomId, "CHANNEL_DOWN"),
                      )
                    }
                  >
                    CH −
                  </SecondaryButton>
                  <SecondaryButton
                    onClick={() =>
                      void run("chup", () =>
                        api.roomCommand(roomId, "CHANNEL_UP"),
                      )
                    }
                  >
                    CH +
                  </SecondaryButton>
                </>
              )}
            </div>

            {mode === "video" && (
              <div className="flex flex-wrap gap-2">
                <SecondaryButton
                  onClick={() =>
                    void run("menu", () => api.roomCommand(roomId, "MENU"))
                  }
                >
                  Menu
                </SecondaryButton>
                <SecondaryButton
                  onClick={() =>
                    void run("guide", () => api.roomCommand(roomId, "GUIDE"))
                  }
                >
                  Guide
                </SecondaryButton>
                <SecondaryButton
                  onClick={() =>
                    void run("info", () => api.roomCommand(roomId, "INFO"))
                  }
                >
                  Info
                </SecondaryButton>
                <SecondaryButton
                  onClick={() =>
                    void run("back", () => api.roomCommand(roomId, "CANCEL"))
                  }
                >
                  Back
                </SecondaryButton>
                <SecondaryButton
                  onClick={() =>
                    void run("exit", () => api.roomCommand(roomId, "EXIT"))
                  }
                >
                  Exit
                </SecondaryButton>
              </div>
            )}
          </div>

          {mode === "video" && (
            <Dpad
              onUp={() => void run("up", () => api.roomCommand(roomId, "UP"))}
              onDown={() =>
                void run("down", () => api.roomCommand(roomId, "DOWN"))
              }
              onLeft={() =>
                void run("left", () => api.roomCommand(roomId, "LEFT"))
              }
              onRight={() =>
                void run("right", () => api.roomCommand(roomId, "RIGHT"))
              }
              onSelect={() =>
                void run("ok", () => api.roomCommand(roomId, "SELECT"))
              }
            />
          )}
        </div>
      )}

      {/* Source picker */}
      <SourceSection
        title="Video"
        sources={videoSources}
        activeId={state?.video_source_id ?? null}
        onPick={(s) => void handleSourcePick(s, true)}
        busyKey={busy}
        loadingSourceId={
          browse && browse.isVideo ? browse.source.id : null
        }
        icon={<MonitorIcon className="h-4 w-4" />}
        hideRoomLabelFor={roomName}
      />
      <SourceSection
        title="Audio"
        sources={audioSources}
        activeId={state?.audio_source_id ?? null}
        onPick={(s) => void handleSourcePick(s, false)}
        busyKey={busy}
        loadingSourceId={
          browse && !browse.isVideo ? browse.source.id : null
        }
        icon={<MusicIcon className="h-4 w-4" />}
        hideRoomLabelFor={roomName}
      />
      {sources.length === 0 && (
        <div className="rounded-md border border-neutral-800 bg-neutral-900/40 px-4 py-6 text-center text-sm text-neutral-500">
          No media sources discovered.
        </div>
      )}

      {browse && browse.groups && (
        <BrowseSheet
          title={browse.source.name}
          groups={browse.groups}
          onPick={(kind, isVideo, id) =>
            void handleBrowsePick(kind, isVideo, id)
          }
          onJustSelect={
            browse.source.aggregator
              ? null
              : () => void handleBrowseSelectSource()
          }
          onClose={() => setBrowse(null)}
        />
      )}
    </div>
  );
}

function SourceSection({
  title,
  sources,
  activeId,
  onPick,
  busyKey,
  loadingSourceId,
  icon,
  hideRoomLabelFor,
}: {
  title: string;
  sources: MediaSource[];
  activeId: number | null;
  onPick: (source: MediaSource) => void;
  busyKey: string | null;
  loadingSourceId: number | null;
  icon: React.ReactNode;
  hideRoomLabelFor: string;
}) {
  if (sources.length === 0) return null;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
        {icon}
        <span>{title}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {sources.map((s) => {
          const active = s.id === activeId;
          const key = `src-${s.id}`;
          const loading = loadingSourceId === s.id;
          return (
            <button
              key={s.id}
              onClick={() => onPick(s)}
              disabled={busyKey === key || loading}
              className={[
                "group flex flex-col items-start gap-1 rounded-xl border p-4 text-left transition-all disabled:opacity-60",
                active
                  ? "border-accent-500/60 bg-accent-500/10"
                  : "border-neutral-800 bg-neutral-900/40 hover:border-accent-500/40 hover:bg-accent-500/5",
              ].join(" ")}
            >
              <div className="flex w-full items-center gap-2">
                <div className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-100">
                  {s.name}
                </div>
                {loading && <Spinner />}
              </div>
              {s.roomName &&
                s.roomName !== hideRoomLabelFor &&
                s.roomName !== "Channels" && (
                  <div className="truncate text-xs text-neutral-500">
                    in {s.roomName}
                  </div>
                )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BrowseSheet({
  title,
  groups,
  onPick,
  onJustSelect,
  onClose,
}: {
  title: string;
  groups: MediaBrowseGroup[];
  onPick: (kind: string, isVideo: boolean, id: number) => void;
  onJustSelect: (() => void) | null;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
              Browse
            </div>
            <div className="mt-0.5 text-lg font-medium">{title}</div>
          </div>
          <div className="flex items-center gap-2">
            {onJustSelect && (
              <button
                onClick={onJustSelect}
                className="rounded-lg border border-neutral-700 bg-neutral-800/60 px-3 py-2 text-xs font-medium text-neutral-300 hover:border-accent-500/40 hover:text-accent-200"
              >
                Just turn on
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="Close"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900/60 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"
            >
              <CloseIcon />
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-5 overflow-y-auto px-5 py-5">
          {groups.map((g) => (
            <div key={g.kind}>
              <div className="mb-2 px-1 text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
                {g.label}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {g.items.map((it) => (
                  <button
                    key={`${g.kind}-${it.id}`}
                    onClick={() => onPick(g.kind, g.isVideo, it.id)}
                    className="rounded-lg border border-neutral-800 bg-neutral-900/40 px-3 py-3 text-left text-sm text-neutral-200 transition-colors hover:border-accent-500/40 hover:bg-accent-500/5"
                  >
                    <div className="truncate">{it.label}</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 shrink-0 animate-spin text-neutral-400"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="3"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function Dpad({
  onUp,
  onDown,
  onLeft,
  onRight,
  onSelect,
}: {
  onUp: () => void;
  onDown: () => void;
  onLeft: () => void;
  onRight: () => void;
  onSelect: () => void;
}) {
  const baseBtn =
    "flex items-center justify-center bg-neutral-900/70 text-neutral-300 transition-colors hover:bg-accent-500/15 hover:text-accent-200";
  return (
    <div className="grid w-[176px] grid-cols-3 grid-rows-3 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950/40">
      <div />
      <button aria-label="Up" onClick={onUp} className={baseBtn}>
        <ChevronUpIcon />
      </button>
      <div />
      <button aria-label="Left" onClick={onLeft} className={baseBtn}>
        <ChevronLeftIcon />
      </button>
      <button
        aria-label="OK"
        onClick={onSelect}
        className="flex cursor-pointer items-center justify-center border border-accent-500/50 bg-accent-500/20 text-accent-100 transition-colors hover:border-accent-400 hover:bg-accent-500/30 active:bg-accent-500/40"
      >
        <span className="text-xs font-semibold tracking-wide">OK</span>
      </button>
      <button aria-label="Right" onClick={onRight} className={baseBtn}>
        <ChevronRightIcon />
      </button>
      <div />
      <button aria-label="Down" onClick={onDown} className={baseBtn}>
        <ChevronDownIcon />
      </button>
      <div />
    </div>
  );
}

function TransportButton({
  label,
  busy,
  onClick,
  children,
}: {
  label: string;
  busy: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      aria-label={label}
      title={label}
      className="flex h-11 w-11 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900/60 text-neutral-300 transition-colors hover:border-accent-500/40 hover:text-accent-200 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-xs font-medium text-neutral-300 transition-colors hover:border-accent-500/40 hover:text-accent-200"
    >
      {children}
    </button>
  );
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
    </svg>
  );
}
function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 6h12v12H6z" />
    </svg>
  );
}
function RewindIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M11 18V6l-8.5 6 8.5 6zm.5-6L20 6v12l-8.5-6z" />
    </svg>
  );
}
function FastForwardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M4 18l8.5-6L4 6v12zm9.5-6L22 6v12l-8.5-6z" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function MinusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M5 12h14" />
    </svg>
  );
}
function ChevronUpIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}
function ChevronDownIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
function ChevronLeftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}
function ChevronRightIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
function MusicIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}
function MonitorIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}
