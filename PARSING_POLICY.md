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

## Type-Dependent Syntax

Array assignments preserve words without deciding whether they are array elements
or associative array key-value pairs.

```zsh
items=(a b c d)
```

Subscripts preserve arithmetic, range, and pattern candidates without assuming a
variable type. An arithmetic candidate may represent an index or an associative
array key.

```zsh
${items[1+2]}
```

Arithmetic function arguments preserve arithmetic candidates without deciding
whether the function takes numeric or string arguments.

```zsh
$((f(1+2)))
```
