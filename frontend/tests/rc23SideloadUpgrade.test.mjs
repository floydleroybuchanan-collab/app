import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const read=p=>readFileSync(resolve(root,p),"utf8");

test("RC23 sideload has matching native and Expo versions, newer than previous RC22 candidates",()=>{
 const gradle=read("android/app/build.gradle");
 const app=JSON.parse(read("app.json")).expo;
 const version=Number(gradle.match(/versionCode\s+(\d+)/)?.[1]);
 const versionName=gradle.match(/versionName\s+["']([^"']+)["']/)?.[1];
 const packageId=gradle.match(/applicationId\s+['"]([^'"]+)['"]/)?.[1];
 assert.equal(version,2300);
 assert.ok(version>42);
 assert.equal(app.android.versionCode,version);
 assert.equal(versionName,"2.2.0-rc.23");
 assert.equal(app.version,versionName);
 assert.equal(app.android.package,packageId);
 assert.match(gradle,/applicationIdSuffix '\.sideload'/);
});
test("signed RC23 artifact preserves owner-supplied encryption recipient",()=>{
 const workflow=read("../.github/workflows/build-media3-sideload-now.yml");
 const pem=read("../ci/sideload-artifact-public.pem");
 assert.match(workflow,/Charming\.MediaLab-2\.2\.0-RC23-Sideload-\$\{GITHUB_RUN_NUMBER\}\.apk/);
 assert.match(workflow,/protect-sideload-artifact\.mjs encrypt \.\.\/ci\/sideload-artifact-public\.pem/);
 assert.match(pem,/-----BEGIN PUBLIC KEY-----/);
 assert.match(pem,/MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAyC9n4e9tqbE3Tn9AgICb/);
});
