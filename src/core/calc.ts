// The quick line's sums: "1250*1,18", "450 + %18", "(3200-450)/3". Numbers are read the way
// the language writes them (a decimal comma in Turkish or German, a point in English, and
// their thousands marks), percentages the way a shop's calculator takes them: 450 + 18% is
// 531, 450 - 20% is 360, 450 * 18% is 81. A small parser of its own, never eval. Pure.

type Token = { n: number } | { op: string };

/** Each one's value: a percentage is kept as written (18 for 18%) and flagged. */
interface Val {
  v: number;
  pct: boolean;
}

const OPS: Record<string, string> = { "+": "+", "-": "-", "−": "-", "*": "*", "×": "*", x: "*", X: "*", "/": "/", "÷": "/", "^": "^", "(": "(", ")": ")", "%": "%" };

/**
 * A number as written: both marks, the last is the decimal one; only the language's
 * decimal mark, once, is that; only the other, it groups thousands when every group after
 * it has three digits ("1.250" in Turkish), else it is a decimal mark after all ("1.5").
 */
export function readNumber(s: string, decimal: "," | "."): number | null {
  const other = decimal === "," ? "." : ",";
  let int = s;
  let frac = "";
  if (s.includes(",") && s.includes(".")) {
    const at = Math.max(s.lastIndexOf(","), s.lastIndexOf("."));
    const mark = s[at];
    int = s.slice(0, at).split(mark === "," ? "." : ",").join("");
    frac = s.slice(at + 1);
    if (/[.,]/.test(int) || /[.,]/.test(frac)) return null;
  } else if (s.includes(decimal)) {
    [int, frac = ""] = s.split(decimal);
    if (s.split(decimal).length > 2) return null;
  } else if (s.includes(other)) {
    const groups = s.split(other);
    if (groups.slice(1).every((g) => g.length === 3)) int = groups.join("");
    else if (groups.length === 2) [int, frac] = groups;
    else return null;
  }
  if (!/^\d+$/.test(int || "0") || !/^\d*$/.test(frac)) return null;
  return Number(`${int || "0"}.${frac || "0"}`);
}

function tokens(text: string, decimal: "," | "."): Token[] | null {
  const out: Token[] = [];
  const re = /\s*(?:(\d[\d.,]*)|([+\-−*×xX/÷^()%]))/y;
  let at = 0;
  const s = text.trim();
  while (at < s.length) {
    re.lastIndex = at;
    const m = re.exec(s);
    if (!m) return null;
    at = re.lastIndex;
    if (m[1]) {
      // A mark at the end is the sentence's, not the number's ("2+2.").
      const n = readNumber(m[1].replace(/[.,]$/, ""), decimal);
      if (n == null) return null;
      out.push({ n });
    } else {
      out.push({ op: OPS[m[2]] });
    }
  }
  return out;
}

/**
 * The value of `text` when it is a sum: numbers and at least one operator between two of
 * them, nothing else; null for anything else ("15", "12 dk çay", "yarın 14:00"), a
 * division by zero, or what is not finite.
 */
export function parseSum(text: string, decimal: "," | "."): number | null {
  const list = tokens(text, decimal);
  if (!list || list.filter((t) => "n" in t).length < 2) return null;
  let i = 0;
  const peek = () => list[i];
  const isOp = (op: string) => {
    const t = list[i];
    return t != null && "op" in t && t.op === op;
  };
  const plain = (a: Val) => (a.pct ? a.v / 100 : a.v);

  const primary = (): Val | null => {
    if (isOp("%")) {
      i++;
      const t = peek();
      if (!t || !("n" in t)) return null;
      i++;
      return { v: t.n, pct: true };
    }
    if (isOp("(")) {
      i++;
      const inner = expr();
      if (!inner || !isOp(")")) return null;
      i++;
      if (isOp("%")) {
        i++;
        return { v: plain(inner), pct: true };
      }
      return { v: plain(inner), pct: false };
    }
    const t = peek();
    if (!t || !("n" in t)) return null;
    i++;
    if (isOp("%")) {
      i++;
      return { v: t.n, pct: true };
    }
    return { v: t.n, pct: false };
  };
  const unary = (): Val | null => {
    if (isOp("-") || isOp("+")) {
      const minus = isOp("-");
      i++;
      const a = unary();
      return a && { v: minus ? -a.v : a.v, pct: a.pct };
    }
    return power();
  };
  const power = (): Val | null => {
    const a = primary();
    if (!a || !isOp("^")) return a;
    i++;
    const b = unary();
    return b && { v: plain(a) ** plain(b), pct: false };
  };
  const term = (): Val | null => {
    let a = unary();
    while (a && (isOp("*") || isOp("/"))) {
      const op = (list[i++] as { op: string }).op;
      const b = unary();
      if (!b) return null;
      a = { v: op === "*" ? plain(a) * plain(b) : plain(a) / plain(b), pct: false };
    }
    return a;
  };
  const expr = (): Val | null => {
    let a = term();
    while (a && (isOp("+") || isOp("-"))) {
      const op = (list[i++] as { op: string }).op;
      const b = term();
      if (!b) return null;
      // 450 + 18%: 18% of 450 more, as a shop's calculator adds it.
      const by = b.pct && !a.pct ? (a.v * b.v) / 100 : plain(b);
      a = { v: op === "+" ? plain(a) + by : plain(a) - by, pct: false };
    }
    return a;
  };

  const value = expr();
  if (!value || i !== list.length || value.pct) return null;
  return Number.isFinite(value.v) ? Number(value.v.toPrecision(12)) : null;
}

/** The decimal mark the language writes. */
export function decimalOf(locale: string): "," | "." {
  const part = new Intl.NumberFormat(locale).formatToParts(1.5).find((p) => p.type === "decimal");
  return part?.value === "," ? "," : ".";
}

/** A sum's result as the language writes numbers, up to six decimals; without thousands marks to paste. */
export function formatSum(value: number, locale: string, grouping = true): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 6, useGrouping: grouping }).format(value);
}
