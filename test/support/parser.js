import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before } from "node:test";
import { createTreeSitter, root } from "../../scripts/tree-sitter.js";
import { assertSourceEnd } from "./cst.js";

export function createParser(language) {
  let runner;
  let library;
  let sequence = 0;
  before(() => {
    runner = createTreeSitter();
    library = join(
      runner.directory,
      `${language.name}.${process.platform === "win32" ? "dll" : "so"}`,
    );
    const result = runner.run([
      "build",
      join(root, language.path),
      "--output",
      library,
    ]);
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
  });
  after(() => runner?.close());

  function parse(source, edits = []) {
    const path = join(runner.directory, `${sequence++}.zsh`);
    writeFileSync(path, source);
    const args = [
      "parse",
      "--lib-path",
      library,
      "--lang-name",
      language.name,
      "--cst",
    ];
    if (edits.length)
      args.push(
        "--edits",
        ...edits.map(
          ({ byte, deleteBytes, insert }) => `${byte} ${deleteBytes} ${insert}`,
        ),
      );
    const result = runner.run([...args, "--", path]);
    assert.ifError(result.error);
    return {
      status: result.status,
      hasError: /^[0-9: \t-]+•/m.test(result.stdout),
      output: result.stdout,
      stderr: result.stderr,
    };
  }

  function valid(source, edits = []) {
    const result = parse(source, edits);
    assert.equal(result.status, 0, result.output + result.stderr);
    assert.equal(result.hasError, false, result.output + result.stderr);
    let bytes = Buffer.from(source);
    for (const { byte, deleteBytes, insert } of edits) {
      assert.ok(
        byte >= 0 && deleteBytes >= 0 && byte + deleteBytes <= bytes.length,
      );
      bytes = Buffer.concat([
        bytes.subarray(0, byte),
        Buffer.from(insert),
        bytes.subarray(byte + deleteBytes),
      ]);
    }
    assertSourceEnd(result.output, bytes);
    return result.output;
  }

  function parseSummary(source, expectedValid = true) {
    const path = join(runner.directory, `${sequence++}.zsh`);
    writeFileSync(path, source);
    const result = runner.run([
      "parse",
      "--lib-path",
      library,
      "--lang-name",
      language.name,
      "--quiet",
      "--json-summary",
      path,
    ]);
    assert.ifError(result.error);
    assert.ok(result.status === 0 || result.status === 1, result.stderr);
    const jsonStart = result.stdout.indexOf("{\n");
    assert.ok(jsonStart >= 0, result.stdout + result.stderr);
    const report = JSON.parse(result.stdout.slice(jsonStart));
    const [summary] = report.parse_summaries;
    assert.equal(report.source_count, 1);
    if (expectedValid) {
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(summary.successful, true, result.stdout);
    }
    assert.equal(summary.bytes, Buffer.byteLength(source));
    return summary;
  }

  return { parse, valid, parseSummary };
}
