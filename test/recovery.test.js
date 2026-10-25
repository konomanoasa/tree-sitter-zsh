import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceNodes } from "./support/cst.js";
import { parse, valid } from "./support/parser.js";

function assertOutsideErrors(nodes, labels) {
  const errors = nodes.filter((node) => node.type === "ERROR");
  for (const label of labels) {
    const command = nodes.find(
      (node) => node.type === "simple_command" && node.text === `echo ${label}`,
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
    name: "a quoted parameter",
    body: `echo "\${x!bad}"\n`,
    owner: "parameter_expansion",
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
    name: "a body with stripped tabs",
    body: `cat <<-E\n\t\${x!bad}\n\tE\n`,
    ends: ["E"],
  },
  {
    name: "a following quoted document",
    body: `cat <<E <<'F'\n\${x!bad}\nE\n\${x!bad}\nF\n`,
    ends: ["E", "F"],
  },
  {
    name: "a document inside a quoted substitution",
    body: `echo "$(cat <<E\n\${x!bad}\nE\n)"\n`,
    ends: ["E"],
  },
  {
    name: "a document inside a process substitution",
    body: `cat <(cat <<E\n\${x!bad}\nE\n)\n`,
    ends: ["E"],
  },
  {
    name: "a document ending at a backquote",
    body: `echo \`cat <<E\n\${x!bad}\nE\`\n`,
    ends: ["E"],
  },
  {
    name: "nested documents",
    body: `cat <<OUTER\n$(cat <<E\n\${x!bad}\nE\n)\nOUTER\n`,
    ends: ["E", "OUTER"],
  },
  {
    name: "an outer end before an inner document end",
    body: `cat <<OUTER\n$(cat <<E\n\${x!bad}\nOUTER\n`,
    ends: ["OUTER"],
  },
  {
    name: "delimiter prefixes and continued body lines",
    body: `cat <<E\n\${x!bad}\nnotE\nE suffix\nx\\\nE\nE\n`,
    ends: ["E"],
  },
  {
    name: "a continued delimiter",
    body: `cat <<END\n\${x!bad}\nEN\\\nD\n`,
    ends: ["EN\\\nD"],
  },
  {
    name: "literal parameter spelling in a quoted document",
    body: `cat <<'E'\n\${x!bad}\nE\n`,
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

for (const { name, prefix, depth, tail } of [
  { name: "for headers", prefix: "for x in a; do\n", depth: 2, tail: ")\n" },
  {
    name: "select headers",
    prefix: "select x in a; do\n",
    depth: 2,
    tail: ")\n",
  },
  { name: "foreach headers", prefix: "foreach x (a)\n", depth: 3, tail: ")\n" },
  {
    name: "arithmetic for headers",
    prefix: "for ((x=0;x<1;x++)); do\n",
    depth: 2,
    tail: ")\n",
  },
  { name: "an if header", prefix: "if :; then\n", depth: 1, tail: ")\n" },
  { name: "a parameter head", prefix: "", depth: 0, tail: "echo ${x:-word\n" },
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
      before.slice(0, byte) + inserted + before.slice(byte + removed.length),
      after,
    );
    assert.equal(
      valid(before, [{ byte, deleteBytes: removed.length, insert: inserted }]),
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
