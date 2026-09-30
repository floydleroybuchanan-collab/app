import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read=(path)=>readFile(new URL(path,import.meta.url),"utf8");
test("donation entry points cover sign-in, Live TV, and adaptive native VOD",async()=>{
  const [login,live,mobileVod,tvVod,host]=await Promise.all([
    read("../src/components/AccountGate.tsx"),read("../app/(tabs)/index.tsx"),
    read("../android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/CharmMobileChrome.kt"),
    read("../android/vod/app/src/main/java/com/streamflixreborn/streamflix/charm/CharmPageDrawer.kt"),
    read("../app/(tabs)/vod.tsx")]);
  assert.match(login,/<DonationButton/);assert.match(live,/headerRight={<DonationButton compact/);
  assert.match(mobileVod,/button\("Donate"\)/);assert.match(tvVod,/text = "₿ Donate"/);
  assert.match(host,/route === "medialab:donate"/);
});
test("donation UI uses only the public address and makes no payment-success claim",async()=>{
  const dialog=await read("../src/components/DonationDialog.tsx");
  assert.match(dialog,/does not claim payment was received/);
  assert.match(dialog,/DONATION_LIGHTNING_ADDRESS/);
});
