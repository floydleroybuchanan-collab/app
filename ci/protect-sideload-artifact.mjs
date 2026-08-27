#!/usr/bin/env node
// Public Actions artifacts must not expose provider URLs embedded in the APK.
import { constants, createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, privateDecrypt, publicEncrypt, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, readFile, rm, writeFile } from "node:fs/promises";
import { constants as fileConstants } from "node:fs";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";

function recipientId(key) {
  return createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex");
}

export async function encryptArtifact(publicKeyPath, input, output) {
  const publicKey = createPublicKey(await readFile(publicKeyPath));
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const metadata = {
    version: 1,
    algorithm: "AES-256-GCM",
    keyAlgorithm: "RSA-OAEP-SHA256",
    recipient: recipientId(publicKey),
    wrappedKey: publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, key).toString("base64"),
    iv: iv.toString("base64"),
  };
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(JSON.stringify(metadata)));
  await pipeline(createReadStream(input), cipher, createWriteStream(output, { flags: "wx", mode: 0o600 }));
  await writeFile(output + ".json", JSON.stringify({ ...metadata, tag: cipher.getAuthTag().toString("base64") }, null, 2) + "\n", { flag: "wx" });
}

export async function decryptArtifact(privateKeyPath, input, output) {
  const { tag, ...metadata } = JSON.parse(await readFile(input + ".json", "utf8"));
  if (metadata.version !== 1 || metadata.algorithm !== "AES-256-GCM" || metadata.keyAlgorithm !== "RSA-OAEP-SHA256") throw new Error("Unsupported artifact envelope");
  const privateKey = createPrivateKey(await readFile(privateKeyPath));
  if (recipientId(createPublicKey(privateKey)) !== metadata.recipient) throw new Error("Artifact is encrypted for another key");
  const key = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(metadata.wrappedKey, "base64"));
  const iv = Buffer.from(metadata.iv, "base64");
  const authTag = Buffer.from(tag, "base64");
  if (key.length !== 32 || iv.length !== 12 || authTag.length !== 16) throw new Error("Invalid artifact envelope");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(JSON.stringify(metadata)));
  decipher.setAuthTag(authTag);
  const temporary = output + ".partial-" + randomBytes(8).toString("hex");
  try {
    await pipeline(createReadStream(input), decipher, createWriteStream(temporary, { flags: "wx", mode: 0o600 }));
    // Publish only after authentication succeeds, and never overwrite a file.
    await copyFile(temporary, output, fileConstants.COPYFILE_EXCL);
  } finally {
    await rm(temporary, { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [operation, key, input, output] = process.argv.slice(2);
  if (!key || !input || !output || !["encrypt", "decrypt"].includes(operation)) {
    throw new Error("Usage: node ci/protect-sideload-artifact.mjs encrypt|decrypt key.pem input output");
  }
  await (operation === "encrypt" ? encryptArtifact : decryptArtifact)(key, input, output);
  console.log(`Artifact ${operation} completed`);
}
