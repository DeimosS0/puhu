// The README's pictures live on their own branch, `media`: one commit, rebuilt from
// docs/media (not tracked on the code branches) each time, so a GIF that is replaced never
// stays in the history. The README shows them by their raw.githubusercontent.com address.
// Builds the branch locally; publishing it is a separate, forced push of `media`.
//   node scripts/readme-media.mjs

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "docs/media";
const git = (args, input) => execFileSync("git", args, { input, encoding: "utf8" }).trim();

const files = readdirSync(DIR).filter((f) => !f.startsWith(".")).sort();
const tree = git(["mktree"], files.map((f) => `100644 blob ${git(["hash-object", "-w", join(DIR, f)])}\t${f}`).join("\n") + "\n");
const commit = git(["commit-tree", tree, "-m", "README media"]);
git(["update-ref", "refs/heads/media", commit]);

// Every picture the README asks for has to be on the branch.
const wanted = [...readFileSync("README.md", "utf8").matchAll(/puhu\/media\/([\w.-]+)/g)].map((m) => m[1]);
const missing = wanted.filter((f) => !files.includes(f));
console.log(`media ${commit.slice(0, 7)}: ${files.length} files`);
if (missing.length) {
  console.error(`missing for the README: ${missing.join(", ")}`);
  process.exit(1);
}
