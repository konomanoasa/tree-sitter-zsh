# Parsing Policy

`zsh` parses source using [zsh 5.9.2](https://zsh.sourceforge.io/Doc/Release/) native default settings. To parse with
`EXTENDED_GLOB` enabled, use `zsh_extended_glob`. The selected grammar applies
to the whole document.

The following commands can affect how subsequent source is parsed. The parser
recognizes these commands but does not apply their effects.

| Command                                | Effects not applied                                              |
| -------------------------------------- | ---------------------------------------------------------------- |
| `alias`, `unalias`                     | Alias substitution or changes to alias definitions.              |
| `disable`, `enable`                    | Changes to the availability of reserved words or pattern syntax. |
| `emulate`, `set`, `setopt`, `unsetopt` | Changes to shell option settings or emulation.                   |

## Unresolved Syntax

The following parts depend on variable types, values, flags, functions, or
expansion results. Their surrounding syntax boundaries can still be determined,
so the parser analyzes the structure available from source and preserves the rest
as unresolved.

| Construct                     | Unresolved interpretation                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| Array assignments             | Key-value pairing and key interpretation based on array type.                       |
| Subscripts                    | Interpretation based on type and flags, including the role of commas.               |
| Arithmetic regions            | Token boundaries and expression structure dependent on expansion results.           |
| Arithmetic function arguments | Whether arguments are strings or arithmetic expressions, depending on the function. |
| Right-hand side of `=~`       | Regular expression structure determined by combining expansion results.             |
