import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import load from "node-gyp-build";

const binding = load(fileURLToPath(new URL("../..", import.meta.url)));
const highlights = readFileSync(
  new URL("../../queries/highlights.scm", import.meta.url),
  "utf8",
);

function language(name, path) {
  const result = binding[name];
  result.nodeTypeInfo = JSON.parse(
    readFileSync(
      new URL(`../../${path}/src/node-types.json`, import.meta.url),
      "utf8",
    ),
  );
  result.HIGHLIGHTS_QUERY = highlights;
  return result;
}

export const zsh = language("zsh", ".");
export const zsh_extended_glob = language(
  "zsh_extended_glob",
  "zsh_extended_glob",
);
