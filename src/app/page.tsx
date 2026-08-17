import { GateScreen } from "@/components/gate-screen.tsx";
import { VaultScreen } from "@/components/vault-screen.tsx";
import { getDatabase, getSessionKey, listBackups } from "@/lib/server.ts";
import { isInitialized, listEntries } from "@/lib/vault.ts";

// The vault key lives in server memory, so this page can never be prerendered.
export const dynamic = "force-dynamic";

export default async function Home() {
  const db = getDatabase();
  const key = await getSessionKey();

  if (!key) {
    return <GateScreen mode={isInitialized(db) ? "unlock" : "setup"} />;
  }

  return <VaultScreen entries={listEntries(db, key)} backups={listBackups()} />;
}
