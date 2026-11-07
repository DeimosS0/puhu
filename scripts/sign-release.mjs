// Signs a release's installer for Puhu's updater (src-tauri/src/update.rs, SIGNING_KEY):
// an Ed25519 signature over "puhu-update\n<file name>\n<sha-256 hex>", written next to
// it as <file>.sig, to upload with it. The private key never goes in this repository and
// is kept encrypted: its passphrase is asked for (not shown as it is typed), or read from
// PUHU_SIGNING_PASSPHRASE.
//   node scripts/sign-release.mjs release/Puhu-Windows-0.6.0-setup.exe <private-key.pem>

import { createHash, createPrivateKey, sign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { createInterface } from "node:readline";

const [file, keyPath] = process.argv.slice(2);
if (!file || !keyPath) {
  console.error("usage: node scripts/sign-release.mjs <installer> <private-key.pem>");
  process.exit(1);
}

/** The passphrase, typed without echo. */
function ask(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    process.stdout.write(question);
    rl._writeToOutput = () => {};
    rl.question("", (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

const passphrase = process.env.PUHU_SIGNING_PASSPHRASE ?? (await ask("Passphrase of the signing key: "));
let key;
try {
  key = createPrivateKey({ key: readFileSync(keyPath), passphrase });
} catch {
  console.error("The key could not be opened: wrong passphrase, or not the signing key.");
  process.exit(1);
}
const sha = createHash("sha256").update(readFileSync(file)).digest("hex");
const signature = sign(null, Buffer.from(`puhu-update\n${basename(file)}\n${sha}`), key);
writeFileSync(`${file}.sig`, `${signature.toString("hex")}\n`);
console.log(`${basename(file)}.sig  sha256 ${sha}`);
