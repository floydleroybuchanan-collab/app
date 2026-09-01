package com.charmiptv.app

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Transaction
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Entity(tableName = "epg_sources")
internal data class EpgSourceEntity(
  @PrimaryKey val playlistId: String,
  val url: String,
  val enabled: Boolean = true,
  val refreshHours: Int = 12,
  val serverOffsetMinutes: Int = 0,
  val playlistOffsetMinutes: Int = 0,
  val updatedAtSeconds: Long,
)

@Entity(
  tableName = "epg_channel_offsets",
  primaryKeys = ["playlistId", "channelId"],
  indices = [Index("playlistId")],
)
internal data class EpgChannelOffsetEntity(
  val playlistId: String,
  val channelId: String,
  val offsetMinutes: Int,
)

@Entity(
  tableName = "epg_channel_bindings",
  primaryKeys = ["playlistId", "channelId"],
  indices = [Index("playlistId"), Index("channelId")],
)
internal data class EpgChannelBindingEntity(
  val playlistId: String,
  val channelId: String,
  val xmltvId: String,
)

@Entity(tableName = "epg_automatic_bindings", indices = [Index("playlistId")])
internal data class EpgAutomaticBindingEntity(
  @PrimaryKey val channelId: String,
  val playlistId: String,
  val xmltvId: String,
  val matchReason: String = "exact_id",
)

@Entity(tableName = "epg_import_state")
internal data class EpgImportStateEntity(
  @PrimaryKey val playlistId: String,
  val lastAttemptSeconds: Long = 0,
  val lastSuccessSeconds: Long = 0,
  val blackoutUntilSeconds: Long = 0,
  val lastError: String = "",
  val state: String = "idle",
  val attemptCount: Int = 0,
  val nextRetrySeconds: Long = 0,
  val lastDurationMs: Long = 0,
  val lastProgrammeCount: Long = 0,
  val lastTrigger: String = "",
)

@Entity(
  tableName = "epg_update_history",
  indices = [Index("sourceId"), Index("startedAtSeconds")],
)
internal data class EpgUpdateHistoryEntity(
  @PrimaryKey(autoGenerate = true) val id: Long = 0,
  val sourceId: String,
  val kind: String,
  val state: String,
  val trigger: String,
  val attempt: Int,
  val startedAtSeconds: Long,
  val finishedAtSeconds: Long = 0,
  val rowCount: Long = 0,
  val error: String = "",
)

@Dao
internal interface EpgControlDao {
  @Query("SELECT * FROM epg_sources WHERE enabled = 1 ORDER BY playlistId")
  fun enabledSources(): List<EpgSourceEntity>

  @Query("SELECT * FROM epg_sources WHERE playlistId LIKE 'user:%' ORDER BY playlistId")
  fun userSources(): List<EpgSourceEntity>

  @Query("SELECT * FROM epg_sources WHERE playlistId = :playlistId LIMIT 1")
  fun source(playlistId: String): EpgSourceEntity?

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  fun putSource(source: EpgSourceEntity)

  @Query("DELETE FROM epg_sources WHERE playlistId = :sourceId")
  fun removeSource(sourceId: String)

  @Query("SELECT * FROM epg_channel_offsets WHERE playlistId = :playlistId")
  fun channelOffsets(playlistId: String): List<EpgChannelOffsetEntity>

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  fun putChannelOffsets(offsets: List<EpgChannelOffsetEntity>)

  @Query("DELETE FROM epg_channel_offsets WHERE playlistId = :playlistId")
  fun clearChannelOffsets(playlistId: String)

  @Query("SELECT * FROM epg_channel_bindings WHERE playlistId = :playlistId AND channelId IN (:channelIds)")
  fun channelBindings(playlistId: String, channelIds: List<String>): List<EpgChannelBindingEntity>

  @Query("SELECT * FROM epg_channel_bindings WHERE playlistId = :playlistId")
  fun allChannelBindings(playlistId: String): List<EpgChannelBindingEntity>

  @Query("SELECT playlistId, channelId, xmltvId FROM epg_channel_bindings WHERE playlistId = :playlistId UNION ALL SELECT playlistId, channelId, xmltvId FROM epg_automatic_bindings a WHERE a.playlistId = :playlistId AND NOT EXISTS (SELECT 1 FROM epg_channel_bindings m WHERE m.channelId = a.channelId)")
  fun effectiveBindings(playlistId: String): List<EpgChannelBindingEntity>

  @Query("SELECT playlistId, channelId, xmltvId FROM epg_channel_bindings WHERE playlistId = :playlistId AND channelId IN (:channelIds) UNION ALL SELECT playlistId, channelId, xmltvId FROM epg_automatic_bindings a WHERE a.playlistId = :playlistId AND a.channelId IN (:channelIds) AND NOT EXISTS (SELECT 1 FROM epg_channel_bindings m WHERE m.channelId = a.channelId)")
  fun effectiveBindingsForChannels(playlistId: String, channelIds: List<String>): List<EpgChannelBindingEntity>

