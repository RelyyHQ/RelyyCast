import { useEffect, useState } from "react";
import {
  getPersistedRuntimeStateSnapshot,
  getRuntimeStateSnapshot,
  RUNTIME_STATE_EVENT_NAME,
  type RuntimeState,
} from "@/src/runtime/neutralino-runtime-orchestrator";
import { selectNewestRuntimeState } from "@/src/lib/runtime-state";
import { RUNTIME_STATE_POLL_MS } from "@/src/lib/station-config";

/**
 * Subscribes to runtime state change events and polls on a fixed interval.
 * Merges in-memory state with the persisted snapshot, always surfacing the
 * most recently timestamped version.
 *
 * Returns [state, setter] so callers can push an optimistic update immediately
 * after an action (e.g. Cloudflare login) without waiting for the next poll.
 */
export function useRuntimeState(): [RuntimeState | null, (state: RuntimeState) => void] {
  const [runtimeState, setRuntimeState] = useState<RuntimeState | null>(
    () => getRuntimeStateSnapshot(),
  );

  useEffect(() => {
    let disposed = false;

    const refresh = async () => {
      const current = getRuntimeStateSnapshot();
      const persisted = await getPersistedRuntimeStateSnapshot();
      if (!disposed) {
        setRuntimeState(selectNewestRuntimeState(current, persisted));
      }
    };

    void refresh();

    const onEvent = () => { void refresh(); };
    window.addEventListener(RUNTIME_STATE_EVENT_NAME, onEvent as EventListener);
    const timer = window.setInterval(() => { void refresh(); }, RUNTIME_STATE_POLL_MS);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener(RUNTIME_STATE_EVENT_NAME, onEvent as EventListener);
    };
  }, []);

  return [runtimeState, setRuntimeState];
}
