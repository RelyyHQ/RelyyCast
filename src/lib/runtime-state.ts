import type {
  RuntimeProcessState,
  RuntimeState,
} from "@/src/runtime/neutralino-runtime-orchestrator";

export const OFFLINE_PROCESS: ProcessRuntime = {
  running: false,
  lastError: null,
};

export function normalizeProcessRuntime(input: RuntimeProcessState | undefined): ProcessRuntime {
  if (!input) return OFFLINE_PROCESS;
  return {
    running: input.running === true,
    lastError: typeof input.lastError === "string" ? input.lastError : null,
  };
}

function getRuntimeStateTimestamp(state: RuntimeState): number {
  if (!state.lastUpdatedAt) return 0;
  const ts = Date.parse(state.lastUpdatedAt);
  return Number.isFinite(ts) ? ts : 0;
}

/** Returns whichever state has the more recent lastUpdatedAt timestamp. */
export function selectNewestRuntimeState(
  current: RuntimeState | null,
  persisted: RuntimeState | null,
): RuntimeState | null {
  if (!current) return persisted;
  if (!persisted) return current;
  return getRuntimeStateTimestamp(persisted) >= getRuntimeStateTimestamp(current)
    ? persisted
    : current;
}
