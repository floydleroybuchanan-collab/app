import { storage } from "@/src/utils/storage";
import { migrateMedia3OnlyPreferences } from "@/src/core/media3OnlyMigration";

export type PlayerEnginePreference = "media3";

// Always select Media3 synchronously. Old settings cannot briefly activate a
// removed engine while AsyncStorage is hydrating, even if migration fails.
export function getPlayerEnginePreference(): PlayerEnginePreference {
  return "media3";
}

// Remove retired controls without touching source credentials or audio choices.
// Repeating this on launch is intentional: a restored backup may contain them.
void migrateMedia3OnlyPreferences(storage).catch(() => undefined);
