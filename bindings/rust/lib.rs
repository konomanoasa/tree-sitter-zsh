use tree_sitter_language::LanguageFn;

unsafe extern "C" {
  fn tree_sitter_zsh() -> *const ();
  fn tree_sitter_zsh_extended_glob() -> *const ();
}

pub const LANGUAGE: LanguageFn =
  unsafe { LanguageFn::from_raw(tree_sitter_zsh) };

pub const NODE_TYPES: &str = include_str!("../../src/node-types.json");

pub const HIGHLIGHTS_QUERY: &str = include_str!("../../queries/highlights.scm");

pub const LANGUAGE_EXTENDED_GLOB: LanguageFn =
  unsafe { LanguageFn::from_raw(tree_sitter_zsh_extended_glob) };
pub const NODE_TYPES_EXTENDED_GLOB: &str =
  include_str!("../../zsh_extended_glob/src/node-types.json");
