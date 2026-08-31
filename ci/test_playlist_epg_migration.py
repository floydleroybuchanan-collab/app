"""Exercise the shipped Room migration and binding SQL with real SQLite."""
import json
from pathlib import Path
import re
import sqlite3
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "frontend/android/app/src/main/java/com/charmiptv/app/EpgControlDatabase.kt").read_text(encoding="utf-8")
SCHEMA = json.loads((ROOT / "frontend/android/app/schemas/com.charmiptv.app.EpgControlDatabase/4.json").read_text(encoding="utf-8"))["database"]


class PlaylistEpgMigration(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        for entity in SCHEMA["entities"]:
            if entity["tableName"] != "epg_automatic_bindings":
                self.db.execute(entity["createSql"].replace("${TABLE_NAME}", entity["tableName"]))
        self.db.execute("INSERT INTO epg_channel_bindings VALUES ('user:manual', 'existing-favorite', 'regional-station')")
        migration = SOURCE.split("private val MIGRATION_3_4", 1)[1].split("private val MIGRATION_1_2", 1)[0]
        for sql in re.findall(r'db.execSQL\("([^"]+)"\)', migration):
            self.db.execute(sql)
        query = re.search(r'@Query\("([^"\n]+)"\)\s+fun effectiveBindings\(', SOURCE)
        self.assertIsNotNone(query)
        self.query = query.group(1)

    def tearDown(self):
        self.db.close()

    def rows(self, source):
        return self.db.execute(self.query, {"playlistId": source}).fetchall()

    def test_upgrade_preserves_manual_assignments(self):
        self.assertEqual(self.rows("user:manual"), [("user:manual", "existing-favorite", "regional-station")])
        columns = {row[1] for row in self.db.execute("PRAGMA table_info(epg_automatic_bindings)")}
        self.assertEqual(columns, {"channelId", "playlistId", "xmltvId"})

    def test_manual_assignment_wins_without_destroying_automatic_binding(self):
        self.db.execute("INSERT INTO epg_automatic_bindings VALUES ('existing-favorite', 'user:auto', 'wrong-region')")
        self.assertEqual(self.rows("user:auto"), [])
        self.assertEqual(len(self.rows("user:manual")), 1)
        self.db.execute("DELETE FROM epg_channel_bindings WHERE channelId='existing-favorite'")
        self.assertEqual(self.rows("user:auto"), [("user:auto", "existing-favorite", "wrong-region")])

    def test_same_xmltv_id_stays_with_its_own_feed(self):
        self.db.executemany("INSERT INTO epg_automatic_bindings VALUES (?, ?, ?)", [
            ("pl:first:channel", "user:first-feed", "shared-tvg-id"),
            ("pl:second:channel", "user:second-feed", "shared-tvg-id"),
        ])
        self.assertEqual(self.rows("user:first-feed"), [("user:first-feed", "pl:first:channel", "shared-tvg-id")])
        self.assertEqual(self.rows("user:second-feed"), [("user:second-feed", "pl:second:channel", "shared-tvg-id")])

    def test_automatic_rebuild_does_not_erase_manual_state(self):
        self.db.execute("DELETE FROM epg_automatic_bindings")
        self.assertEqual(len(self.rows("user:manual")), 1)


if __name__ == "__main__":
    unittest.main()
