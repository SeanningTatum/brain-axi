import { test } from "node:test";
import assert from "node:assert/strict";
import { toon, clipChars, BrainError, isBrainError } from "../../lib/brain/index.js";
import { fromSqlite } from "../../lib/brain/errors.js";

test("encoder: scalars quote exactly what would be ambiguous", () => {
  const { toonScalar, kv, toonTable, toonList } = toon;
  assert.equal(toonScalar(null), "null");
  assert.equal(toonScalar(3), "3");
  assert.equal(toonScalar(-0), "0");
  assert.equal(toonScalar(NaN), "null");
  assert.equal(toonScalar(true), "true");
  assert.equal(toonScalar("plain"), "plain");
  for (const s of ["", "a,b", "a:b", "true", "null", "12x", "-x", " lead", 'q"', "a|b", "l\nn"])
    assert.ok(toonScalar(s).startsWith('"'), `should quote ${JSON.stringify(s)}`);
  assert.equal(kv("k", "v", 2), "  k: v");
  assert.deepEqual(toonTable("t", [{ a: 1, b: "x,y" }], ["a", "b"]), ["t[1]{a,b}:", '  1,"x,y"']);
  assert.deepEqual(toonList("help", ["one"]), ["help[1]: one"]);
  assert.deepEqual(toonList("help", ["a", "b"]), ["help[2]:", "  a", "  b"]);
});

test("decoder round-trips everything the encoder writes", () => {
  const values = [null, 0, 1.5, -2, 1e21, "", "plain", "a,b", 'q "x" \\ y', "line\nbreak\r\ttab", "true", "false", "null", "007", "-1", "émoji 🚀", "a\\b"];
  const line = values.map(toon.toonScalar).join(",");
  assert.deepEqual(toon.parseRow(line), values);
  assert.equal(toon.parseScalar("true"), true);
  assert.throws(() => toon.parseRow('"unterminated'), /unterminated/);
  assert.throws(() => toon.parseRow('"a"b'), /expected ","/);
});

test("clipChars clips by code point and ends with …", () => {
  assert.equal(clipChars("short", 10), "short");
  assert.equal(clipChars("abcdefghij", 5), "abcd…");
  assert.equal(clipChars("ab   cdef", 6), "ab…");
  assert.equal(clipChars("🚀🚀🚀", 2), "🚀…");
});

test("BrainError: code, message, help (alias hint), detail, exit code by kind", () => {
  const e = new BrainError("NO_DB", "no brain.db", ["brain init"], { x: 1 });
  assert.ok(e instanceof Error);
  assert.deepEqual([e.code, e.message, e.help, e.hint, e.detail, e.exitCode], ["NO_DB", "no brain.db", ["brain init"], ["brain init"], { x: 1 }, 1]);
  assert.equal(new BrainError("INVALID_ARG", "x", "one line").help[0], "one line");
  assert.equal(new BrainError("SUMMARY_TOO_LONG", "x").exitCode, 2);
  assert.ok(isBrainError(e, "NO_DB") && !isBrainError(e, "X") && !isBrainError(new Error("x")));
  const c = fromSqlite(Object.assign(new Error("CHECK constraint failed: status IN (...)"), { code: "ERR_SQLITE_ERROR" }));
  assert.equal(c.code, "CONSTRAINT");
  const plain = new Error("other");
  assert.equal(fromSqlite(plain), plain);
});
