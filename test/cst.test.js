import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { grammars } from "../scripts/tree-sitter.js";
import { sourceNodes } from "./support/cst.js";
import { createParser } from "./support/parser.js";
import {
  nestedForSubstitutions,
  representativeSource,
  scalingWorkloads,
} from "./support/workloads.js";

for (const language of grammars) {
  describe(language.name, () => {
    const { parseSummary, valid } = createParser(language);
    test("NUL inside quotes and heredoc bodies preserves the following source", () => {
      for (const source of [
        "print 'a\0b' tail\n",
        "cat <<E\na\0b\nE\nprint tail\n",
      ]) {
        const nodes = sourceNodes(valid(source), source);
        assert.ok(nodes.some(({ text }) => text.includes("a\0b")));
        assert.ok(
          nodes.some(({ type, text }) => type === "literal" && text === "tail"),
        );
      }
    });

    test("only a BOM at source byte zero is excluded", () => {
      const source = "\uFEFFprint \uFEFFword\n";
      const nodes = sourceNodes(valid(source), source);
      assert.equal(nodes[0].start, 3);
      assert.ok(
        nodes.some(
          ({ type, start, text }) =>
            type === "literal" && start === 9 && text === "\uFEFFword",
        ),
      );
    });

    test("non-ASCII argument ranges use source bytes", () => {
      const output = valid("print 日本語\n");
      assert.match(output, /0:6 +- +0:15 +literal/);
    });

    test("regex repetitions and bracket elements retain Unicode code point boundaries", () => {
      for (const { source, types, expected } of [
        {
          source: "[[ x =~ é+𠀀{2} ]]\n",
          types: ["ere_expression", "ordinary_character", "ere_dupl_symbol"],
          expected: [
            ["ere_expression", 8, 11, "é+"],
            ["ordinary_character", 8, 10, "é"],
            ["ere_dupl_symbol", 10, 11, "+"],
            ["ere_expression", 11, 18, "𠀀{2}"],
            ["ordinary_character", 11, 15, "𠀀"],
            ["ere_dupl_symbol", 15, 18, "{2}"],
          ],
        },
        {
          source: "[[ x =~ [é𠀀] ]]\n",
          types: ["collating_element_single"],
          expected: [
            ["collating_element_single", 9, 11, "é"],
            ["collating_element_single", 11, 15, "𠀀"],
          ],
        },
        {
          source: "[[ x =~ [é-ê] ]]\n",
          types: ["range_expression", "collating_element_single"],
          expected: [
            ["range_expression", 9, 14, "é-ê"],
            ["collating_element_single", 9, 11, "é"],
            ["collating_element_single", 12, 14, "ê"],
          ],
        },
        {
          source: "[[ x =~ [[.é.]] ]]\n",
          types: ["collating_symbol", "collating_element_single"],
          expected: [
            ["collating_symbol", 9, 15, "[.é.]"],
            ["collating_element_single", 11, 13, "é"],
          ],
        },
      ]) {
        assert.deepEqual(
          sourceNodes(valid(source), source)
            .filter(({ type }) => types.includes(type))
            .map(({ type, start, end, text }) => [type, start, end, text]),
          expected,
          source,
        );
      }
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
      test(`large ${name} parses through EOF`, () => {
        parseSummary(source(units));
      });
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
        const output = valid(
          `print ${quote}\${(*)x/a#/_}${quote} \${x/a#/_}\n`,
        );
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
  });
}
