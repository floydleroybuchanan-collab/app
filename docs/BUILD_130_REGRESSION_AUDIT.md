# Build 130 regression: startup and playback handoffs

Date: August 28, 2026. Branch: `fix/tivimate-m3u-epg-ci-align`.

## Report and evidence boundary

Build 129 (`eea2812f5f8dc2b4c46c15e30d4cf0f5eda0baca`) produced video and
audio but the owner reported periodic brief freezes and later navigation
lockups. Build 130 (`0eb9fc39a832667fd0572132ca48b20cfaa80323`) instead showed
a black screen with no sound and no onscreen error. The reported devices are
an Onn 4K box, NVIDIA Shield and Fire TV Stick.

The tests below reproduce code defects. There is no connected TV, logcat,
ANR trace or frame trace establishing which paths ran on the owner's devices.
In particular, a stopped Guide preview alone does not explain a fresh direct
Favorites-to-fullscreen failure. The replacement is a test candidate, not a
claim of verified hardware playback or a rollback to Build 129.

## Confirmed defects and corrections

| Path | Evidence | Correction |
| --- | --- | --- |
| Routine memory pressure stops preview | Build 130 newly recognizes Android `TRIM_MEMORY_RUNNING_MODERATE` (5). Executing the actual Guide handler shows any pressure cancels the pending/playing preview; its later timer restores logos only, leaving preview stopped. | Noncritical pressure trims disposable caches without cancelling the visible or pending preview. Real route/background transitions still stop hidden Guide work. |
| Native startup grace bypassed by JavaScript | Native trim is deferred for 15 seconds during startup, but MainApplication still emits the JS pressure event. | One acceptance result gates both native trim and its matching JS notification. The duration is unchanged; critical pressure still passes. |
| Critical pressure leaves an unexplained blank preview | Critical pressure must still be able to free the preview decoder. Restoring logos is not permission to restart it. | Preserve the selected channel and show a memory-pause message. A different channel, explicit Play/group action or genuine foreground return can resume; an EPG refresh or timer cannot retune the same channel. Stale preview callbacks are invalidated. |
| Release timeout latches permanently | Build 130 correctly detects Media3's synchronous release-timeout event, but never recognizes that the internal release path may finish later. | Capture the current player's live, dedicated playback thread before release. Only its later `TERMINATED` state can acknowledge a timeout-only failure on a subsequent operation. A no-op second release, another thread, elapsed time or arbitrary exception cannot clear it. No polling or new timeout was added. |
| New host can retain an old video target | A Fabric host can attach while release is quarantined. The saved PlayerView may be absent or belong to the previous host. | After internal release completion, prepare resolves the PlayerView against the current host instead of reusing a stale cached target. |
| Failed stop reported as successful handoff | Executing the real ownership registry, coordinator and navigation helper shows native stop rejection being swallowed, followed by fullscreen navigation or an idle JS owner. | Stop returns a nonthrowing `completed` / `failed` / `superseded` outcome. New playback requires `completed`; failed releases remain visible to ownership subscribers. Back can still leave after cleanup settles. A later explicit Play can ask native for a fresh acknowledgement. |
| Route/crash retry ignores cleanup outcome | A route replacement or error-boundary reset can proceed without a successful stop. The shared error boundary resets synchronously even if its old onReset callback starts asynchronous work. | The player inspects stop outcomes before changing the channel or resetting the boundary. Retry owns its awaited stop; stale navigation cannot remount the player. |
| Returning to Guide after failed stop appears black | Preview ownership correctly remains blocked, but no preview status is emitted by an unfocused StreamPlayer. | Guide observes the retained release-failure state and shows an explicit cleanup message with an intentional Play/retry path. Hidden-preview settings remain respected. |

## Media3 release evidence and limits

The pinned Media3 1.8.0 source commit is
`b7bbc6e2bc3e45ff3ed99884c114c50f03bba5c9`:

