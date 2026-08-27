# Workflow playback audit — 2026-08-27

All 158 checked-in YAML workflows were parsed and inventoried, including event/branch/path filters, job conditions, checkout refs, every shell step, permissions, build and repository/cloud side effects. This is source review, not a claim that every historical workflow was executed.

## Workflows relevant to this candidate

- `build-media3-sideload-now.yml`: exact feature SHA; tests, Kotlin/Java/JVM tests, pinned FFmpeg, ARM APK, build-tools verification and encrypted artifact. Removed its branch-writing run pointer and duplicate PR build trigger; contents permission is read-only.
- `android-native-ci.yml`: exact event checkout; replaced obsolete 50-second/four-retry/oversized-buffer requirements with the current ownership and bounded-recovery test contract. Added the feature branch and JVM tests; removed unrelated hard-coded PR 31 comments. Its final gate still fails if any collected check fails.
- `frontend-ci.yml`: PR check including Expo doctor, tests, typecheck and lint.
- `ram-epg-test.yml`: PR compile plus FFmpeg; APK assembly only on its experiment-branch push. Removed an obsolete Jest-only argument from the Node test runner.
- Historical phase9 PR workflows use narrow path filters and mostly hard-code other checkout branches. In particular `phase9-media3-guide-live-repair.yml` has no head-branch guard but checks out another branch; its trigger paths are untouched here. Do not dispatch these to build this audit candidate.
- `charm-refresh.yml` refreshes M3U/XMLTV metadata into Cloudflare KV on the default branch schedule; it neither owns nor proxies an Android decoder. `deploy-cloudflare-worker.yml` deploys the metadata API. Neither was run for this audit.

## Historical workflow risks

Many legacy manual workflows check out or push a fixed branch and can overwrite source, open PRs or deploy Cloudflare state. A workflow-dispatch branch selection is not sufficient to override an explicit checkout ref. They were reviewed but deliberately not dispatched or bulk-rewritten. None is evidence for this candidate unless its recorded source SHA matches the artifact. The table exposes these branch and side-effect differences.

## Complete inventory

