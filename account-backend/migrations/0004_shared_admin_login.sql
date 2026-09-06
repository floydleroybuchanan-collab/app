-- Viewing must be explicitly granted by the owner; no existing timers change.
ALTER TABLE admin_profiles ADD COLUMN viewer_access INTEGER NOT NULL DEFAULT 0 CHECK(viewer_access IN (0,1));
