/**
 * Shared result shape for every server action.
 * Lives outside actions.ts because a "use server" module may only export
 * async functions.
 */
export type ActionState =
  | { status: "idle" }
  | { status: "ok" }
  /** `values` carries the rejected submission back so the form can refill itself. */
  | { status: "error"; message: string; values?: Record<string, string> };

export const IDLE: ActionState = { status: "idle" };
export const OK: ActionState = { status: "ok" };

export function failed(
  error: unknown,
  values?: Record<string, string>,
): ActionState {
  return {
    status: "error",
    message: error instanceof Error ? error.message : "Something went wrong",
    values,
  };
}

export function errorOf(state: ActionState): string | null {
  return state.status === "error" ? state.message : null;
}

/**
 * What a field should show now: whatever the user last submitted if the write
 * was rejected, otherwise the stored value. Losing a typed password to a
 * validation error on another field is not acceptable here.
 */
export function fieldValue(
  state: ActionState,
  name: string,
  fallback: string,
): string {
  if (state.status === "error" && state.values) {
    return state.values[name] ?? fallback;
  }

  return fallback;
}
