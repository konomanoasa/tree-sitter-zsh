import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { grammars } from "../scripts/tree-sitter.js";
import { sourceNodes } from "./support/cst.js";
import { createParser } from "./support/parser.js";

for (const language of grammars) {
  describe(language.name, () => {
    const { parse, valid } = createParser(language);
    function assertOutsideErrors(nodes, labels) {
      const errors = nodes.filter((node) => node.type === "ERROR");
      for (const label of labels) {
        const command = nodes.find(
          (node) =>
            node.type === "simple_command" && node.text === `echo ${label}`,
        );
        assert.ok(command, `${label}: command was lost`);
        assert.ok(
          errors.every(
            (error) => error.end <= command.start || error.start >= command.end,
          ),
          `${label}: command is inside ERROR`,
        );
      }
    }

    for (const { name, body, owner } of [
      { name: "a missing if condition", body: "if\nfi\n", owner: "if_clause" },
      {
        name: "a missing while condition",
        body: "while\ndone\n",
        owner: "while_clause",
      },
      {
        name: "a for body",
        body: "for x in a; do ) ; done\n",
        owner: "for_clause",
      },
      {
        name: "a select body",
        body: "select x in a; do ) ; done\n",
        owner: "select_clause",
      },
      {
        name: "a repeat body",
        body: "repeat 2 do ) ; done\n",
        owner: "repeat_clause",
      },
      {
        name: "a while body",
        body: "while :; do ) ; done\n",
        owner: "while_clause",
      },
      { name: "an if body", body: "if :; then ) ; fi\n", owner: "if_clause" },
      {
        name: "a mixed brace branch body",
        body: "if false; then :; elif [[ x ]] { ) ; };\n",
        owner: "if_clause",
      },
      {
        name: "a mixed then branch body",
        body: "if [[ x ]] { :; } elif :; then ) ; fi\n",
        owner: "if_clause",
      },
      {
        name: "a mixed brace else body",
        body: "if false; then :; elif [[ x ]] { :; } else { ) ; }\n",
        owner: "if_clause",
      },
      {
        name: "an extra fi after a mixed brace else",
        body: "if false; then :; elif [[ x ]] { :; } else { :; } fi\n",
        owner: "if_clause",
      },
      { name: "a brace group", body: "{ ) ; }\n", owner: "brace_group" },
      {
        name: "an always body",
        body: "{ ) ; } always { :; }\n",
        owner: "always_clause",
      },
      {
        name: "a missing condition operand",
        body: "[[ x == ]]\n",
        owner: "conditional_command",
      },
      {
        name: "a bare hyphen condition",
        body: "[[ - ]]\n",
        owner: "conditional_command",
      },
      {
        name: "adjacent empty regex parentheses",
        body: "[[ x =~ () ]]\n",
        owner: "conditional_command",
      },
      {
        name: "nested empty regex parentheses",
        body: "[[ x =~ (()) ]]\n",
        owner: "conditional_command",
      },
      {
        name: "empty regex parentheses inside a bracket expression",
        body: "[[ x =~ [()] ]]\n",
        owner: "conditional_command",
      },
      {
        name: "an empty condition",
        body: "[[ ]]\n",
        owner: "conditional_command",
      },
      {
        name: "a condition containing only a newline",
        body: "[[\n]]\n",
        owner: "conditional_command",
      },
      {
        name: "a condition containing only a comment",
        body: "[[ # no expression\n]]\n",
        owner: "conditional_command",
      },
      {
        name: "a missing negated condition",
        body: "[[ ! ]]\n",
        owner: "conditional_command",
      },
      {
        name: "an empty condition group with a continued closer",
        body: "[[ ( ) ]\\\n]\n",
        owner: "conditional_command",
      },
      {
        name: "unclosed groups inside a closed condition",
        body: "[[ ( ( x ]]\n",
        owner: "conditional_command",
      },
      {
        name: "an empty condition inside a quoted command substitution",
        body: '[[ "$( [[ ]] )" ]]\n',
        owner: "command_substitution",
      },
      {
        name: "an empty condition inside a process substitution",
        body: "cat <([[ ]])\n",
        owner: "process_substitution",
      },
      {
        name: "an empty condition inside a backquote substitution",
        body: "echo `[[ ]]`\n",
        owner: "backquote_substitution",
      },
      {
        name: "an unclosed single quote inside a backquote substitution",
        body: "x=`echo '`\n",
        owner: "backquote_substitution",
      },
      {
        name: "an unclosed parameter inside a backquote substitution",
        body: "x=`echo ${x`\n",
        owner: "backquote_substitution",
      },
      {
        name: "an unclosed command substitution inside a backquote substitution",
        body: "x=`echo $(`\n",
        owner: "backquote_substitution",
      },
      {
        name: "an unclosed parameter flag inside a backquote substitution",
        body: "x=`echo ${(g`\n",
        owner: "backquote_substitution",
      },
      {
        name: "an unclosed subscript flag inside a backquote substitution",
        body: "x=$(`echo ${x[(e:`)\n",
        owner: "backquote_substitution",
      },
      {
        name: "an unclosed nested backquote substitution",
        body: "x=`echo \\`b`\n",
        owner: "backquote_substitution",
      },
      {
        name: "an unclosed single quote inside a nested backquote substitution",
        body: "x=`echo \\`b '`\n",
        owner: "backquote_substitution",
      },
      {
        name: "a quoted parameter",
        body: `echo "\${x!bad}"\n`,
        owner: "parameter_expansion",
      },
      {
        name: "an unknown parameter flag",
        body: `echo \${(?)name}\n`,
        owner: "parameter_expansion",
      },
      {
        name: "an invalid delimited flag argument",
        body: `echo \${(g:x:)name}\n`,
        owner: "parameter_expansion",
      },
      {
        name: "an invalid flag argument with a quoted closing delimiter",
        body: `echo \${(g{"x}"})name}\n`,
        owner: "parameter_expansion",
      },
      {
        name: "a continued parameter flag closer",
        body: `echo \${(?\\\n)name}\n`,
        owner: "parameter_expansion",
      },
      {
        name: "a closed foreach body",
        body: "foreach x (a)\n) ; end\n",
        owner: "for_clause",
      },
      {
        name: "a continued closing keyword",
        body: "while :; do ) ; do\\\nne\n",
        owner: "while_clause",
      },
    ]) {
      test(`recovery after ${name} leaves following commands outside the damaged owner`, () => {
        const source = `echo BEFORE\n${body}echo AFTER\necho FINAL\n`;
        const parsed = parse(source);
        assert.equal(parsed.hasError, true, parsed.output);
        const nodes = sourceNodes(parsed.output, source);
        assert.equal(nodes[0].type, "program");
        assertOutsideErrors(nodes, ["BEFORE", "AFTER", "FINAL"]);
        const after = source.indexOf("echo AFTER");
        assert.ok(
          nodes.every((node) => node.type !== owner || node.end <= after),
          parsed.output,
        );
        assert.deepEqual(sourceNodes(parse(source).output, source), nodes);
      });
    }

    test("unclosed heredoc delimiter quotes preserve decoded characters and the outer backquote", () => {
      for (const { prefix = "x=", substitution, suffix = "; echo AFTER\n" } of [
        { substitution: "`cat <<\\`E`" },
        { substitution: "`cat <<-\\`E`" },
        { substitution: "`cat <<pre\\`E`" },
        { substitution: "`cat <<OK <<\\`E`" },
        { substitution: "`cat <<\\`é`" },
        { substitution: "`cat <<\\`E\\\nF`" },
        {
          prefix: 'x="',
          substitution: "`cat <<\\`E`",
          suffix: '"; echo AFTER\n',
        },
        {
          prefix: "x=$(echo ",
          substitution: "`cat <<\\`E`",
          suffix: "); echo AFTER\n",
        },
        { substitution: "`echo \\`cat <<\\\\\\`E\\``" },
      ]) {
        const source = `echo BEFORE\n${prefix}${substitution}${suffix}`;
        const parsed = parse(source);
        assert.ok(parsed.hasError, source);
        const nodes = sourceNodes(parsed.output, source);
        assert.equal(nodes[0].type, "program", parsed.output);
        assertOutsideErrors(nodes, ["BEFORE", "AFTER"]);
        assert.ok(
          nodes.some(
            ({ type, text }) =>
              type === "backquote_substitution" && text === substitution,
          ),
          parsed.output,
        );
      }
    });

    test("repairing a decoded heredoc delimiter quote matches fresh parsing", () => {
      for (const [prefix, suffix] of [
        ["x=", "; echo AFTER\n"],
        ['x="', '"; echo AFTER\n'],
        ["x=$(echo ", "); echo AFTER\n"],
      ]) {
        const before = `${prefix}\`cat <<\\\`E\`${suffix}`;
        const after = `${prefix}\`cat <<\\\`E\\\`\`${suffix}`;
        const byte = before.indexOf("E") + 1;
        const repair = { byte, deleteBytes: 0, insert: "\\`" };
        const damage = { byte, deleteBytes: 2, insert: "" };
        assert.ok(parse(before).hasError, before);
        assert.equal(valid(before, [repair]), valid(after));
        assert.ok(parse(after, [damage]).hasError, before);
        assert.equal(valid(after, [damage, repair]), valid(after));
        const nodes = sourceNodes(valid(after), after);
        assert.ok(
          nodes.some(
            ({ type, text }) =>
              type === "here_document_delimiter_quoted" && text === "\\`E\\`",
          ),
        );
        assertOutsideErrors(nodes, ["AFTER"]);
      }
    });

    for (const { name, body, ends, hasError = true } of [
      {
        name: "a damaged parameter",
        body: `cat <<E\n\${x!bad}\nE\n`,
        ends: ["E"],
      },
      {
        name: "an unclosed subscript",
        body: `cat <<E\n\${x[1}\nE\n`,
        ends: ["E"],
      },
      {
        name: "an unclosed quoted parameter operand",
        body: `cat <<E\n\${x:-"}\nE\n`,
        ends: ["E"],
      },
      {
        name: "an unclosed flag argument",
        body: `cat <<E\n\${(j)name}\nE\n`,
        ends: ["E"],
      },
      {
        name: "an unclosed quote inside a flag argument",
        body: `cat <<E\n\${(j:"x:)name}\nE\n`,
        ends: ["E"],
      },
      {
        name: "an escaped quote inside an unclosed flag argument",
        body: `cat <<E\n\${(j:"x\\":)name}\nE\n`,
        ends: ["E"],
      },
      {
        name: "a nested quoted parameter inside an unclosed flag argument",
        body: `cat <<E\n\${(j.\${other:-"}"})name}\nE\n`,
        ends: ["E"],
      },
      {
        name: "a command substitution inside an unclosed flag argument",
        body: `cat <<E\n\${(j:$(echo x))name}\nE\n`,
        ends: ["E"],
      },
      {
        name: "an unclosed command substitution after flag argument text",
        body: `cat <<E\n\${(j:prefix$(\nE\n`,
        ends: ["E"],
      },
      {
        name: "an unknown flag",
        body: `cat <<E\n\${(?)name}\nE\n`,
        ends: ["E"],
      },
      {
        name: "an invalid flag argument",
        body: `cat <<E\n\${(g:x:)name}\nE\n`,
        ends: ["E"],
      },
      {
        name: "valid flag options followed by an invalid option",
        body: `cat <<E\n\${(g:oooox:)name}\nE\n`,
        ends: ["E"],
      },
      {
        name: "a body with stripped tabs",
        body: `cat <<-E\n\t\${(j)name}\n\tE\n`,
        ends: ["E"],
      },
      {
        name: "a following quoted document",
        body: `cat <<E <<'F'\n\${(j)name}\nE\n\${(j)name}\nF\n`,
        ends: ["E", "F"],
      },
      {
        name: "a document inside a quoted substitution",
        body: `echo "$(cat <<E\n\${(j)name}\nE\n)"\n`,
        ends: ["E"],
      },
      {
        name: "a document inside a process substitution",
        body: `cat <(cat <<E\n\${(j)name}\nE\n)\n`,
        ends: ["E"],
      },
      {
        name: "a document ending at a backquote",
        body: `echo \`cat <<E\n\${(j)name}\nE\`\n`,
        ends: ["E"],
      },
      {
        name: "a backquote with an unclosed quote inside the body",
        body: "cat <<E\n`echo '`\nE\n",
        ends: ["E"],
      },
      {
        name: "nested documents",
        body: `cat <<OUTER\n$(cat <<E\n\${(j)name}\nE\n)\nOUTER\n`,
        ends: ["E", "OUTER"],
      },
      {
        name: "an outer end before an inner document end",
        body: `cat <<OUTER\n$(cat <<E\n\${(j)name}\nOUTER\n`,
        ends: ["OUTER"],
      },
      {
        name: "delimiter prefixes and continued body lines",
        body: `cat <<E\n\${(j)name}\nnotE\nE suffix\nx\\\nE\nE\n`,
        ends: ["E"],
      },
      {
        name: "a continued delimiter",
        body: `cat <<END\n\${(j)name}\nEN\\\nD\n`,
        ends: ["EN\\\nD"],
      },
      {
        name: "literal parameter spelling in a quoted document",
        body: `cat <<'E'\n\${(j)name}\nE\n`,
        ends: ["E"],
        hasError: false,
      },
    ]) {
      test(`heredoc boundaries preserve end lines and following commands after ${name}`, () => {
        const source = `echo BEFORE\n${body}echo AFTER\necho FINAL\n`;
        const parsed = parse(source);
        assert.equal(parsed.hasError, hasError, parsed.output);
        const nodes = sourceNodes(parsed.output, source);
        assert.equal(nodes[0].type, "program", parsed.output);
        assertOutsideErrors(nodes, ["BEFORE", "AFTER", "FINAL"]);
        assert.deepEqual(
          nodes
            .filter((node) => node.type === "here_document_end_text")
            .map((node) => node.text),
          ends,
          parsed.output,
        );
        const after = source.indexOf("echo AFTER");
        assert.ok(
          nodes.every(
            (node) =>
              ![
                "here_document_sequence",
                "here_document",
                "here_document_body",
              ].includes(node.type) || node.end <= after,
          ),
          parsed.output,
        );
        assert.deepEqual(sourceNodes(parse(source).output, source), nodes);
      });
    }

    for (const separator of [";;", ";&", ";|"]) {
      for (const {
        name,
        prefix,
        suffix,
        opening = "case x in",
        closing = "esac",
        caseCount = 1,
      } of [
        { name: "a top-level case", prefix: "", suffix: "" },
        { name: "a command substitution", prefix: 'echo "$(', suffix: ')"' },
        {
          name: "a loop inside a command substitution",
          prefix: 'echo "$(for x in a; do ',
          suffix: '; done)"',
        },
        { name: "a process substitution", prefix: "cat <(", suffix: ")" },
        { name: "a backquote substitution", prefix: "echo `", suffix: "`" },
        {
          name: "a brace case",
          prefix: "",
          suffix: "",
          opening: "case x {",
          closing: "}",
        },
        {
          name: "a nested case",
          prefix: "case y in y) ",
          suffix: " ;; esac",
          caseCount: 2,
        },
        {
          name: "a case nested in a brace case",
          prefix: "case y { y) ",
          suffix: " ;; }",
          caseCount: 2,
        },
      ]) {
        test(`case separator ${separator} preserves and repairs an incomplete pipeline in ${name}`, () => {
          const source = `echo BEFORE\n${prefix}${opening} x) echo SAME | ${separator} ${closing}${suffix}\necho AFTER\necho FINAL\n`;
          const parsed = parse(source);
          assert.equal(parsed.hasError, true, parsed.output);
          const nodes = sourceNodes(parsed.output, source);
          assert.equal(nodes[0].type, "program", parsed.output);
          assertOutsideErrors(nodes, ["BEFORE", "SAME", "AFTER", "FINAL"]);
          const cases = nodes.filter((node) => node.type === "case_clause");
          assert.equal(cases.length, caseCount, parsed.output);
          const owner = cases.find(
            (node) => node.start === source.indexOf(opening),
          );
          assert.ok(owner, parsed.output);
          assert.ok(owner.start < source.indexOf("echo SAME"));
          assert.ok(
            owner.end > source.indexOf("echo SAME") + "echo SAME".length,
          );
          assert.ok(
            cases.every((node) => node.end <= source.indexOf("echo AFTER")),
          );
          const byte = source.indexOf("| ") + 2;
          const repair = { byte, deleteBytes: 0, insert: ": " };
          const damage = { byte, deleteBytes: 2, insert: "" };
          const repaired =
            source.slice(0, byte) + repair.insert + source.slice(byte);
          const fresh = valid(repaired);
          assert.equal(valid(source, [repair]), fresh);
          assert.equal(valid(repaired, [damage, repair]), fresh);
        });
      }
      test(`an isolated ${separator} remains an error outside a case`, () => {
        const source = `echo BEFORE\n${separator}\necho AFTER\necho FINAL\n`;
        const parsed = parse(source);
        assert.equal(parsed.hasError, true, parsed.output);
        const nodes = sourceNodes(parsed.output, source);
        assertOutsideErrors(nodes, ["BEFORE", "AFTER", "FINAL"]);
        assert.ok(nodes.every((node) => node.type !== "case_clause"));
      });
    }

    test("a parenthesis flag delimiter preserves multiline argument content", () => {
      const source = `echo \${(j)foo\nbar))name}\necho AFTER\n`;
      const nodes = sourceNodes(valid(source), source);
      assert.deepEqual(
        nodes
          .filter((node) => node.type === "flag_argument_text")
          .map((node) => node.text),
        ["foo\nbar"],
      );
      assertOutsideErrors(nodes, ["AFTER"]);
    });

    for (const { name, parameter } of [
      { name: "an unclosed quote", parameter: `\${(g:"x:)name}` },
      { name: "a quoted brace", parameter: `\${(g{"x})name}` },
      {
        name: "a closed quote without the delimiter",
        parameter: `\${(g{"x}")name}`,
      },
      { name: "an escaped brace", parameter: `\${(g{\\})name}` },
    ]) {
      test(`recovery does not end a flag argument at ${name}`, () => {
        const source = `echo BEFORE\necho ${parameter}\necho AFTER\n`;
        const parsed = parse(source);
        assert.equal(parsed.hasError, true, parsed.output);
        const nodes = sourceNodes(parsed.output, source);
        assertOutsideErrors(nodes, ["BEFORE"]);
        assert.ok(
          nodes.every(
            (node) =>
              node.type !== "simple_command" || node.text !== "echo AFTER",
          ),
          parsed.output,
        );
      });
    }

    for (const { name, prefix, depth, tail } of [
      {
        name: "for headers",
        prefix: "for x in a; do\n",
        depth: 2,
        tail: ")\n",
      },
      {
        name: "select headers",
        prefix: "select x in a; do\n",
        depth: 2,
        tail: ")\n",
      },
      {
        name: "foreach headers",
        prefix: "foreach x (a)\n",
        depth: 3,
        tail: ")\n",
      },
      {
        name: "arithmetic for headers",
        prefix: "for ((x=0;x<1;x++)); do\n",
        depth: 2,
        tail: ")\n",
      },
      { name: "an if header", prefix: "if :; then\n", depth: 1, tail: ")\n" },
      {
        name: "a parameter head",
        prefix: "",
        depth: 0,
        tail: "echo ${x:-word\n",
      },
      {
        name: "a flag argument outside a heredoc",
        prefix: "",
        depth: 0,
        tail: `echo \${(j)name}\n`,
      },
      { name: "a condition", prefix: "", depth: 0, tail: "[[ x == y\n" },
      { name: "a for name", prefix: "", depth: 0, tail: "for\n" },
      { name: "a repeat count", prefix: "", depth: 0, tail: "repeat\n" },
    ]) {
      test(`unfinished ${name} preserve the preceding command outside ERROR`, () => {
        const source = `echo BEFORE\n${prefix.repeat(depth)}${tail}echo AFTER\necho FINAL\n`;
        const parsed = parse(source);
        assert.equal(parsed.hasError, true, parsed.output);
        const nodes = sourceNodes(parsed.output, source);
        assert.equal(nodes[0].type, "program");
        assertOutsideErrors(nodes, ["BEFORE"]);
      });
    }

    const loopBody =
      "echo x\necho x\necho x\necho x\necho x\necho x\necho AFTER\necho FINAL\n";
    for (const {
      name,
      open,
      close,
      body = "echo FIRST\necho MIDDLE\necho LAST\n",
    } of [
      { name: "a brace group", open: "{\n", close: "}\n" },
      { name: "a subshell", open: "(\n", close: ")\n" },
      { name: "a function body", open: "f() {\n", close: "}\n" },
      { name: "nested brace groups", open: "{\n{\n", close: "}\n}\n" },
      {
        name: "a while loop",
        open: "while :; do\n",
        close: "done\n",
        body: loopBody,
      },
      {
        name: "an until loop",
        open: "until false; do\n",
        close: "done\n",
        body: loopBody,
      },
      {
        name: "a for loop",
        open: "for x in a; do\n",
        close: "done\n",
        body: loopBody,
      },
      {
        name: "a select loop",
        open: "select x in a; do\n",
        close: "done\n",
        body: loopBody,
      },
      {
        name: "a repeat loop",
        open: "repeat 2 do\n",
        close: "done\n",
        body: loopBody,
      },
      {
        name: "an arithmetic for loop",
        open: "for ((i=0;i<1;i++)); do\n",
        close: "done\n",
        body: loopBody,
      },
      {
        name: "nested for loops",
        open: "for x in a; do\nfor x in a; do\n",
        close: "done\ndone\n",
        body: loopBody,
      },
    ]) {
      test(`an unclosed body in ${name} preserves the preceding command and repairs to the fresh CST`, () => {
        const source = `echo BEFORE\n${open}${body}`;
        const parsed = parse(source);
        assert.equal(parsed.hasError, true, parsed.output);
        const nodes = sourceNodes(parsed.output, source);
        assert.equal(nodes[0].type, "program", parsed.output);
        assertOutsideErrors(nodes, ["BEFORE"]);
        const inserted = `${close}echo OUTSIDE\n`;
        const repair = {
          byte: source.length,
          deleteBytes: 0,
          insert: inserted,
        };
        const damage = {
          byte: source.length,
          deleteBytes: inserted.length,
          insert: "",
        };
        const repaired = source + inserted;
        const fresh = valid(repaired);
        const repairedNodes = sourceNodes(fresh, repaired);
        const outside = repairedNodes.find(
          (node) =>
            node.type === "simple_command" && node.text === "echo OUTSIDE",
        );
        assert.ok(outside);
        for (const node of repairedNodes.filter(
          (node) => node.type === "do_group",
        ))
          assert.ok(node.end <= outside.start, fresh);
        assert.equal(valid(source, [repair]), fresh);
        assert.equal(valid(repaired, [damage, repair]), fresh);
      });
    }

    for (const { name, before, removed, inserted, after } of [
      {
        name: "a loop closer",
        before: "echo BEFORE\nwhile :; do ) ; done\necho AFTER\n",
        removed: ") ",
        inserted: "",
        after: "echo BEFORE\nwhile :; do ; done\necho AFTER\n",
      },
      {
        name: "an always body",
        before: "echo BEFORE\n{ ) ; } always { :; }\necho AFTER\n",
        removed: ") ",
        inserted: "",
        after: "echo BEFORE\n{ ; } always { :; }\necho AFTER\n",
      },
      {
        name: "a condition operand",
        before: "echo BEFORE\n[[ x == ]]\necho AFTER\n",
        removed: "== ",
        inserted: "== x ",
        after: "echo BEFORE\n[[ x == x ]]\necho AFTER\n",
      },
      {
        name: "an empty condition",
        before: "echo BEFORE\n[[ ]]\necho AFTER\n",
        removed: "[[ ",
        inserted: "[[ x ",
        after: "echo BEFORE\n[[ x ]]\necho AFTER\n",
      },
      {
        name: "a condition containing only a comment",
        before: "echo BEFORE\n[[ # no expression\n]]\necho AFTER\n",
        removed: "\n]]",
        inserted: "\nx ]]",
        after: "echo BEFORE\n[[ # no expression\nx ]]\necho AFTER\n",
      },
      {
        name: "a condition group",
        before: "echo BEFORE\n[[ ( x ]]\necho AFTER\n",
        removed: "x ]]",
        inserted: "x ) ]]",
        after: "echo BEFORE\n[[ ( x ) ]]\necho AFTER\n",
      },
      {
        name: "a condition inside a command substitution",
        before: 'echo BEFORE\n[[ "$( [[ ]] )" ]]\necho AFTER\n',
        removed: "[[ ]]",
        inserted: "[[ x ]]",
        after: 'echo BEFORE\n[[ "$( [[ x ]] )" ]]\necho AFTER\n',
      },
      {
        name: "a condition inside a backquote substitution",
        before: "echo BEFORE\necho `[[ ]]`\necho AFTER\n",
        removed: "[[ ]]",
        inserted: "[[ x ]]",
        after: "echo BEFORE\necho `[[ x ]]`\necho AFTER\n",
      },
      {
        name: "a quoted parameter",
        before: `echo BEFORE\necho "\${x!bad}"\necho AFTER\n`,
        removed: "!bad",
        inserted: ":-ok",
        after: `echo BEFORE\necho "\${x:-ok}"\necho AFTER\n`,
      },
      {
        name: "an unknown parameter flag",
        before: `echo BEFORE\necho \${(?)name}\necho AFTER\n`,
        removed: "?",
        inserted: "q",
        after: `echo BEFORE\necho \${(q)name}\necho AFTER\n`,
      },
      {
        name: "an invalid final flag option",
        before: `echo BEFORE\necho \${(g:oox:)name}\necho AFTER\n`,
        removed: "oox",
        inserted: "ooc",
        after: `echo BEFORE\necho \${(g:ooc:)name}\necho AFTER\n`,
      },
      {
        name: "an invalid flag argument containing a quoted delimiter",
        before: `echo BEFORE\necho \${(g{"x}"})name}\necho AFTER\n`,
        removed: "g{",
        inserted: "j{",
        after: `echo BEFORE\necho \${(j{"x}"})name}\necho AFTER\n`,
      },
      {
        name: "an unclosed flag argument inside a heredoc",
        before: `echo BEFORE\ncat <<E\n\${(j)name}\nE\necho AFTER\n`,
        removed: "j)",
        inserted: "j:,:)",
        after: `echo BEFORE\ncat <<E\n\${(j:,:)name}\nE\necho AFTER\n`,
      },
      {
        name: "a parameter inside a tab-stripped heredoc",
        before: `echo BEFORE\ncat <<-E\n\t\${x!bad}\n\tE\necho AFTER\n`,
        removed: "!bad",
        inserted: ":-ok",
        after: `echo BEFORE\ncat <<-E\n\t\${x:-ok}\n\tE\necho AFTER\n`,
      },
      {
        name: "a subscript inside a heredoc",
        before: `echo BEFORE\ncat <<E\n\${x[1}\nE\necho AFTER\n`,
        removed: "[1}",
        inserted: "[1]}",
        after: `echo BEFORE\ncat <<E\n\${x[1]}\nE\necho AFTER\n`,
      },
      {
        name: "a parameter inside a nested heredoc",
        before: `echo BEFORE\ncat <<OUTER\n$(cat <<E\n\${x!bad}\nE\n)\nOUTER\necho AFTER\n`,
        removed: "!bad",
        inserted: ":-ok",
        after: `echo BEFORE\ncat <<OUTER\n$(cat <<E\n\${x:-ok}\nE\n)\nOUTER\necho AFTER\n`,
      },
    ]) {
      test(`repairing ${name} restores the same public CST as fresh parsing`, () => {
        assert.equal(parse(before).hasError, true);
        const byte = before.indexOf(removed);
        assert.ok(byte >= 0);
        assert.equal(
          before.slice(0, byte) +
            inserted +
            before.slice(byte + removed.length),
          after,
        );
        assert.equal(
          valid(before, [
            { byte, deleteBytes: removed.length, insert: inserted },
          ]),
          valid(after),
        );
      });
    }

    test("repairing unclosed heredoc parameters restores the complete fresh CST", () => {
      for (const { body, complete, insert } of [
        { body: "${", complete: `\${x}`, insert: "x}" },
        { body: "${x", complete: `\${x}`, insert: "}" },
        { body: "${x[", complete: `\${x[1]}`, insert: "1]}" },
        { body: `"\${x:-"}"`, complete: `"\${x:-"}"}"`, insert: '}"' },
        { body: `\${(j:"x`, complete: `\${(j:"x":)name}`, insert: '":)name}' },
        {
          body: `\${(j:"x\\"`,
          complete: `\${(j:"x\\"":)name}`,
          insert: '":)name}',
        },
        {
          body: `\${(j.\${other:-"}"}`,
          complete: `\${(j.\${other:-"}"}.)name}`,
          insert: ".)name}",
        },
        {
          body: `\${(j:$(echo x)`,
          complete: `\${(j:$(echo x):)name}`,
          insert: ":)name}",
        },
        {
          body: `\${(j:prefix$(`,
          complete: `\${(j:prefix$(echo x):)name}`,
          insert: "echo x):)name}",
        },
      ]) {
        const source = `cat <<OUT\n${body}\nOUT\nprint AFTER\n`;
        const repaired = `cat <<OUT\n${complete}\nOUT\nprint AFTER\n`;
        const fresh = valid(repaired);
        const byte = "cat <<OUT\n".length + body.length;
        const repair = { byte, deleteBytes: 0, insert };
        const remove = { byte, deleteBytes: insert.length, insert: "" };
        assert.equal(valid(source, [repair]), fresh);
        assert.equal(valid(repaired, [remove, repair]), fresh);
      }
    });

    test("closing delimiter parentheses restores its heredoc and following command", () => {
      assert.equal(
        valid(": <<{a(}\nbody\n{a(}\nprint after\n", [
          { byte: 18, deleteBytes: 0, insert: ")" },
          { byte: 8, deleteBytes: 0, insert: ")" },
        ]),
        valid(": <<{a(})\nbody\n{a(})\nprint after\n"),
      );
    });

    test("repairing a process redirection restores the following command", () => {
      assert.equal(
        valid("cat > <(:)\nprint after\n", [
          { byte: 6, deleteBytes: 1, insert: ">" },
        ]),
        valid("cat > >(:)\nprint after\n"),
      );
      assert.equal(
        valid("cat > <(:)\nprint after\n", [
          { byte: 6, deleteBytes: 0, insert: '""' },
        ]),
        valid('cat > ""<(:)\nprint after\n'),
      );
    });

    test("repairing a parameter before the outer heredoc terminator matches fresh parsing", () => {
      assert.equal(
        valid("cat <<E\n${value\nE\nprint after\n", [
          { byte: 15, deleteBytes: 0, insert: "}" },
        ]),
        valid(`cat <<E\n\${value}\nE\nprint after\n`),
      );
    });

    test("repairing a function around a short condition and heredoc restores the body boundary", () => {
      const source = "function show { if ((1)) cat <<E\nbody\nE\nshow\n";
      assert.equal(
        valid(source, [
          { byte: source.lastIndexOf("show\n"), deleteBytes: 0, insert: "}\n" },
        ]),
        valid("function show { if ((1)) cat <<E\nbody\nE\n}\nshow\n"),
      );
    });
  });
}
