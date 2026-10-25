# tree-sitter-zsh

[![CI](https://github.com/konomanoasa/tree-sitter-zsh/actions/workflows/ci.yaml/badge.svg)](https://github.com/konomanoasa/tree-sitter-zsh/actions/workflows/ci.yaml)
[![crates.io](https://img.shields.io/crates/v/konomanoasa-tree-sitter-zsh)](https://crates.io/crates/konomanoasa-tree-sitter-zsh)
[![npm](https://img.shields.io/npm/v/@konomanoasa/tree-sitter-zsh)](https://www.npmjs.com/package/@konomanoasa/tree-sitter-zsh)

[Tree-sitter](https://tree-sitter.github.io/tree-sitter/) grammar for
Z Shell 5.9.2.

The package provides two languages from shared grammar and scanner sources:

| Language | `EXTENDED_GLOB` | Rust binding |
| --- | --- | --- |
| `zsh` (main) | Enabled | `LANGUAGE` |
| `zsh_default` | Disabled | `LANGUAGE_DEFAULT` |

Both use native Zsh syntax with `BARE_GLOB_QUAL` enabled and
`RE_MATCH_PCRE`, `C_PRECEDENCES`, `KSH_ARRAYS`, and `POSIX_IDENTIFIERS` disabled.
Source commands such as `setopt` and `emulate` do not change these parsing
conditions. The explicit `(*)` parameter substitution flag enables extended
patterns locally in both languages. Conditional regex operands use POSIX ERE.

The default variant's grammar and scanner are in `zsh_default/`; both variants
use `queries/highlights.scm`. Regenerate both parsers with `npm run generate`.

## Installation

```sh
npm install @konomanoasa/tree-sitter-zsh
```

## Development

```sh
npm install
npm run build
npm test
```

## Specification

[Zsh Manual, Version 5.9.2](https://zsh.sourceforge.io/Doc/Release/)

## Used By

[zsh-ts-mode](https://github.com/konomanoasa/zsh-ts-mode)

## License

[MIT](LICENSE)