- [ExoPlayerImpl.release](https://github.com/androidx/media/blob/b7bbc6e2bc3e45ff3ed99884c114c50f03bba5c9/libraries/exoplayer/src/main/java/androidx/media3/exoplayer/ExoPlayerImpl.java)
  emits a release-timeout error synchronously and can return normally. It also
  retires listeners, so the application's normal invalidated source listener
  cannot be the only release observer.
- [ExoPlayerImplInternal.release/releaseInternal](https://github.com/androidx/media/blob/b7bbc6e2bc3e45ff3ed99884c114c50f03bba5c9/libraries/exoplayer/src/main/java/androidx/media3/exoplayer/ExoPlayerImplInternal.java)
  makes later release calls no-ops. The internal release path invokes its looper
  release and processed-condition acknowledgement in `finally`.
- [PlaybackLooperProvider](https://github.com/androidx/media/blob/b7bbc6e2bc3e45ff3ed99884c114c50f03bba5c9/libraries/exoplayer/src/main/java/androidx/media3/exoplayer/PlaybackLooperProvider.java)
  quits the dedicated playback thread when its owned reference count reaches
  zero. Charm uses the default builder; no shared/external playback looper is
  installed.

Thread termination proves that this internal playback thread has ended. Like
Media3's normal acknowledgement, it does not independently prove flawless
vendor codec/resource cleanup. Exceptions from release or listener cleanup
remain quarantined. The guard also rejects reentrant acknowledgement until the
outer release and temporary-listener cleanup finish. Persistent failures may
still require Android Settings → Apps → CharmIPTV → Force stop, then reopen.
Home alone does not restart the process; clearing app data is unnecessary.

## Scope retained from Build 129/130

This repair keeps the [earlier resource and lifecycle changes](BUILD_129_FOLLOWUP_AUDIT.md):
stable source identity, pause/resume intent, serialized native ownership,
cancellable hidden Guide work, bounded programme caches/cookies/maintenance,
and drawer/overlay focus cleanup. It does not undo the memory protections or
substitute a different player.

No buffer profile, HTTP deadline, retry delay, parser, codec preference,
timestamp tolerance or decoder release deadline changed in this repair.
Normal established `BUFFERING` is still not a reason to tear down playback.
There is no lifetime three-interruption cutoff and no automatic VLC fallback.
VLC remains removed under the earlier explicit request; FFmpeg remains the
Media3 audio extension, not a second video player or an app remuxer.

The [TiviMate analysis repository](https://github.com/Eliminater74/TiVIMate_Analysis/tree/eab124bb2cf19d0512fa729c30e3328177db434c)
was checked again through GitHub's recursive tree API before this final review:
main remains at `eab124bb2cf19d0512fa729c30e3328177db434c`, with 53 Markdown
files and no source/resource subtrees. It is a collection of analysis reports,
not a complete verifiable TiviMate source tree. Its claimed proprietary timing values are not treated as established
defaults. The [pinned Media3 timing reference](MEDIA3_1_8_TIMING_REFERENCE.md)
separately identifies upstream values and Charm overrides.

## Verification

Regression coverage executes the actual Guide callbacks, StreamPlayer effects,
ownership registry and coordinator with controlled asynchronous dependencies.
JVM tests cover startup-grace boundaries and release completion/failure cases;
source checks verify Android wiring and current-host target selection.

The final delivery must record the frontend, native JVM, CI/source and backend test
counts; lint, TypeScript and native compilation; the source commit and CI run;
and independent APK hash, signature, ARM32/ARM64 and 16 KiB alignment checks.
Those are not device playback tests. Use the
[30-item testers' guide](MEDIA3_STARTUP_TESTERS_GUIDE.md), beginning with cold
launch, direct fullscreen, sustained playback and repeated exits on each TV.

No provider secret value, main-branch content, parent checkout or public PR
description is changed by this repair. The existing encrypted artifact flow
uses `M3U_URL` and `EPG_URL` without the old provider-variable fallback; GitHub
secret metadata cannot establish their plaintext values.
