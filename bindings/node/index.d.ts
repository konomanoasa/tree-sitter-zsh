import type { Language } from "tree-sitter";

type ZshLanguage = Language & {
  HIGHLIGHTS_QUERY: string;
};

export declare const zsh: ZshLanguage;
export declare const zsh_extended_glob: ZshLanguage;