| Workflow | Events / branch filters | Checkout | Role / job guards |
| --- | --- | --- | --- |
| android-native-ci.yml | pull_request [main, agent/media3-validation-base-no-apk] (13 path filters); push [main, agent/media3-opaque-live-startup-hardening, agent/manual-vlc-engine, fix/tivimate-m3u-epg-ci-align] (13 path filters); workflow_dispatch | event ref | native compile, validation |
| apply-build8-final-memory.yml | push [fix/purple-next-build8-tester-pass] (1 path filters) | fix/purple-next-build8-tester-pass | repository mutation |
| apply-build8-http-redirect-fix.yml | push [fix/purple-next-build8-tester-pass] (1 path filters) | fix/purple-next-build8-tester-pass | repository mutation |
| apply-build8-rescan2-followup.yml | push [fix/purple-next-build8-tester-pass] (1 path filters) | fix/purple-next-build8-tester-pass | repository mutation |
| apply-build8-rescan2.yml | push [fix/purple-next-build8-tester-pass] (1 path filters) | fix/purple-next-build8-tester-pass | repository mutation |
| apply-code-interaction-audit-settings-player-repair.yml | push [agent/code-interaction-audit] (1 path filters); pull_request [agent/code-interaction-audit] (1 path filters) | agent/code-interaction-audit | repository mutation, validation |
| apply-phase9-overlay-focus.yml | push [agent/phase9-tivimate-scan-repair] (1 path filters) | agent/phase9-tivimate-scan-repair | repository mutation |
| apply-ram-final-crosscheck.yml | push [experiment/full-ram-epg-engine] (1 path filters) | experiment/full-ram-epg-engine | repository mutation |
| apply-tivimate-overhaul.yml | push [agent/tivimate-architecture-overhaul] (1 path filters) | agent/tivimate-architecture-overhaul | repository mutation |
| build-media3-sideload-now.yml | workflow_dispatch; push [agent/media3-player-core-rebuild, agent/manual-vlc-engine, fix/tivimate-m3u-epg-ci-align] (11 path filters) | ${{ github.event.pull_request.head.sha &#124;&#124; github.sha }} | APK/build, FFmpeg, validation |
| build-phoenix-apk.yml | workflow_dispatch; push [perf/opt-fix, agent/tivimate-deep-player-quickactions-repair, agent/media3-player-core-rebuild] (2 path filters) | event ref | APK/build, FFmpeg, validation |
| build8-final-sideload.yml | push [fix/purple-next-build8-tester-pass] (2 path filters) | event ref | APK/build, FFmpeg, validation |
| build8-fix-validation.yml | push [fix/purple-next-build8-tester-pass] (2 path filters) | event ref | repository mutation, native compile, validation |
| build_perf_smoke.yml | workflow_dispatch | event ref | APK/build, FFmpeg |
| cancel-active-apk-build.yml | push [main] (1 path filters) | none | repository mutation |
| charm-final-owner-handoff-fix.yml | push [main] (2 path filters) | event ref | maintenance/manual |
| charm-media3-surface-handoff-fix.yml | push [main] (3 path filters) | event ref | maintenance/manual |
| charm-one-shot-fix-build-v2.yml | push [main] (1 path filters) | main; claude/repo-branch-access-dxx6wf | repository mutation, APK/build, FFmpeg, Cloudflare/metadata, validation |
| charm-one-shot-fix-build-v3.yml | push [main] (1 path filters) | main; claude/repo-branch-access-dxx6wf | repository mutation, APK/build, FFmpeg, Cloudflare/metadata, validation |
| charm-one-shot-fix-build.yml | push [main] (1 path filters) | main; claude/repo-branch-access-dxx6wf | repository mutation, APK/build, FFmpeg, Cloudflare/metadata, validation |
| charm-refresh-auth-hotfix.yml | push [main] (1 path filters) | main | repository mutation, Cloudflare/metadata |
| charm-refresh.yml | schedule; workflow_dispatch; push [main] (2 path filters) | event ref | Cloudflare/metadata |
| charm-verify-cloudflare.yml | push [main] (1 path filters) | main | repository mutation, validation |
| code-interaction-audit-final-sideload.yml | push [agent/code-interaction-audit] (1 path filters); pull_request [agent/code-interaction-audit] (1 path filters) | agent/code-interaction-audit | APK/build, FFmpeg, validation |
| code-interaction-audit-guide-handoff.yml | push [agent/code-interaction-audit] (1 path filters); pull_request [agent/code-interaction-audit] (1 path filters) | agent/code-interaction-audit | repository mutation, validation |
| code-interaction-audit-lifecycle-scan.yml | push [agent/code-interaction-audit] (1 path filters) | agent/code-interaction-audit | repository mutation |
| code-interaction-audit-native-compile.yml | push [agent/code-interaction-audit] (1 path filters); pull_request [agent/code-interaction-audit] (1 path filters) | agent/code-interaction-audit | repository mutation, native compile |
| code-interaction-audit-phase9-integration-v2.yml | pull_request [agent/code-interaction-audit] (1 path filters) | agent/code-interaction-audit | repository mutation, validation |
| code-interaction-audit-phase9-integration.yml | push [agent/code-interaction-audit] (1 path filters); pull_request [agent/code-interaction-audit] (1 path filters) | agent/code-interaction-audit | repository mutation, validation |
| code-interaction-audit-player-freeze-convergence.yml | pull_request [agent/code-interaction-audit] (1 path filters) | agent/code-interaction-audit | repository mutation, validation |
| code-interaction-audit-player-freeze.yml | push [agent/code-interaction-audit] (1 path filters); pull_request [agent/code-interaction-audit] (1 path filters) | agent/code-interaction-audit | repository mutation, validation |
| code-interaction-audit-player-stability.yml | push [agent/code-interaction-audit] (1 path filters); pull_request [agent/code-interaction-audit] (1 path filters) | agent/code-interaction-audit | repository mutation |
| code-interaction-audit-quarantine.yml | push [agent/code-interaction-audit] (1 path filters) | agent/code-interaction-audit | repository mutation |
| code-interaction-audit-sideload.yml | push [agent/code-interaction-audit] (1 path filters) | agent/code-interaction-audit | repository mutation, APK/build, FFmpeg, validation |
| code-interaction-audit-surface-ownership.yml | pull_request [agent/code-interaction-audit] (1 path filters) | agent/code-interaction-audit | maintenance/manual |
| code-interaction-audit-ui-lifecycle.yml | push [agent/code-interaction-audit] (1 path filters) | agent/code-interaction-audit | repository mutation |
| code-interaction-audit-validation.yml | push [agent/code-interaction-audit] (1 path filters); pull_request [agent/code-interaction-audit] (1 path filters) | agent/code-interaction-audit | repository mutation, APK/build, FFmpeg, validation |
| code-interaction-audit-vlc-watchdog.yml | push [agent/code-interaction-audit] (1 path filters) | agent/code-interaction-audit | repository mutation |
| deploy-cloudflare-worker.yml | push [main] (3 path filters); workflow_dispatch | event ref | Cloudflare/metadata |
| experimental-v3-apk.yml | workflow_dispatch | event ref | APK/build, FFmpeg, validation |
| finalize-build8-rescan2.yml | push [fix/purple-next-build8-tester-pass] (1 path filters) | fix/purple-next-build8-tester-pass | repository mutation |
| frontend-ci.yml | pull_request [main]; push [main]; workflow_dispatch | event ref | validation |
| manual-vlc-final-validation.yml | push [agent/manual-vlc-engine] (3 path filters); workflow_dispatch | event ref | repository mutation, native compile, validation |
| manual-vlc-native-final.yml | push [agent/manual-vlc-engine] (3 path filters); workflow_dispatch | ${{ github.sha }} | repository mutation, native compile, validation |
| media3-player-core-validation.yml | push [agent/media3-player-core-rebuild]; pull_request [agent/tivimate-deep-player-quickactions-repair] (2 path filters); workflow_dispatch | event ref | APK/build, FFmpeg, validation — sideload: ${{ github.event_name == 'push' &#124;&#124; github.event_name == 'pull_request' &#124;&#124; (github.event_name == 'workflow_dispatch' && inputs.build_sideload) }} |
| media3-working-validation-only.yml | push [agent/media3-opaque-live-startup-hardening]; workflow_dispatch | event ref | native compile, validation |
| native-guide-ram-apk.yml | push [experiment/full-ram-epg-engine, agent/phase9-tivimate-scan-repair]; workflow_dispatch | event ref | APK/build, FFmpeg, validation |
| phase9-cap-native-epg-window.yml | push [agent/phase9-tivimate-scan-repair] (1 path filters); workflow_dispatch | agent/phase9-tivimate-scan-repair | repository mutation |
| phase9-channel-settings-paging-order.yml | push [phase9/purple-next] (2 path filters) | phase9/purple-next | repository mutation |
| phase9-channels-focus-favorite.yml | push [phase9/purple-next] (1 path filters) | phase9/purple-next | repository mutation |
| phase9-collections-live-epg-focus.yml | push [phase9/purple-next] (3 path filters) | phase9/purple-next | repository mutation |
| phase9-custom-epg-directory.yml | push [phase9/purple-next] (1 path filters) | phase9/purple-next | repository mutation |
| phase9-custom-epg-focus-ownership.yml | push [phase9/purple-next] (3 path filters) | phase9/purple-next | repository mutation |
| phase9-custom-epg-idle-refresh.yml | push [phase9/purple-next] (1 path filters) | phase9/purple-next | repository mutation |
| phase9-custom-epg-native.yml | push [phase9/purple-next] (1 path filters) | phase9/purple-next | repository mutation |
| phase9-custom-epg-page-clamp.yml | push [phase9/purple-next] (1 path filters) | phase9/purple-next | repository mutation |
| phase9-custom-epg-refresh-focus.yml | push [phase9/purple-next] (3 path filters) | phase9/purple-next | repository mutation |
| phase9-custom-epg-ui-integration.yml | push [phase9/purple-next] (1 path filters) | phase9/purple-next | repository mutation |
| phase9-custom-group-reference-migration.yml | push [phase9/purple-next] (1 path filters) | phase9/purple-next | repository mutation |
| phase9-deep-player-validation.yml | push [agent/tivimate-deep-player-quickactions-repair] (1 path filters); workflow_dispatch | agent/tivimate-deep-player-quickactions-repair | native compile, FFmpeg, validation |
| phase9-drawer-force-transition.yml | push [phase9/purple-next] (1 path filters) | phase9/purple-next | repository mutation |
| phase9-epg-fallback-ownership.yml | push [phase9/purple-next] (3 path filters) | phase9/purple-next | repository mutation |
| phase9-epg-match-ownership.yml | push [phase9/purple-next] (1 path filters) | phase9/purple-next | repository mutation |
| phase9-epg-memory-bridge.yml | push [phase9/purple-next] (1 path filters) | phase9/purple-next | repository mutation |
| phase9-epg-ownership-cache.yml | push [phase9/purple-next] (1 path filters) | phase9/purple-next | repository mutation |
| phase9-epg-refresh-ownership.yml | push [phase9/purple-next] (1 path filters) | phase9/purple-next | repository mutation |
| phase9-epg-search-ownership.yml | push [phase9/purple-next] (3 path filters) | phase9/purple-next | repository mutation |
| phase9-epg-settings-ownership-focus.yml | push [phase9/purple-next] (1 path filters) | phase9/purple-next | repository mutation |
| phase9-epg-single-binding.yml | push [phase9/purple-next] (1 path filters) | phase9/purple-next | repository mutation |
| phase9-epg-start-custom-groups.yml | push [phase9/purple-next] (1 path filters) | phase9/purple-next | repository mutation |
| phase9-epg-transactional-state.yml | push [phase9/purple-next] (2 path filters) | phase9/purple-next | repository mutation |
| phase9-favorites-live-remote.yml | push [phase9/purple-next] (1 path filters) | phase9/purple-next | repository mutation |
| phase9-favorites-ownership-focus.yml | push [phase9/purple-next] (3 path filters) | phase9/purple-next | repository mutation |
| phase9-final-sideload.yml | push [agent/tivimate-deep-player-quickactions-repair] (1 path filters); workflow_dispatch | agent/tivimate-deep-player-quickactions-repair | APK/build, FFmpeg, validation |
| phase9-fix-6pct-playlist-acquisition.yml | push [agent/phase9-tivimate-scan-repair] (1 path filters); workflow_dispatch | agent/phase9-tivimate-scan-repair | repository mutation |
| phase9-focus-retry-root-fix.yml | push [phase9/purple-next] (2 path filters) | phase9/purple-next | repository mutation |
| phase9-group-settings-integration.yml | push [phase9/purple-next] (1 path filters) | phase9/purple-next | repository mutation |
| phase9-guide-explicit-jump-filter.yml | push [phase9/purple-next] (1 path filters) | phase9/purple-next | repository mutation |
| phase9-guide-groups-hide.yml | push [phase9/purple-next] (1 path filters) | phase9/purple-next | repository mutation |
| phase9-guide-jump-cache-priority.yml | push [phase9/purple-next] (1 path filters) | phase9/purple-next | repository mutation |
| phase9-guide-order-all-groups.yml | push [phase9/purple-next] (2 path filters) | phase9/purple-next | repository mutation |
| phase9-home-epg-ownership-focus.yml | push [phase9/purple-next] (3 path filters) | phase9/purple-next | repository mutation |
| phase9-left-edge-focus-target.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-live-tv-repair-pr.yml | workflow_dispatch | agent/phase9-tivimate-scan-repair | repository mutation, validation — patch: github.head_ref == 'agent/phase9-tivimate-scan-repair' |
| phase9-live-tv-repair-v2.yml | workflow_dispatch | agent/phase9-tivimate-scan-repair | repository mutation, validation — repair: github.event.pull_request.head.ref == 'agent/phase9-tivimate-scan-repair' |
| phase9-live-tv-repair-v3.yml | pull_request [main] (2 path filters) | agent/phase9-tivimate-scan-repair | repository mutation, validation — repair: github.event.pull_request.head.ref == 'agent/phase9-tivimate-scan-repair' |
| phase9-live-tv-repair-v4.yml | pull_request [main] (2 path filters) | agent/phase9-tivimate-scan-repair | repository mutation, validation — repair: github.event.pull_request.head.ref == 'agent/phase9-tivimate-scan-repair' |
| phase9-lowram-cache-cap.yml | push [phase9/purple-next] (1 path filters) | phase9/purple-next | repository mutation |
| phase9-media3-guide-live-repair.yml | pull_request [main] (1 path filters) | agent/phase9-tivimate-scan-repair | repository mutation, validation |
| phase9-media3-guide-liveclock-repair.yml | pull_request [main] (2 path filters) | agent/phase9-tivimate-scan-repair | repository mutation, validation — repair: github.event.pull_request.head.ref == 'agent/phase9-tivimate-scan-repair' |
| phase9-player-buffering-resync.yml | push [phase9/purple-next] (1 path filters) | phase9/purple-next | repository mutation |
| phase9-player-fullstack-audit-repair.yml | pull_request [main] (2 path filters) | agent/phase9-tivimate-scan-repair | repository mutation, validation — repair: github.event.pull_request.head.ref == 'agent/phase9-tivimate-scan-repair' |
| phase9-player-guide-anchor.yml | push [phase9/purple-next] (1 path filters) | phase9/purple-next | repository mutation |
| phase9-player-local-recovery.yml | push [phase9/purple-next] (1 path filters) | phase9/purple-next | repository mutation |
| phase9-player-rc1-baseline-repair.yml | pull_request [main] (2 path filters) | agent/phase9-tivimate-scan-repair | repository mutation, validation — repair: github.event.pull_request.head.ref == 'agent/phase9-tivimate-scan-repair' |
| phase9-player-remote-foundation.yml | push [phase9/purple-next] (1 path filters) | phase9/purple-next | repository mutation |
| phase9-provider-group-memory.yml | push [phase9/purple-next] (2 path filters) | phase9/purple-next | repository mutation |
| phase9-remote-drawer-integration.yml | push [phase9/purple-next] (1 path filters) | phase9/purple-next | repository mutation |
| phase9-search-final-ownership.yml | push [phase9/purple-next] (2 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-search-remote-guide.yml | push [phase9/purple-next] (1 path filters) | phase9/purple-next | repository mutation |
| phase9-settings-focus-lifecycle.yml | push [phase9/purple-next] (3 path filters) | phase9/purple-next | repository mutation |
| phase9-tivimate-coldstart-counts.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-coldstart-source-separation.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-custom-epg-assignment-deferral.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-custom-epg-refresh-result.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-custom-epg-success-clock.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-custom-epg-zero-binding-retention.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-custom-group-snapshot-memory.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-custom-order-index.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-custom-order-move.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-custom-order-snapshot.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-db-open-policy.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-drawer-edge-remote-context.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-drawer-edge.yml | push [phase9/purple-next] (1 path filters) | phase9/purple-next | repository mutation |
| phase9-tivimate-drawer-route-handoff.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-epg-alias-index.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-epg-refresh-coalescing.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-focus-bootstrap-final.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-guide-active-transition-focus.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-guide-bottom-boundary-noop.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-guide-horizontal-cache-miss.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-guide-inactive-query-silence.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-guide-navigation-state-reset.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-guide-no-info-cells.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-guide-preview-logo.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-guide-query-settle.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-guide-reload-generation.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-guide-runway-debounce.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-guide-settle-ownership.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-guide-test-sync.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-live-preview-list-focus.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-management-focus.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-native-coldstart-switch.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-native-logo-sources.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-native-playlist-read.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-player-network.yml | push [phase9/purple-next] (1 path filters) | phase9/purple-next | repository mutation |
| phase9-tivimate-player-patch-cleanup.yml | push [phase9/purple-next] (1 path filters) | phase9/purple-next | repository mutation |
| phase9-tivimate-player-stalled-ready.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-playlist-fields-v9.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-playlist-incremental.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-playlist-provider-fingerprint.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-playlist-refresh-clock.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-playlist-schema-v8.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-preview-to-guide-focus-return.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-remove-destructive-playlist-api.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-retro-drawer.yml | push [phase9/purple-next] (1 path filters) | phase9/purple-next | repository mutation |
| phase9-tivimate-scheduler-boot-gate.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-scheduler-startup-deferral.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-settings-focus-handoff.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-source-aware-epg-freshness.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-source-clock-zero.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-startup-refresh-deferral.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-tivimate-user-focus-wins.yml | push [phase9/purple-next] (1 path filters); workflow_dispatch | phase9/purple-next | repository mutation |
| phase9-validation.yml | push [phase9/purple-next] (3 path filters) | event ref | native compile, validation |
| purple-next-ci.yml | push [next/purple-production] (3 path filters); workflow_dispatch | event ref | APK/build, FFmpeg, validation |
| purple-tv-ui.yml | push [main, experimental/purple-tv-ui] (2 path filters); workflow_dispatch | event ref | APK/build, FFmpeg, validation |
| ram-epg-test.yml | push [experiment/full-ram-epg-engine]; pull_request [main] | event ref | APK/build, FFmpeg, validation |
| tivimate-overhaul-validation.yml | push [agent/tivimate-architecture-overhaul] | event ref | native compile, FFmpeg, validation |
