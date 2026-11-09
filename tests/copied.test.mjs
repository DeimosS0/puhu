// What was copied, as the island's peek reads it (src/core/copied.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { looksLikeError, looksSecret, readCopied } from "../src/core/copied.ts";

test("a link shows its site, a colour its swatch, an address itself", () => {
  assert.deepEqual(readCopied("https://www.youtube.com/watch?v=x"), { kind: "link", label: "youtube.com/…" });
  assert.deepEqual(readCopied("https://github.com"), { kind: "link", label: "github.com" });
  // The site only: a webhook's path is its secret.
  assert.equal(readCopied("https://hooks.slack.com/services/T000/B000/XXXXXXXX").label, "hooks.slack.com/…");
  assert.deepEqual(readCopied("  #FF7A59 "), { kind: "color", label: "#FF7A59", color: "#FF7A59" });
  assert.equal(readCopied("rgb(12, 34, 56)").kind, "color");
  assert.equal(readCopied("hsl(210deg 40% 50% / 0.5)").kind, "color");
  // A colour's parentheses can't carry other style into the swatch.
  assert.notEqual(readCopied("rgb(;position:fixed;inset:0;background:red;x:)").kind, "color");
  assert.notEqual(readCopied("rgb(1,2,3);color:red").kind, "color");
  assert.deepEqual(readCopied("ada@example.com"), { kind: "email", label: "ada@example.com" });
});

test("several lines show the first and how many more; a sentence stays a sentence", () => {
  assert.deepEqual(readCopied("def f(x):\n    return x\n\nprint(f(2))"), { kind: "multiline", label: "def f(x):  +2", count: 3 });
  // How long it is, for the peek that does not show the text: characters as people count them.
  assert.deepEqual(readCopied("Merhaba   dünya,\nnasılsın?"), { kind: "text", label: "Merhaba dünya, nasılsın?", count: 26 });
});

test("passwords and keys are never shown, alone or inside other text", () => {
  const secrets = [
    "aX9#kL2$mP7q",
    "Hunter2!x",
    "sk-proj-abc123",
    "ghp_16C7e42F292c6912E7710c838347Ae178B4a",
    "eyJhbGciOiJIUzI1NiJ9",
    "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  ];
  for (const secret of secrets) {
    assert.ok(looksSecret(secret), secret);
    assert.deepEqual(readCopied(secret), { kind: "secret", label: "••••••••" });
  }
  const inside = ["API_KEY=sk-proj-abc123\nDEBUG=true", "password: Hunter2!x", "the token is ghp_16C7e42F292c6912E7710c838347Ae178B4a ok"];
  for (const text of inside) assert.equal(readCopied(text).kind, "secret", text);
  const plain = ["user_profile_2024", "getUserProfileById", "print(f(2))", String.raw`C:\Users\me\file.txt`, "/home/me/notes.md", "Merhaba dünya", "123456", "2026-11-05"];
  for (const text of plain) assert.ok(!looksSecret(text), text);
});

test("an error says what went wrong, and the same words in code are not one", () => {
  const errors = [
    "TypeError: Cannot read properties of undefined (reading 'map')\n    at App (App.tsx:12:5)",
    "error[E0308]: mismatched types\n --> src/main.rs:4:9",
    "src/a.c:3:5: error: expected ';' before '}' token",
    "npm ERR! code ENOENT",
    "fatal: not a git repository (or any of the parent directories): .git",
    'Exception in thread "main" java.lang.NullPointerException',
    "thread 'main' panicked at src/main.rs:2:5:",
    "System.NullReferenceException: Object reference not set to an instance of an object.",
    "'foo' is not recognized as an internal or external command,",
    "bash: foo: command not found",
  ];
  for (const text of errors) assert.ok(looksLikeError(text), text);
  const code = ["except ValueError:\n    pass", 'throw new Error("x")', "const e: Error = x", "class ParseError extends Error {}", "An error occurred while we talked", "Error handling: see the docs"];
  for (const text of code) assert.ok(!looksLikeError(text), text);
  // The peek shows the line with the message, not the traceback's first line.
  assert.deepEqual(
    readCopied('Traceback (most recent call last):\n  File "a.py", line 3, in <module>\nValueError: invalid literal for int()'),
    { kind: "error", label: "ValueError: invalid literal for int()", count: 3 },
  );
  // A key in it still hides it all.
  assert.equal(readCopied("Error: invalid key sk-proj-abc123def").kind, "secret");
});
