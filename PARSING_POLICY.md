# Parsing Policy

The parser analyzes source as written. It parses the following commands and
modifiers but does not apply their effects to parsing.

| Command or modifier                    | Effects not applied                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| `.`, `autoload`, `source`              | Loading another file or applying changes made by its execution.                |
| `alias`, `unalias`                     | Alias substitution or changes to alias definitions.                            |
| `disable`, `enable`                    | Changing which reserved words and other shell features are available.          |
| `emulate`, `set`, `setopt`, `unsetopt` | Changing parsing conditions in response to shell option settings or emulation. |
| `eval`                                 | Reparsing code constructed from its arguments.                                 |
| `noglob`                               | Suppressing pattern structure in subsequent words.                             |

Only `EXTENDED_GLOB` can be selected through the grammar. Use `zsh` for enabled
or `zsh_default` for disabled, for the whole document. Commands in the source
do not change this selection.
