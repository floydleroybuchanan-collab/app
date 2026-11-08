import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const src=name=>readFileSync(resolve(root,name),"utf8");

test("a playback history event does not eject the active native VOD player to Live TV",()=>{
  const page=src("src/components/MediaLabVodContent.tsx");
  const history=page.indexOf('nativeEvent.value === "medialab:library-updated"');
  const home=page.indexOf('nativeEvent.value === "/"');
  assert.ok(history>=0 && home>history);
  assert.match(page.slice(history,home), /captureShelf\(\);\s*return;/);
  assert.match(page,/Unknown native events must never destroy the active player/);
});
test("native-only VOD toolbar has at most two rows and never truncates button labels",()=>{
  const page=src("src/components/MediaLabVodContent.tsx");
  assert.match(page,/Math\.ceil\(actions\.length \/ 2\)/);
  assert.match(page,/\[actions\.slice\(0, columns\), actions\.slice\(columns\)\]/);
  assert.match(page,/numberOfLines=\{2\} adjustsFontSizeToFit/);
  assert.doesNotMatch(page, /"Streamflix"/);
  assert.doesNotMatch(page, /"provider-xtream", "Xtream"|"provider-stalker", "Stalker"/);
  assert.match(src("src/core/vodFeatureFlags.ts"),/PLAYLIST_VOD_ENABLED = false/);
});
test("VOD settings are full-page and scroll directly without an inner clipped frame",()=>{
  const s=src("android/vod/app/src/main/java/com/streamflixreborn/streamflix/fragments/settings/CharmSettingsLayout.kt");
  assert.match(s,/val root = LinearLayout\(context\)/);
  assert.doesNotMatch(s,/val root = NestedScrollView/);
  assert.match(s,/list\.isNestedScrollingEnabled = true/);
  assert.match(s,/content\.addView\(row, LinearLayout.LayoutParams\(-1, 0, 1f\)\)/);
  assert.match(s,/row\.addView\(list, LinearLayout.LayoutParams\(0, -1, 1f\)\)/);
  assert.match(s,/val leftInset = dp\(if \(embedded\) 76 else 24\)/);
});
test("movie and series My List is to the right of Trailer on the Watch action line",()=>{
  for(const kind of ["movie","tv_show"]){
    const xml=src(`android/vod/app/src/main/res/layout/content_${kind}_tv.xml`);
    const marker='android:id="@+id/charm_detail_my_list"';
    const list=xml.slice(xml.indexOf(marker),xml.indexOf("/>",xml.indexOf(marker))+2);
    const trailerMarker=`android:id="@+id/btn_${kind}_trailer"`;
    const trailer=xml.slice(xml.indexOf(trailerMarker),xml.indexOf("/>",xml.indexOf(trailerMarker))+2);
    assert.match(list,new RegExp('app:layout_constraintStart_toEndOf="@id/btn_'+kind+'_trailer"'));
    assert.match(list,new RegExp('app:layout_constraintTop_toTopOf="@id/btn_'+kind+'_watch_now"'));
    assert.match(trailer,/app:layout_constraintStart_toEndOf="@id\/charm_detail_sources"/);
  }
});
