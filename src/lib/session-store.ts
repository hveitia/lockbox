import { randomUUID } from "node:crypto";

export type SessionStore = {
  create(key: Buffer): string;
  get(id: string | undefined): Buffer | null;
  destroy(id: string | undefined): void;
  destroyAll(): void;
  size(): number;
};

type Options = {
  ttlMs: number;
  now?: () => number;
};

/**
 * Holds unlocked vault keys in process memory only — never on disk.
 * Restarting the server therefore re-locks the vault, which is the point.
 * Expiry slides on every read so an active session is not interrupted.
 */
export function createSessionStore({ ttlMs, now = Date.now }: Options): SessionStore {
  const sessions = new Map<string, { key: Buffer; expiresAt: number }>();

  return {
    create(key) {
      const id = randomUUID();
      sessions.set(id, { key, expiresAt: now() + ttlMs });
      return id;
    },

    get(id) {
      if (!id) return null;

      const session = sessions.get(id);
      if (!session) return null;

      if (session.expiresAt <= now()) {
        sessions.delete(id);
        return null;
      }

      session.expiresAt = now() + ttlMs;
      return session.key;
    },

    destroy(id) {
      if (id) sessions.delete(id);
    },

    destroyAll() {
      sessions.clear();
    },

    size() {
      return sessions.size;
    },
  };
}
