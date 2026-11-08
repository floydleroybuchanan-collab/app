import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const src=p=>readFileSync(resolve(root,p),"utf8");

test("D-pad Up can leave a movie or series detail to the VOD toolbar without entering the icon rail",()=>{
 const native=src("android/app/src/main/java/com/charmiptv/app/CharmVodSurface.kt");
 const shell=src("src/components/PurpleTvShell.tsx");
 assert.match(native,/if \(destination == VodR\.id\.player\) return false/);
 assert.match(native,/if \(destination == VodR\.id\.movie \|\| destination == VodR\.id\.tv_show\)/);
 assert.match(native,/target\.requestFocus\(View\.FOCUS_UP\)/);
 assert.match(shell,/trapFocusUp=\{!drawerOpen && !secondaryDrawer && active !== "\/guide" && active !== "\/vod"\}/);
});
test("VOD Back never changes to an unmapped section or exits the app",()=>{
 const page=src("src/components/MediaLabVodContent.tsx");
 const start=page.indexOf('const back = useCallback(');
 const end=page.indexOf('useEffect(() => {',start);
 const code=page.slice(start,end);
 assert.match(code,/backInFlight\.current/);
 assert.match(code,/NativeModules\.CharmVod\?\.surfaceBack\?\.\(\)/);
 assert.doesNotMatch(code,/setSection\("all"\)/);
 assert.match(code,/vodHome\(\)/);
 const shell=src("src/components/PurpleTvShell.tsx");
 assert.match(shell,/if \(active === "\/vod" && !drawerOpen\) \{/);
 assert.match(shell,/NativeModules\.CharmVod\?\.surfaceBack\?\.\(\)/);
});
test("VOD Home resets the native backstack even when React already displays the home section",()=>{
 const page=src("src/components/MediaLabVodContent.tsx");
 const module=src("android/app/src/main/java/com/charmiptv/app/CharmVodPackage.kt");
 assert.match(page,/if \(value === "home"\) \{ vodHome\(\); return; \}/);
 assert.match(page,/NativeModules\.CharmVod\?\.surfaceHome\?\.\(\)/);
 assert.match(module,/fun surfaceHome\(promise: Promise\)/);
 assert.match(module,/CharmNavigation\.home\(activity\)/);
});
test("leaving fullscreen player restores host orientation and UI without unmounting VOD",()=>{
 const surface=src("android/app/src/main/java/com/charmiptv/app/CharmVodSurface.kt");
 assert.match(surface,/lastDestinationWasPlayer && !nowPlayer/);
 assert.match(surface,/SCREEN_ORIENTATION_UNSPECIFIED/);
 assert.match(surface,/WindowInsetsCompat\.Type\.systemBars\(\)/);
 const module=src("android/app/src/main/java/com/charmiptv/app/CharmVodPackage.kt");
 assert.match(module,/player\?\.pause\(\)/);
 assert.match(module,/if \(!nav\.popBackStack\(\)\)/);
});
