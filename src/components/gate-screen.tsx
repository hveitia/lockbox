"use client";

import { useActionState } from "react";

import { setupAction, unlockAction } from "@/app/actions.ts";
import { errorOf, IDLE } from "@/app/action-state.ts";
import { MIN_MASTER_PASSWORD_LENGTH } from "@/lib/entry.ts";

const COPY = {
  setup: {
    heading: "Set a master password",
    note: `This unlocks everything. There is no recovery — at least ${MIN_MASTER_PASSWORD_LENGTH} characters, and keep it somewhere you trust.`,
    submit: "Create vault",
  },
  unlock: {
    heading: "Unlock the vault",
    note: "The vault locks itself after 30 minutes idle, and whenever the server restarts.",
    submit: "Unlock",
  },
} as const;

export function GateScreen({ mode }: { mode: "setup" | "unlock" }) {
  const action = mode === "setup" ? setupAction : unlockAction;
  const [state, formAction, pending] = useActionState(action, IDLE);
  const error = errorOf(state);
  const copy = COPY[mode];

  return (
    <main className="grid min-h-dvh place-items-center px-6 py-16">
      <div className="w-full max-w-sm">
        <p className="text-[0.6875rem] uppercase tracking-[0.28em] text-brass-dim">
          Local only
        </p>

        <h1 className="mt-3 font-display text-4xl leading-[1.1] font-semibold">
          {copy.heading}
        </h1>

        <div className="mt-6 h-px w-full bg-brass/40" />

        <form action={formAction} className="mt-6 space-y-4">
          <div>
            <label className="label" htmlFor="masterPassword">
              Master password
            </label>
            <input
              id="masterPassword"
              name="masterPassword"
              type="password"
              className="field"
              autoComplete={mode === "setup" ? "new-password" : "current-password"}
              autoFocus
              required
            />
          </div>

          {mode === "setup" && (
            <div>
              <label className="label" htmlFor="confirmation">
                Type it again
              </label>
              <input
                id="confirmation"
                name="confirmation"
                type="password"
                className="field"
                autoComplete="new-password"
                required
              />
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-alarm">
              {error}
            </p>
          )}

          <button type="submit" className="btn-primary w-full" disabled={pending}>
            {pending ? "Working…" : copy.submit}
          </button>
        </form>

        <p className="mt-6 text-xs leading-relaxed text-muted">{copy.note}</p>

        <p className="mt-8 font-mono text-[0.6875rem] text-muted/70">
          Everything stays on this machine.
        </p>
      </div>
    </main>
  );
}
