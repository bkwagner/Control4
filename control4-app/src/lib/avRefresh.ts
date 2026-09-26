// Shared refresh schedule for the AV views: refetch when a room or AV device
// reports a change (debounced, since a source change emits a burst), plus a
// slow fallback poll in case the director doesn't emit an event for
// something (not every room variable change is guaranteed to).

const AV_EVENT_DEBOUNCE_MS = 300;
const AV_FALLBACK_POLL_MS = 15_000;

// Starts the schedule; returns a cleanup function for useEffect.
export function scheduleAvRefresh(refresh: () => void): () => void {
  const interval = window.setInterval(refresh, AV_FALLBACK_POLL_MS);
  let pending: number | undefined;
  const unsubscribe = window.control4.onAvChanged(() => {
    if (pending !== undefined) return;
    pending = window.setTimeout(() => {
      pending = undefined;
      refresh();
    }, AV_EVENT_DEBOUNCE_MS);
  });
  return () => {
    window.clearInterval(interval);
    if (pending !== undefined) window.clearTimeout(pending);
    unsubscribe();
  };
}
