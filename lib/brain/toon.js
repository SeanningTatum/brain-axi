// lib/brain/toon.js — TOON (toonformat.dev) encoder shared by the CLI and
// export, plus the small decoder import needs for what the encoder writes.

export function toonScalar(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "null";
    return String(Object.is(v, -0) ? 0 : v);
  }
  if (typeof v === "bigint") return String(v);
  if (typeof v === "boolean") return String(v);
  return toonString(String(v));
}

export function toonString(s) {
  const needsQuote =
    s === "" ||
    /[",:\n\r\t|]/.test(s) ||
    /^\s|\s$/.test(s) ||
    /^(true|false|null)$/.test(s) ||
    /^-?\d/.test(s) ||
    s.startsWith("-");
  if (!needsQuote) return s;
  const escaped = s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

export function kv(key, value, indent = 0) {
  return `${" ".repeat(indent)}${key}: ${toonScalar(value)}`;
}

// Tabular array: name[N]{f1,f2}: + one row per item.
export function toonTable(name, rows, fields, indent = 0) {
  const pad = " ".repeat(indent);
  const lines = [`${pad}${name}[${rows.length}]{${fields.join(",")}}:`];
  for (const row of rows) lines.push(pad + "  " + fields.map((f) => toonScalar(row[f])).join(","));
  return lines;
}

// List array of display strings (help hints etc.). Single item stays inline.
export function toonList(name, items, indent = 0) {
  const pad = " ".repeat(indent);
  if (items.length === 1) return [`${pad}${name}[1]: ${items[0]}`];
  const lines = [`${pad}${name}[${items.length}]:`];
  for (const item of items) lines.push(pad + "  " + item);
  return lines;
}

// ---------------------------------------------------------------------------
// Decoding (the subset toonScalar/toonTable produce)
// ---------------------------------------------------------------------------

const NUMBER_RE = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const UNESCAPE = { "\\": "\\", '"': '"', n: "\n", r: "\r", t: "\t" };

export function parseScalar(raw) {
  if (raw === "null") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (NUMBER_RE.test(raw)) return Number(raw);
  if (raw.startsWith('"')) {
    const [v, end] = readQuoted(raw, 0);
    if (end !== raw.length) throw new Error(`trailing text after quoted value: ${raw}`);
    return v;
  }
  return raw;
}

function readQuoted(s, i) {
  let out = "";
  for (let j = i + 1; j < s.length; j++) {
    const c = s[j];
    if (c === "\\") {
      const e = UNESCAPE[s[++j]];
      if (e === undefined) throw new Error(`bad escape at ${j} in ${s}`);
      out += e;
    } else if (c === '"') return [out, j + 1];
    else out += c;
  }
  throw new Error(`unterminated string: ${s}`);
}

// One table row → scalar values, honouring quotes.
export function parseRow(line) {
  const out = [];
  let i = 0;
  for (;;) {
    if (line[i] === '"') {
      const [v, end] = readQuoted(line, i);
      out.push(v);
      i = end;
    } else {
      let j = line.indexOf(",", i);
      if (j === -1) j = line.length;
      out.push(parseScalar(line.slice(i, j)));
      i = j;
    }
    if (i >= line.length) return out;
    if (line[i] !== ",") throw new Error(`expected "," at ${i} in ${line}`);
    i++;
  }
}
