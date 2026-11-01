# Parsing Policy

`zsh` uses [zsh 5.9.2](https://zsh.sourceforge.io/Doc/Release/) native defaults.
`zsh_extended_glob` enables `EXTENDED_GLOB`.
The selected grammar applies to the whole document.

These commands are parsed without changing how subsequent source is parsed.

| Command                                | Effects not applied                       |
| -------------------------------------- | ----------------------------------------- |
| `alias`, `unalias`                     | Alias substitution and definitions.       |
| `disable`, `enable`                    | Reserved word and pattern syntax changes. |
| `emulate`, `set`, `setopt`, `unsetopt` | Shell option and emulation changes.       |

## Type-Dependent Syntax

Array assignments retain words without distinguishing elements from
associative array key-value pairs.

```zsh
items=(a b c d)
```

Subscripts retain arithmetic, range, and pattern candidates without assuming
a variable type.

```zsh
${items[1+2]}
```

Arithmetic function arguments retain arithmetic candidates without
distinguishing numeric from string arguments.

```zsh
$((f(1+2)))
```
