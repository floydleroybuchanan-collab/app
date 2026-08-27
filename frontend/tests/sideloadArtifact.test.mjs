import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { decryptArtifact, encryptArtifact } from "../../ci/protect-sideload-artifact.mjs";

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "charm-artifact-test-"));
  t.after(async () => {
    for (const file of await readdir(dir)) await rm(join(dir, file));
    await rmdir(dir);
  });
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
  const paths = Object.fromEntries(["public", "private", "input", "encrypted", "decrypted"].map(name => [name, join(dir, name)]));
  await writeFile(paths.public, keys.publicKey);
  await writeFile(paths.private, keys.privateKey, { mode: 0o600 });
  const bytes = randomBytes(256 * 1024);
  await writeFile(paths.input, bytes);
  await encryptArtifact(paths.public, paths.input, paths.encrypted);
  return { ...paths, bytes, dir };
}

test("encrypted sideload artifacts round-trip without exposing plaintext", async t => {
  const f = await fixture(t);
  assert.notDeepEqual(await readFile(f.encrypted), f.bytes);
  await decryptArtifact(f.private, f.encrypted, f.decrypted);
  assert.deepEqual(await readFile(f.decrypted), f.bytes);
  await assert.rejects(decryptArtifact(f.private, f.encrypted, f.decrypted), { code: "EEXIST" });
});

test("tampered artifact ciphertext never produces a decrypted output", async t => {
  const f = await fixture(t);
  const data = await readFile(f.encrypted);
  data[100] ^= 1;
  await writeFile(f.encrypted, data);
  await assert.rejects(decryptArtifact(f.private, f.encrypted, f.decrypted));
  await assert.rejects(readFile(f.decrypted), { code: "ENOENT" });
  assert.equal((await readdir(f.dir)).some(name => name.includes(".partial-")), false);
});

test("tampered artifact metadata is authenticated", async t => {
  const f = await fixture(t);
  const metadata = JSON.parse(await readFile(f.encrypted + ".json", "utf8"));
  metadata.iv = randomBytes(12).toString("base64");
  await writeFile(f.encrypted + ".json", JSON.stringify(metadata));
  await assert.rejects(decryptArtifact(f.private, f.encrypted, f.decrypted));
  await assert.rejects(readFile(f.decrypted), { code: "ENOENT" });
});
