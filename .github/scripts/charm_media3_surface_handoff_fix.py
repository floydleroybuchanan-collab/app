"""Validate (or no-op) Media3 surface ownership against the TiViMate player.

Historical one-shot patches expected an older prepare()/PlayerView block that
no longer exists after the TiViMate realignment. The live code already binds
the replacement target before clearInactivePlayerView(), so this script now
succeeds when that contract is present instead of failing Actions with red X's.
"""

from pathlib import Path
import sys

mgr = Path("frontend/android/app/src/main/java/com/charmiptv/app/NativePlaybackManager.kt")
clients = Path("frontend/android/app/src/main/java/com/charmiptv/app/CharmHttpClients.kt")
if not mgr.exists():
    raise SystemExit(f"Missing playback manager: {mgr}")
if not clients.exists():
    raise SystemExit(f"Missing shared HTTP clients: {clients}")

text = mgr.read_text(encoding="utf-8")
client_text = clients.read_text(encoding="utf-8")

required = [
    "fun prepare(requestedOwner: Owner",
    "clearInactivePlayerView(requestedOwner)",
    "RECONNECT_STALL_MS = 50_000L",
    "START_TIMEOUT_MS = 60_000L",
    "fun tivimateBufferDurationsMs",
    "CharmHttpClients.mediaClient()",
]
missing = [token for token in required if token not in text]
if missing:
    raise SystemExit(f"TiViMate Media3 surface/handoff contract incomplete; missing: {missing}")

http_required = [
    "readTimeout(0, TimeUnit.SECONDS)",
    "connectTimeout(20, TimeUnit.SECONDS)",
    "writeTimeout(0, TimeUnit.SECONDS)",
]
http_missing = [token for token in http_required if token not in client_text]
if http_missing:
    raise SystemExit(f"CharmHttpClients media contract incomplete; missing: {http_missing}")

removed = [
    "HUNG_BUFFER_REPREPARE_MS",
    "HARD_STALL_RECOVERY_MS",
    "TRANSPORT_HUNG_BUFFER_REPREPARE_MS",
    "STABLE_REARM_MS",
    "stableSinceMs",
]
present_removed = [token for token in removed if token in text]
if present_removed:
    raise SystemExit(f"Legacy Charm timers still present: {present_removed}")

# Prefer the already-landed bind-before-clear order.
prepare_start = text.find("fun prepare(requestedOwner: Owner")
prepare_end = text.find("fun provideFreshSource", prepare_start)
prepare = text[prepare_start:prepare_end] if prepare_start >= 0 and prepare_end > prepare_start else ""
bind_pos = prepare.find("video.player = instance")
clear_pos = prepare.find("clearInactivePlayerView(requestedOwner)")
if bind_pos < 0 or clear_pos < 0 or bind_pos > clear_pos:
    raise SystemExit("prepare() must bind the replacement PlayerView before clearInactivePlayerView()")

print("Media3 TiViMate surface/handoff contract already satisfied; no patch required")
sys.exit(0)
