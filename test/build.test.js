import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { root } from "../scripts/tree-sitter.js";

const packTimeoutMs = 60_000;

test("package and grammar metadata agree", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const config = JSON.parse(
    readFileSync(join(root, "tree-sitter.json"), "utf8"),
  );
  for (const key of ["version", "license", "description"])
    assert.equal(config.metadata[key], pkg[key]);
  assert.deepEqual(
    config.grammars.map(({ name }) => name),
    ["zsh", "zsh_extended_glob"],
  );
});

test("npm distribution contains the parser scanner queries and binding sources", () => {
  const result = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    {
      cwd: root,
      encoding: "utf8",
      shell: process.platform === "win32",
      timeout: packTimeoutMs,
    },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const [archive] = Object.values(JSON.parse(result.stdout));
  const files = new Set(archive.files.map(({ path }) => path));
  for (const path of [
    "grammar.js",
    "common/grammar.js",
    "common/scanner.h",
    "zsh_extended_glob/grammar.js",
    "zsh_extended_glob/src/parser.c",
    "zsh_extended_glob/src/scanner.c",
    "zsh_extended_glob/src/tokens.h",
    "zsh_extended_glob/src/node-types.json",
    "zsh_extended_glob/src/tree_sitter/parser.h",
    "zsh_extended_glob/src/tree_sitter/alloc.h",
    "tree-sitter.json",
    "src/parser.c",
    "src/scanner.c",
    "src/tokens.h",
    "common/tokens.json",
    "common/source.h",
    "common/input.h",
    "src/node-types.json",
    "src/tree_sitter/parser.h",
    "src/tree_sitter/alloc.h",
    "queries/highlights.scm",
    "bindings/rust/lib.rs",
    "bindings/rust/build.rs",
    "Cargo.toml",
    "README.md",
    "PARSING_POLICY.md",
    "LICENSE",
  ])
    assert.ok(files.has(path), `missing package file: ${path}`);
  for (const path of files)
    assert.doesNotMatch(path, /^(target|build|node_modules|\.git)[/]/);
});
