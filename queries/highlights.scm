[
  (literal)
  (single_quote_content)
  (double_quote_text)
  (dollar_single_quote_text)
  (here_document_text)
  (quoted_here_document_text)
  (array_key_text)
] @string

[
  (escaped_character)
  (double_quote_escape)
  (dollar_single_quote_escape)
  (here_document_escape)
] @string.escape

(comment_text) @comment

(io_number) @number

(regex_text) @string.regexp

[
  (always_keyword)
  (case_keyword)
  (coproc_keyword)
  (declare_keyword)
  (do_keyword)
  (done_keyword)
  (elif_keyword)
  (else_keyword)
  (end_keyword)
  (esac_keyword)
  (export_keyword)
  (fi_keyword)
  (float_keyword)
  (for_keyword)
  (foreach_keyword)
  (function_keyword)
  (if_keyword)
  (in_keyword)
  (integer_keyword)
  (local_keyword)
  (readonly_keyword)
  (repeat_keyword)
  (select_keyword)
  (then_keyword)
  (time_keyword)
  (typeset_keyword)
  (until_keyword)
  (while_keyword)
] @keyword

(precommand_modifier
  name: (precommand_modifier_name) @keyword.modifier)

(function_option) @keyword.modifier

[
  (and_if)
  (or_if)
  (pipe_err)
  (async_disown)
  (case_break)
  (case_fallthrough)
  (case_continue)
  (conditional_operator)
  (assignment_operator)
  (redirect_operator)
  (dless)
  (dlessdash)
  (here_string_operator)
] @operator

(pipeline
  [
    "!"
    "|"
  ] @operator)

(list
  "&" @operator)

";" @punctuation.delimiter

(single_quoted
  "'" @punctuation.delimiter)

(double_quoted
  "\"" @punctuation.delimiter)

(dollar_single_quoted
  [
    "$"
    "'"
  ] @punctuation.delimiter)

(backquote_substitution
  "`" @punctuation.delimiter)

(command_substitution
  "$" @punctuation.special)

(arithmetic_expansion
  "$" @punctuation.special)

(process_substitution
  [
    "<"
    ">"
    "="
  ] @operator)

[
  (brace_group
    [
      "{"
      "}"
    ] @punctuation.bracket)
  (subshell
    [
      "("
      ")"
    ] @punctuation.bracket)
  (command_substitution
    [
      "("
      ")"
    ] @punctuation.bracket)
  (process_substitution
    [
      "("
      ")"
    ] @punctuation.bracket)
  (function_definition
    [
      "("
      ")"
    ] @punctuation.bracket)
  (loop_words
    [
      "("
      ")"
    ] @punctuation.bracket)
  (case_clause
    [
      "{"
      "}"
    ] @punctuation.bracket)
  (conditional_command
    [
      "["
      "]"
    ] @punctuation.bracket)
  (conditional_group
    [
      "("
      ")"
    ] @punctuation.bracket)
  (arithmetic_command
    [
      "("
      ")"
    ] @punctuation.bracket)
  (arithmetic_expansion
    [
      "("
      ")"
      "["
      "]"
    ] @punctuation.bracket)
  (arithmetic_for_header
    [
      "("
      ")"
    ] @punctuation.bracket)
  (array_assignment
    [
      "("
      ")"
    ] @punctuation.bracket)
  (io_variable
    [
      "{"
      "}"
    ] @punctuation.bracket)
  (parameter_expansion
    [
      "{"
      "}"
    ] @punctuation.bracket)
  (parameter_flags
    [
      "("
      ")"
    ] @punctuation.bracket)
]

(pattern_list
  "(" @punctuation.bracket
  ")" @punctuation.bracket)

(arithmetic_source
  (arithmetic_number) @number)

(arithmetic_source
  (arithmetic_variable) @variable)

(arithmetic_source
  (arithmetic_operator) @operator)

(arithmetic_source
  (parenthesized_arithmetic
    [
      "("
      ")"
    ] @punctuation.bracket))

(arithmetic_source
  (arithmetic_function_source
    name: (arithmetic_function_name) @function.call))

(arithmetic_source
  (arithmetic_function_source
    [
      "("
      ")"
    ] @punctuation.bracket))

(assignment_word
  name: (variable_name) @variable)

(assignment_word
  name: (positional_parameter) @variable.parameter)

(array_element_key
  [
    "["
    "]"
  ] @punctuation.bracket)

(array_key_group
  [
    "("
    ")"
  ] @punctuation.bracket)

(dynamic_directory_name
  [
    "["
    "]"
  ] @punctuation.bracket)

(directory_name_group
  [
    "("
    ")"
  ] @punctuation.bracket)

(directory_name_text) @string.special.path

(io_variable
  name: (variable_name) @variable)

(for_clause
  name: (name) @variable)

(select_clause
  name: (name) @variable)

(parameter_expansion
  "$" @variable)

(parameter_expansion
  parameter: (variable_name) @variable)

(parameter_expansion
  parameter: (positional_parameter) @variable.parameter)

(parameter_expansion
  parameter: (special_parameter) @variable.builtin)

(parameter_expansion
  [
    (parameter_length_operator)
    (parameter_prefix_operator)
  ] @operator)

[
  (parameter_value_operator)
  (parameter_pattern_operator)
  (parameter_replacement_operator)
  (parameter_substring_operator)
] @operator

[
  (parameter_replacement_separator)
  (parameter_substring_separator)
] @punctuation.delimiter

(parameter_flag_name) @character.special

(parameter_flag
  (flag_argument
    (flag_argument_delimiter) @punctuation.delimiter))

(parameter_flag
  (flag_argument
    (flag_argument_source
      (flag_argument_text) @string)))

