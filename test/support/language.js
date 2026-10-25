import { grammars } from "../../scripts/tree-sitter.js";

const name = process.env.TREE_SITTER_TEST_LANGUAGE ?? "zsh";
export const language = grammars.find((grammar) => grammar.name === name);
if (!language) throw new Error(`Unknown test language: ${name}`);