  @Query("DELETE FROM epg_automatic_bindings")
  fun clearAutomaticBindings()

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  fun putAutomaticBindings(rows: List<EpgAutomaticBindingEntity>)

  @Query("SELECT * FROM epg_automatic_bindings WHERE channelId IN (:channelIds)")
  fun automaticBindingsForChannels(channelIds: List<String>): List<EpgAutomaticBindingEntity>

  @Transaction
  fun replaceAutomaticBindings(rows: List<EpgAutomaticBindingEntity>) {
    clearAutomaticBindings()
    if (rows.isNotEmpty()) putAutomaticBindings(rows)
  }

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  fun putChannelBindings(bindings: List<EpgChannelBindingEntity>)

  @Query("DELETE FROM epg_channel_bindings WHERE playlistId = :playlistId")
  fun clearChannelBindings(playlistId: String)

  @Query("DELETE FROM epg_channel_bindings WHERE playlistId = :playlistId AND channelId = :channelId")
  fun clearChannelBinding(playlistId: String, channelId: String)

  // Legacy custom EPG is exactly `user`; additional sources are normalized to
  // `user:<id>`. Exclusive assignment must clear both families atomically.
  @Query("DELETE FROM epg_channel_bindings WHERE (playlistId = 'user' OR playlistId LIKE 'user:%') AND channelId = :channelId")
  fun clearUserChannelBindings(channelId: String)

  @Query("SELECT COUNT(*) FROM epg_channel_bindings WHERE playlistId = :playlistId")
  fun channelBindingCount(playlistId: String): Int

  /**
   * Compatibility bulk path used by older JS ownership configuration.
   *
   * Once any native binding exists, Room is authoritative: an old/stale JS map
   * may be identical (no-op) but it can never replace or clear the native set.
   * An empty table may still be seeded for legacy migration compatibility.
   */
  @Transaction
  fun replaceChannelBindings(playlistId: String, bindings: List<EpgChannelBindingEntity>) {
    val existing = allChannelBindings(playlistId)
    if (existing.isEmpty()) {
      if (bindings.isNotEmpty()) putChannelBindings(bindings)
      return
    }
    val existingMap = existing.associate { it.channelId to it.xmltvId }
    val incomingMap = bindings
      .filter { it.channelId.isNotBlank() && it.xmltvId.isNotBlank() }
      .associate { it.channelId to it.xmltvId }
    if (existingMap == incomingMap) return
    // Deliberately ignore a divergent legacy bulk snapshot. All live edits use
    // setChannelBinding()/setExclusiveUserChannelBinding() through native APIs.
  }

  @Transaction
  fun importChannelBindingsIfEmpty(
    playlistId: String,
    bindings: List<EpgChannelBindingEntity>,
  ): Boolean {
    if (channelBindingCount(playlistId) > 0 || bindings.isEmpty()) return false
    putChannelBindings(bindings)
    return true
  }

  @Transaction
  fun setChannelBinding(playlistId: String, channelId: String, xmltvId: String) {
    clearChannelBinding(playlistId, channelId)
    if (xmltvId.isNotBlank()) {
      putChannelBindings(listOf(EpgChannelBindingEntity(playlistId, channelId, xmltvId)))
    }
  }

  @Transaction
  fun setExclusiveUserChannelBinding(sourceId: String, channelId: String, xmltvId: String) {
    clearUserChannelBindings(channelId)
    if (xmltvId.isNotBlank()) putChannelBindings(listOf(EpgChannelBindingEntity(sourceId, channelId, xmltvId)))
  }

  @Transaction
  fun removeUserSource(sourceId: String) {
    clearChannelBindings(sourceId)
    clearChannelOffsets(sourceId)
    removeSource(sourceId)
  }

  @Query("SELECT * FROM epg_import_state WHERE playlistId = :playlistId LIMIT 1")
  fun importState(playlistId: String): EpgImportStateEntity?

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  fun putImportState(state: EpgImportStateEntity)

  @Query("SELECT * FROM epg_import_state ORDER BY playlistId")
  fun allImportStates(): List<EpgImportStateEntity>

  @Insert
  fun addUpdateHistory(row: EpgUpdateHistoryEntity): Long

  @Query("UPDATE epg_update_history SET state = :state, finishedAtSeconds = :finishedAt, rowCount = :rowCount, error = :error WHERE id = :id")
  fun finishUpdateHistory(id: Long, state: String, finishedAt: Long, rowCount: Long, error: String)

