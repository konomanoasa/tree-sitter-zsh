#define ZSH_EXTENDED_GLOB 1
#include "../../common/scanner.h"

void *tree_sitter_zsh_extended_glob_external_scanner_create(void) {
  return zsh_scanner_create();
}

void tree_sitter_zsh_extended_glob_external_scanner_destroy(void *payload) {
  zsh_scanner_destroy(payload);
}

unsigned tree_sitter_zsh_extended_glob_external_scanner_serialize(
  void *payload,
  char *buffer
) {
  return zsh_scanner_serialize(payload, buffer);
}

void tree_sitter_zsh_extended_glob_external_scanner_deserialize(
  void *payload,
  const char *buffer,
  unsigned length
) {
  zsh_scanner_deserialize(payload, buffer, length);
}

bool tree_sitter_zsh_extended_glob_external_scanner_scan(
  void *payload,
  TSLexer *lexer,
  const bool *valid_symbols
) {
  return zsh_scanner_scan(payload, lexer, valid_symbols);
}
