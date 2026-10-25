import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceNodes } from "./support/cst.js";
import { parseSummary, valid } from "./support/parser.js";
import {
  representativeSource,
  scaleFactors,
  scalingWorkloads,
} from "./support/workloads.js";

test("non-ASCII argument ranges use source bytes", () => {
  const output = valid("print 日本語\n");
  assert.match(output, /0:6 +- +0:15 +literal/);
});

test("CST inspection preserves fields and byte ranges for non-ASCII source", () => {
  const source = "echo 雪\n";
  const nodes = sourceNodes(valid(source), source);
  assert.deepEqual(
    nodes
      .filter((node) => node.type === "word")
      .map(({ field, start, end, text, recovery }) => ({
        field,
        start,
        end,
        text,
        recovery,
      })),
    [
      { field: "name", start: 0, end: 4, text: "echo", recovery: false },
      { field: "argument", start: 5, end: 8, text: "雪", recovery: false },
    ],
  );
});

test("unquoted NUL is retained inside words and lookahead boundaries", () => {
  for (const { source, expected } of [
    { source: "print a\0b", expected: /0:6 +- +0:9 +literal `a\\0b`/ },
    { source: "print \0", expected: /0:6 +- +0:7 +literal `\\0`/ },
    { source: "if\0 x\n", expected: /0:0 +- +0:3 +literal `if\\0`/ },
    { source: "print }\0\n", expected: /0:6 +- +0:8 +literal `}\\0`/ },
    {
      source: "print [a\0b]\n",
      expected: /0:7 +- +0:10 +pattern_bracket_text `a\\0b`/,
    },
    {
      source: "[[ x =~ a\0b ]]\n",
      expected: /0:9 +- +0:10 +ordinary_character `\\0`/,
    },
    {
      source: "cat <<\0\nbody\n\0\nprint after\n",
      expected: /2:0 +- +2:1 +here_document_end_text `\\0`/,
    },
    {
      source: "cat <<E\0F\nbody\nE\0F",
      expected: /2:0 +- +2:3 +here_document_end_text `E\\0F`/,
    },
  ]) {
    assert.match(valid(source), expected);
  }
});

test("representative native source parses through EOF", () => {
  parseSummary(representativeSource);
});

for (const { name, units, source } of scalingWorkloads) {
  test(`large ${name} parse through EOF at each scale`, () => {
    for (const factor of scaleFactors) parseSummary(source(units * factor));
  });
}
