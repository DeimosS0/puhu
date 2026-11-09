// What was copied, read for the island's peek: a link shows its site, a colour its
// swatch, an e-mail address itself, several lines their first and how many more, and
// text with anything in it that looks like a password or a key (an .env line, a token
// in a sentence) is never shown, only dots. The island is on screen, shared screens
// included: when in doubt it hides. Pure; the island draws it (Island.showCopied).

export type CopiedKind = "link" | "color" | "email" | "error" | "multiline" | "secret" | "text";

export interface CopiedPeek {
  kind: CopiedKind;
  /** The line the island shows. */
  label: string;
  /** A colour that was copied, for its swatch. */
  color?: string;
  /** How long it is: characters of a text, lines of several (the line itself may stay hidden). */
  count?: number;
}

/** The shape of a key some service hands out, whatever comes after it. */
const KEY_PREFIX = /^(sk-|sk_live_|pk_live_|ghp_|gho_|ghs_|github_pat_|xox[abpr]-|AKIA|AIza|eyJ)/;

/**
 * One token that is a password or a key: a known key's start; or 8+ characters with
 * capitals, small letters and digits that keep switching kind (a password, not code
 * like print(f(2)) or an identifier like user_profile_2024); or 32+ characters of a
 * key's alphabet with letters and digits. A link or a path is not one. When unsure it
 * says yes: hiding a word costs less than showing a password.
 */
export function looksSecret(token: string): boolean {
  const t = token.trim();
  if (/\s/.test(t) || t.length < 8 || t.length > 512) return false;
  if (KEY_PREFIX.test(t)) return true;
  if (/^(?:[a-z]+:\/\/|\.{0,2}\/)/i.test(t) || t.includes("\\")) return false;
  const kind = (c: string) => (/[a-z]/.test(c) ? 0 : /[A-Z]/.test(c) ? 1 : /\d/.test(c) ? 2 : 3);
  let switches = 0;
  for (let i = 1; i < t.length; i++) if (kind(t[i]) !== kind(t[i - 1])) switches++;
  if (/[a-z]/.test(t) && /[A-Z]/.test(t) && /\d/.test(t) && switches / t.length >= 0.3) return true;
  return t.length >= 32 && /^[A-Za-z0-9+/=_-]+$/.test(t) && /\d/.test(t) && /[A-Za-z]/.test(t) && switches / t.length >= 0.2;
}

/**
 * What an error message or a stack trace looks like, from the tools people copy them
 * from: Python, JavaScript, Java and .NET exceptions, compilers, npm, git, shells. A
 * name with a colon and a message after it ("TypeError: x is not a function"), not the
 * same name in code (`except ValueError:`, `new Error("x")`).
 */
const ERROR_MESSAGES = [
  /\b(?:[A-Z]\w*)?(?:Error|Exception)\b(?::[ \t]+\S| in thread)/,
  /^\s*(?:Fatal error|Uncaught \w+):[ \t]+\S/m,
  /(?:^|:\d+(?::\d+)?:[ \t]*)(?:error|fatal error)(?:\[[A-Z]?\d+\])?:[ \t]+\S/im,
];
const ERROR_SIGNS = [
  ...ERROR_MESSAGES,
  /Traceback \(most recent call last\)/,
  /^\s*at [\w.$<>]+ ?\(.*:\d+(?::\d+)?\)\s*$/m,
  /thread '.*' panicked at/,
  /^npm ERR!/m,
  /^fatal: /m,
  /is not recognized as an internal or external command|: command not found\b/,
  /Segmentation fault|Unhandled exception/i,
];

export function looksLikeError(text: string): boolean {
  return ERROR_SIGNS.some((sign) => sign.test(text));
}

/**
 * The text cut where a key could start: spaces, the = or : of KEY=value, key: value,
 * and brackets (a compiler's error[E0308] is not a password).
 */
function tokens(text: string): string[] {
  return text.split(/[\s=:"'`,;()[\]{}<>]+/).filter(Boolean);
}

export function readCopied(text: string): CopiedPeek {
  const t = text.trim();
  // Inside the parentheses only what a colour is written with: a copied text can't
  // carry a style of its own into the swatch (`rgb(;position:fixed…)`).
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(t) || /^(?:rgba?|hsla?)\([\d\s.,%/+-]*(?:deg|grad|rad|turn)?[\d\s.,%/+-]*\)$/i.test(t)) {
    return { kind: "color", label: t, color: t };
  }
  if (/^https?:\/\/\S+$/i.test(t)) {
    try {
      // The site only: a path or a query can carry a token (a webhook, a reset link).
      const url = new URL(t);
      const more = url.pathname.length > 1 || url.search ? "/…" : "";
      return { kind: "link", label: url.hostname.replace(/^www\./, "") + more };
    } catch {
      // Not a URL after all: read on.
    }
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t)) return { kind: "email", label: t };
  if (tokens(t).some(looksSecret)) return { kind: "secret", label: "••••••••" };
  const lines = t.split(/\r?\n/).filter((l) => l.trim());
  // The line that says what went wrong, else the first one.
  if (looksLikeError(t)) {
    const line = lines.find((l) => ERROR_MESSAGES.some((sign) => sign.test(l))) ?? lines[0];
    return { kind: "error", label: line.trim().replace(/\s+/g, " "), count: lines.length };
  }
  if (lines.length >= 3) return { kind: "multiline", label: `${lines[0].trim()}  +${lines.length - 1}`, count: lines.length };
  return { kind: "text", label: t.replace(/\s+/g, " "), count: [...t].length };
}