(parameter_expansion
  (parameter_modifier
    (modifier_name) @character.special))

(parameter_expansion
  (parameter_modifier
    (modifier_control
      name: (modifier_name) @character.special)))

(parameter_expansion
  (parameter_modifier
    [
      (modifier_prefix)
      (modifier_separator)
    ] @punctuation.delimiter))

(parameter_expansion
  (parameter_modifier
    (modifier_count) @number))

(parameter_expansion
  (parameter_modifier
    (modifier_control
      (flag_argument
        (flag_argument_delimiter) @punctuation.delimiter))))

(parameter_expansion
  (parameter_modifier
    (modifier_control
      (flag_argument
        (flag_argument_source
          (flag_argument_text) @string)))))

[
  (assignment_word
    subscript: (array_subscript
      [
        "["
        "]"
      ] @punctuation.bracket))
  (parameter_expansion
    subscript: (array_subscript
      [
        "["
        "]"
      ] @punctuation.bracket))
  (arithmetic_source
    (array_subscript
      [
        "["
        "]"
      ] @punctuation.bracket))
]

[
  (assignment_word
    subscript: (array_subscript
      (subscript_source
        (subscript_flags
          [
            "("
            ")"
          ] @punctuation.bracket))))
  (parameter_expansion
    subscript: (array_subscript
      (subscript_source
        (subscript_flags
          [
            "("
            ")"
          ] @punctuation.bracket))))
  (arithmetic_source
    (array_subscript
      (subscript_source
        (subscript_flags
          [
            "("
            ")"
          ] @punctuation.bracket))))
]

[
  (assignment_word
    subscript: (array_subscript
      (subscript_source
        (subscript_flags
          (subscript_flag
            (subscript_flag_name) @character.special)))))
  (parameter_expansion
    subscript: (array_subscript
      (subscript_source
        (subscript_flags
          (subscript_flag
            (subscript_flag_name) @character.special)))))
  (arithmetic_source
    (array_subscript
      (subscript_source
        (subscript_flags
          (subscript_flag
            (subscript_flag_name) @character.special)))))
]

[
  (assignment_word
    subscript: (array_subscript
      (subscript_source
        (subscript_flags
          (subscript_flag
            (flag_argument
              (flag_argument_delimiter) @punctuation.delimiter))))))
  (parameter_expansion
    subscript: (array_subscript
      (subscript_source
        (subscript_flags
          (subscript_flag
            (flag_argument
              (flag_argument_delimiter) @punctuation.delimiter))))))
  (arithmetic_source
    (array_subscript
      (subscript_source
        (subscript_flags
          (subscript_flag
            (flag_argument
              (flag_argument_delimiter) @punctuation.delimiter))))))
]

[
  (assignment_word
    subscript: (array_subscript
      (subscript_source
        (subscript_flags
          (subscript_flag
            (flag_argument
              (flag_argument_source
                (flag_argument_text) @string)))))))
  (parameter_expansion
    subscript: (array_subscript
      (subscript_source
        (subscript_flags
          (subscript_flag
            (flag_argument
              (flag_argument_source
                (flag_argument_text) @string)))))))
  (arithmetic_source
    (array_subscript
      (subscript_source
        (subscript_flags
          (subscript_flag
            (flag_argument
              (flag_argument_source
                (flag_argument_text) @string)))))))
]

[
  (pattern_star_source)
  (pattern_question_source)
] @character.special

(pattern_bracket_source
  [
    "["
    "]"
  ] @punctuation.bracket)

(pattern_group_source
  [
    "("
    ")"
  ] @punctuation.bracket)

(pattern_numeric_range_source
  [
    "<"
    ">"
  ] @punctuation.bracket)

(pattern_bracket_source
  [
    (pattern_negation)
    (pattern_range_operator)
  ] @operator)

(pattern_alternatives
  (pattern_alternation) @operator)

(pattern_numeric_range_source
  (pattern_range_operator) @operator)

(pattern_bracket_source
  (pattern_bracket_text) @string.regexp)

(pattern_bracket_source
  (pattern_character_range_source
    (pattern_range_operator) @operator))

(pattern_bracket_source
  (pattern_character_range_source
    (pattern_bracket_text) @string.regexp))

(pattern_bracket_source
  (pattern_character_class
    (pattern_class_delimiter) @string.regexp))

(pattern_bracket_source
  (pattern_character_class
    (pattern_class_source
      (pattern_class_text) @string.regexp)))

(pattern_numeric_range_source
  (pattern_number) @string.regexp)

(brace_expansion
  [
    "{"
    "}"
  ] @punctuation.bracket)

(brace_closing_source) @punctuation.bracket

(brace_separator) @punctuation.delimiter

(simple_command
  name: (word
    (literal) @function.call))

(function_definition
  name: (word
    (literal) @function))

(pattern_alternative
  (literal) @string.regexp)

(conditional_pattern
  (literal) @string.regexp)

(parameter_pattern
  (literal) @string.regexp)

[
  (tilde_expansion
    (literal) @string.special.path)
  (equals_expansion
    (literal) @string.special.path)
]

[
  (here_document_delimiter_quoted)
  (here_document_end_text)
] @label

(io_here
  here_end: (word
    (literal) @label))

[
  (io_here
    here_end: (word
      (single_quoted
        [
          "'"
          (single_quote_content)
        ] @label)))
  (io_here
    here_end: (word
      (double_quoted
        [
          "\""
          (double_quote_text)
        ] @label)))
  (io_here
    here_end: (word
      (dollar_single_quoted
        [
          "$"
          "'"
          (dollar_single_quote_text)
        ] @label)))
]

(line_continuation) @punctuation.special