  @Query("SELECT * FROM epg_update_history ORDER BY startedAtSeconds DESC, id DESC LIMIT :limit")
  fun recentUpdateHistory(limit: Int): List<EpgUpdateHistoryEntity>

  @Query("DELETE FROM epg_update_history WHERE id NOT IN (SELECT id FROM epg_update_history ORDER BY startedAtSeconds DESC, id DESC LIMIT :keep)")
  fun trimUpdateHistory(keep: Int)
}

@Database(
  entities = [EpgSourceEntity::class, EpgChannelOffsetEntity::class, EpgChannelBindingEntity::class, EpgImportStateEntity::class, EpgAutomaticBindingEntity::class, EpgUpdateHistoryEntity::class],
  version = 5,
  exportSchema = true,
)
internal abstract class EpgControlDatabase : RoomDatabase() {
  abstract fun dao(): EpgControlDao

  companion object {
    @Volatile private var instance: EpgControlDatabase? = null

    fun get(context: Context): EpgControlDatabase = instance ?: synchronized(this) {
      instance ?: Room.databaseBuilder(
        context.applicationContext,
        EpgControlDatabase::class.java,
        "charm_epg_control.db",
      ).addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5).build().also { instance = it }
    }

    private val MIGRATION_4_5 = object : Migration(4, 5) {
      override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE epg_import_state ADD COLUMN state TEXT NOT NULL DEFAULT 'idle'")
        db.execSQL("ALTER TABLE epg_import_state ADD COLUMN attemptCount INTEGER NOT NULL DEFAULT 0")
        db.execSQL("ALTER TABLE epg_import_state ADD COLUMN nextRetrySeconds INTEGER NOT NULL DEFAULT 0")
        db.execSQL("ALTER TABLE epg_import_state ADD COLUMN lastDurationMs INTEGER NOT NULL DEFAULT 0")
        db.execSQL("ALTER TABLE epg_import_state ADD COLUMN lastProgrammeCount INTEGER NOT NULL DEFAULT 0")
        db.execSQL("ALTER TABLE epg_import_state ADD COLUMN lastTrigger TEXT NOT NULL DEFAULT ''")
        db.execSQL("ALTER TABLE epg_automatic_bindings ADD COLUMN matchReason TEXT NOT NULL DEFAULT 'exact_id'")
        db.execSQL("CREATE TABLE IF NOT EXISTS epg_update_history (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, sourceId TEXT NOT NULL, kind TEXT NOT NULL, state TEXT NOT NULL, trigger TEXT NOT NULL, attempt INTEGER NOT NULL, startedAtSeconds INTEGER NOT NULL, finishedAtSeconds INTEGER NOT NULL, rowCount INTEGER NOT NULL, error TEXT NOT NULL)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_epg_update_history_sourceId ON epg_update_history(sourceId)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_epg_update_history_startedAtSeconds ON epg_update_history(startedAtSeconds)")
      }
    }

    private val MIGRATION_3_4 = object : Migration(3, 4) {
      override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("CREATE TABLE IF NOT EXISTS epg_automatic_bindings (channelId TEXT NOT NULL, playlistId TEXT NOT NULL, xmltvId TEXT NOT NULL, PRIMARY KEY(channelId))")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_epg_automatic_bindings_playlistId ON epg_automatic_bindings(playlistId)")
      }
    }

    private val MIGRATION_1_2 = object : Migration(1, 2) {
      override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
          "CREATE TABLE IF NOT EXISTS epg_channel_offsets (" +
            "playlistId TEXT NOT NULL, channelId TEXT NOT NULL, offsetMinutes INTEGER NOT NULL, " +
            "PRIMARY KEY(playlistId, channelId))"
        )
        db.execSQL("CREATE INDEX IF NOT EXISTS index_epg_channel_offsets_playlistId ON epg_channel_offsets(playlistId)")
        db.execSQL(
          "CREATE TABLE IF NOT EXISTS epg_import_state (" +
            "playlistId TEXT NOT NULL, lastAttemptSeconds INTEGER NOT NULL, " +
            "lastSuccessSeconds INTEGER NOT NULL, blackoutUntilSeconds INTEGER NOT NULL, " +
            "lastError TEXT NOT NULL, PRIMARY KEY(playlistId))"
        )
      }
    }

    private val MIGRATION_2_3 = object : Migration(2, 3) {
      override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
          "CREATE TABLE IF NOT EXISTS epg_channel_bindings (" +
            "playlistId TEXT NOT NULL, channelId TEXT NOT NULL, xmltvId TEXT NOT NULL, " +
            "PRIMARY KEY(playlistId, channelId))"
        )
        db.execSQL("CREATE INDEX IF NOT EXISTS index_epg_channel_bindings_playlistId ON epg_channel_bindings(playlistId)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_epg_channel_bindings_channelId ON epg_channel_bindings(channelId)")
      }
    }
  }
}
