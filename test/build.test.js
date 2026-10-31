import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  createTreeSitter,
  grammars,
  packageName,
  root,
} from "../scripts/tree-sitter.js";

const packTimeoutMs = 120_000;
const commandOutputBytes = 64 * 1024 * 1024;
const metadataOnly = {
  skip: Boolean(process.env.CI) && process.platform !== "darwin",
};

test("package and grammar metadata agree", metadataOnly, () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const config = JSON.parse(
    readFileSync(join(root, "tree-sitter.json"), "utf8"),
  );
  assert.equal(pkg.repository, `git+${config.metadata.links.repository}.git`);
  for (const key of ["version", "license", "description"])
    assert.equal(config.metadata[key], pkg[key]);
  assert.deepEqual(
    config.grammars.map(({ name }) => name),
    ["zsh", "zsh_extended_glob"],
  );
});

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: packTimeoutMs,
    maxBuffer: commandOutputBytes,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}

test(
  "generated files match the grammar and token definitions",
  metadataOnly,
  () => {
    run(process.execPath, ["scripts/check-generated.js"]);
  },
);

test("npm archives build both parsers with their shared scanner", () => {
  const cache = join(root, "node_modules", ".cache");
  mkdirSync(cache, { recursive: true });
  const directory = mkdtempSync(join(cache, `${packageName}-distribution-`));
  const runner = createTreeSitter();
  try {
    const npm = process.env.npm_execpath;
    assert.ok(npm, "Run distribution checks through npm test.");
    const [archive] = Object.values(
      JSON.parse(
        run(process.execPath, [
          npm,
          "pack",
          "--json",
          "--ignore-scripts",
          "--pack-destination",
          directory,
        ]),
      ),
    );
    for (const { path } of archive.files) {
      assert.doesNotMatch(
        path,
        /^(target|build|dist|node_modules|[.]git|[.]venv)[/]/,
      );
    }
    run("tar", ["-xf", archive.filename], directory);
    const source = join(directory, "sample.zsh");
    writeFileSync(source, "cat <<E\n$expanded\nE\n");
    for (const { name, path } of grammars) {
      const library = join(
        directory,
        `${name}.${process.platform === "win32" ? "dll" : "so"}`,
      );
      for (const args of [
        ["build", join(directory, "package", path), "--output", library],
        [
          "parse",
          "--quiet",
          "--lib-path",
          library,
          "--lang-name",
          name,
          source,
        ],
      ]) {
        const result = runner.run(args);
        assert.ifError(result.error);
        assert.equal(
          result.status,
          0,
          `${name}: ${result.stdout}${result.stderr}`,
        );
      }
    }
  } finally {
    runner.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
