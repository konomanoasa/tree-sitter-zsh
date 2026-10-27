import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceNodes } from "./support/cst.js";
import { language } from "./support/language.js";
import { parseSummary, valid } from "./support/parser.js";
import {
  nestedForSubstitutions,
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
  for (const factor of scaleFactors) {
    test(`large ${name} parses through EOF at scale ${factor}`, () => {
      parseSummary(source(units * factor));
    });
  }
}

test("language selection fixes extended glob while explicit substitution flags stay local", () => {
  for (const setting of [
    "setopt extendedglob",
    "unsetopt extendedglob",
    "emulate zsh",
    "set -f",
    "set +f",
    "setopt noglob",
    "unsetopt noglob",
  ]) {
    const output = valid(`${setting}\nprint a#\n`);
    assert.equal(
      output.includes("extended_pattern"),
      language.name === "zsh_extended_glob",
    );
  }
  assert.equal(
    valid("noglob print a#\n").includes("extended_pattern"),
    language.name === "zsh_extended_glob",
  );
  for (const quote of ["", '"']) {
    const output = valid(`print ${quote}\${(*)x/a#/_}${quote} \${x/a#/_}\n`);
    assert.equal(
      (output.match(/extended_pattern/g) ?? []).length,
      language.name === "zsh_extended_glob" ? 2 : 1,
    );
  }
  const quoted = valid(`print "\${x#a*}" "\${x:-a*}"\n`);
  assert.equal((quoted.match(/pattern_star_source/g) ?? []).length, 1);
});

const substitutionDepth = 256;
const forSubstitutionDepth = 512;
const arithmeticDepth = 2048;
const failingArithmeticDepth = 32;
const delimiterBytes = 4096;
const pendingDocumentCount = 128;
const invalidCloserCount = 512;

const limitWorkloads = [
  {
    name: "deep substitutions",
    source: `print ${"$(print ".repeat(substitutionDepth)}x${")".repeat(substitutionDepth)}\n`,
  },
  {
    name: "deep for substitutions",
    source: nestedForSubstitutions(forSubstitutionDepth),
  },
  {
    name: "deep arithmetic lookahead",
    source: `print ${"$((".repeat(arithmeticDepth)}1${"))".repeat(arithmeticDepth)}\n`,
  },
  {
    name: "failing nested arithmetic candidates",
    source: `x=${"$((".repeat(failingArithmeticDepth)}$[[((1)(r))${"))".repeat(failingArithmeticDepth)}\n`,
  },
  {
    name: "large delimiter metadata",
    source: `cat <<${"E".repeat(delimiterBytes)}\nbody\n`,
  },
  {
    name: "many pending documents",
    source: `cat ${Array.from({ length: pendingDocumentCount }, (_, i) => `<<E${i}`).join(" ")}\n${Array.from({ length: pendingDocumentCount }, (_, i) => `body\nE${i}\n`).join("")}`,
  },
  {
    name: "repeated invalid closers",
    source: ")\n".repeat(invalidCloserCount),
  },
];

for (const { name, source } of limitWorkloads) {
  test(`limit input completes: ${name}`, () => parseSummary(source, false));
}
