import assert from "node:assert/strict";
import { test } from "node:test";
import { zsh, zsh_extended_glob } from "@konomanoasa/tree-sitter-zsh";
import Parser from "tree-sitter";

for (const { name, language } of [
  { name: "zsh", language: zsh },
  { name: "zsh_extended_glob", language: zsh_extended_glob },
]) {
  test(`Node.js ${name} parses here-documents with the scanner and exposes node metadata and highlights`, () => {
    const parser = new Parser();
    parser.setLanguage(language);
    const source = "# sample\ncat <<E\n$expanded\nE\n";
    const tree = parser.parse(source);
    assert.equal(tree.rootNode.type, "program");
    assert.equal(tree.rootNode.hasError, false);
    assert.equal(tree.rootNode.text, source);
    assert.ok(
      language.nodeTypeInfo.some(
        (node) => node.type === "program" && node.named,
      ),
    );
    const query = new Parser.Query(language, language.HIGHLIGHTS_QUERY);
    assert.deepEqual(
      query
        .captures(tree.rootNode)
        .filter(({ name }) => name === "comment")
        .map(({ name, node }) => [name, node.text]),
      [["comment", "# sample"]],
    );
  });
}
