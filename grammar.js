import tokens from "./src/tokens.json" with { type: "json" };

const lexeme = ($, name) => seq($[`_${name}`], repeat1($._piece));
const characters = {
  "'": "_character_single_quote",
  '"': "_character_double_quote",
  $: "_character_dollar",
  "(": "_character_left_paren",
  ")": "_character_right_paren",
  "`": "_character_backquote",
  "<": "_character_less",
  ">": "_character_greater",
  "=": "_character_equals",
  ";": "_character_semicolon",
  "&": "_character_ampersand",
  "|": "_character_pipe",
  "!": "_character_bang",
  "{": "_character_left_brace",
  "}": "_character_right_brace",
  "[": "_character_left_bracket",
  "]": "_character_right_bracket",
};
const punctuation = ($, name, spelling) =>
  seq(
    $[`_${name}`],
    repeat($._prefix),
    alias($[characters[spelling]], spelling),
  );

const terminated = ($, name) =>
  seq(
    repeat($._line),
    optional(field(name, alias($._terminated_list, $.list))),
  );

const condition = ($) => field("condition", alias($._condition_list, $.list));

const headerSeparator = ($) => field("separator", $.term);

const separated = (item, separator) =>
  choice(
    seq(item, repeat(seq(separator, optional(item)))),
    repeat1(seq(separator, optional(item))),
  );

const shortBraceBody = ($, sublist) =>
  prec(1, seq(alias(sublist, $.sublist), $._closed_body_end));

const nocorrectModifier = ($) =>
  alias($._nocorrect_modifier, $.precommand_modifier);

const commandModifiers = ($) =>
  seq(
    choice($.assignment_word, $.precommand_modifier),
    repeat(
      choice(
        $.assignment_word,
        $._argument_redirect,
        $.precommand_modifier,
        nocorrectModifier($),
      ),
    ),
  );

const commandWords = ($) =>
  seq(
    field("name", $.word),
    repeat(choice(field("argument", $.word), $._argument_redirect)),
  );

const commandBody = ($) =>
  choice(seq(commandModifiers($), optional(commandWords($))), commandWords($));

const redirected = ($, body) =>
  prec.right(seq(repeat($._redirect), body, repeat($._redirect)));

const redirection = ($, content) => seq(optional($.io_number), content);

const quotedParts = ($) => [
  $.escaped_character,
  $.single_quoted,
  $.double_quoted,
  $.dollar_single_quoted,
];

const expansions = ($) => [
  $.parameter_expansion,
  $.arithmetic_expansion,
  $.command_substitution,
  $.backquote_substitution,
];

// Sharing an aliased and unaliased rule makes query analysis expensive.
const bracedParameter = ($) =>
  seq(
    $._braced_parameter_head,
    optional($._parameter_tail),
    optional($.parameter_closing_source),
    $._parameter_close_source,
  );

const groupBody = ($) => [repeat($._line), optional(field("body", $.list))];

const groupContent = ($, open, close) => seq(open, ...groupBody($), close);

const subscriptGroup = ($, open, close) =>
  seq(open, optional($.subscript_source), close);

const arithmeticGroup = ($, source) =>
  seq(
    $._arithmetic_group_open_source,
    optional(source),
    $._arithmetic_group_close_source,
  );

const assignmentWord = ($, begin) =>
  seq(
    begin,
    $._assignment_header,
    choice(
      seq(optional(field("value", $.assignment_value)), $._assignment_end),
      field("value", $.array_assignment),
    ),
  );

const arraySubscript = ($, open) =>
  seq(
    open,
    optional(field("source", $.subscript_source)),
    $._subscript_close_source,
  );

const arithmeticParentheses = ($, begin) =>
  seq(
    begin,
    $._arithmetic_open_source,
    $._arithmetic_open_source,
    optional($.arithmetic_source),
    $._arithmetic_close_first_source,
    $._arithmetic_close_source,
    $._arithmetic_end,
  );

const caseTail = ($, last, close) =>
  seq(
    repeat($._term),
    repeat(seq(alias($._terminated_case_item, $.case_item), repeat($._term))),
    choice(
      seq(alias(last, $.case_item), close),
      $.esac_keyword,
      $._right_brace_source,
    ),
  );

const whileClause = ($, keyword) =>
  prec.right(
    seq(
      repeat($._redirect),
      keyword,
      choice(
        seq(
          terminated($, "condition"),
          choice(
            seq(field("body", $.do_group), repeat($._redirect)),
            $._short_condition_end,
          ),
        ),
        seq(
          condition($),
          optional(seq(field("body", $._short_body), repeat($._redirect))),
        ),
      ),
    ),
  );

const ifBranches = ($, keyword, braceTail) =>
  prec.right(
    choice(
      seq(
        field("branch", alias($[`_${keyword}_then_branch`], $.if_branch)),
        $._if_then_tail,
      ),
      prec(
        1,
        seq(
          field("branch", alias($[`_${keyword}_brace_branch`], $.if_branch)),
          braceTail,
        ),
      ),
      seq(
        field("branch", alias($[`_${keyword}_short_branch`], $.if_branch)),
        repeat($._redirect),
      ),
      field("branch", alias($[`_${keyword}_omitted_branch`], $.if_branch)),
    ),
  );

const loopBody = ($, short = $._short_body) =>
  prec.right(
    seq(field("body", choice($.do_group, short)), repeat($._redirect)),
  );

const forClause = ($) =>
  choice(
    seq($._for_header, optional(loopBody($))),
    seq(
      $._for_names,
      optional(seq(field("body", $.do_group), repeat($._redirect))),
    ),
    seq($._foreach_group_header, loopBody($, $._foreach_brace_body)),
    seq(
      $._foreach_header,
      terminated($, "body"),
      $.end_keyword,
      repeat($._redirect),
    ),
  );

const functionBody = ($, body, args) =>
  seq(field("body", body), $._function_body_end, ...(args ? [args] : []));

const functionNames = ($, redirects) =>
  seq(
    choice(field("name", $.word), $._precommand_function_names),
    repeat(
      redirects
        ? choice(field("name", $.word), $._argument_redirect)
        : field("name", $.word),
    ),
  );

const keywordFunctionTail = ($, anonymous) => {
  const body = (header, content, args = $._function_arguments) =>
    seq(header, functionBody($, content, anonymous ? args : undefined));
  return choice(
    prec(
      1,
      body(
        seq(optional($._function_parentheses), optional(headerSeparator($))),
        alias(
          anonymous ? $._header_brace_group_content : $._function_brace_group,
          $.brace_group,
        ),
      ),
    ),
    body(
      choice(
        seq($._function_parentheses, optional(headerSeparator($))),
        headerSeparator($),
        $._function_body_begin,
      ),
      $.sublist,
      $._inherited_function_arguments,
    ),
    seq(
      optional($._function_parentheses),
      optional(headerSeparator($)),
      $._function_body_end,
    ),
  );
};

const modifierOperation = ($, substitution) =>
  choice(
    seq(
      field("name", $.modifier_name),
      optional(field("argument", $.modifier_count)),
    ),
    substitution,
  );

const parameterModifier = ($, operation, candidate = false, glob = false) => {
  return seq(
    glob
      ? alias($._glob_modifier_prefix, $.modifier_prefix)
      : candidate
        ? alias($._candidate_modifier_prefix, $.modifier_prefix)
        : $.modifier_prefix,
    repeat(
      candidate
        ? alias($._candidate_modifier_control, $.modifier_control)
        : $.modifier_control,
    ),
    candidate ? optional(operation) : operation,
    $._modifier_end,
  );
};

const bracketNameSource = ($, text, group) =>
  repeat1(
    choice(
      text,
      group,
      ...quotedParts($),
      ...expansions($),
      $.process_substitution,
    ),
  );

const bracketName = ($, source) =>
  seq(
    $._array_key_open_source,
    optional(field("source", source)),
    $._array_key_close_source,
  );

const bracketNameGroup = ($, source) =>
  seq(
    $._array_key_group_open_source,
    optional(source),
    $._array_key_group_close_source,
  );

const modifierSubstitution = ($, operand, candidate = false) => {
  const replacement = seq(
    alias($._modifier_substitution_separator_source, $.modifier_separator),
    optional(field("replacement", operand)),
  );
  const pattern = seq(
    alias($._modifier_substitution_open_source, $.modifier_separator),
    optional(field("pattern", operand)),
    candidate ? optional(replacement) : replacement,
  );
  return seq(
    field("name", alias($._modifier_substitution_name_source, $.modifier_name)),
    candidate ? optional(pattern) : pattern,
  );
};

export default grammar({
  name: "zsh",
  externals: ($) => tokens.map((name) => $[`_${name}`]),
  extras: ($) => [
    $._unmatchable,
    $._layout_source,
    $.line_continuation,
    $._removed_newline,
    $._removed_source,
  ],
  inline: ($) => [
    $._logical_operator,
    $._separator,
    $._parameter_header,
    $._parameter_control_prefixes,
  ],
  conflicts: ($) => [
    [$.simple_command, $._parenthesized_function_names],
    [$.precommand_modifier, $._precommand_function_first_word],
    [$._loop_in_words, $._term],
    [$._foreach_words, $._foreach_group_header_end],
    [$._conditional_primary, $.conditional_binary_expression],
    [$._conditional_expression, $.conditional_and_expression],
    [$.conditional_and_expression, $.conditional_or_expression],
    [$.brace_expansion, $.brace_alternative],
    [$._brace_source_part, $.brace_sequence_source],
  ],
  rules: {
    program: ($) =>
      seq(repeat($._line), optional($.list), optional($._trailing_comment)),
    _unmatchable: () => token(seq(/[\s\S]/, /[^\s\S]/)),
    list: ($) => choice($.sublist, seq($._list_prefix, optional($.sublist))),
    _terminated_list: ($) =>
      choice(
        $._list_prefix,
        seq(optional($._list_prefix), $.sublist, $._control_end),
      ),
    _list_prefix: ($) =>
      choice(
        $._terminated_sublist,
        seq($._list_prefix, choice($._terminated_sublist, $._line)),
      ),
    _terminated_sublist: ($) =>
      choice(seq($.sublist, $._separator), $._semicolon_source),
    _condition_list: ($) =>
      seq(
        repeat($._line),
        optional($._list_prefix),
        $.sublist,
        $._short_condition_end,
      ),
    sublist: ($) =>
      prec.right(
        seq(
          $.pipeline,
          repeat(seq($._logical_operator, $.pipeline)),
          optional($._logical_operator),
        ),
      ),
    _logical_operator: ($) =>
      prec.right(seq(choice($.and_if, $.or_if), repeat($._term))),
    pipeline: ($) =>
      prec.right(
        choice(
          $._pipeline_commands,
          seq(
            choice($._negation_source, $.coproc_keyword),
            optional($._pipeline_commands),
          ),
        ),
      ),
    _pipeline_commands: ($) =>
      prec.right(
        seq(
          $.command,
          repeat(
            seq(choice($._pipe_source, $.pipe_err), repeat($._term), $.command),
          ),
        ),
      ),
    command: ($) => choice($.simple_command, $.complex_command),
    complex_command: ($) =>
      choice(
        $.brace_group,
        $.always_clause,
        $.subshell,
        $.if_clause,
        $.for_clause,
        $.while_clause,
        $.until_clause,
        $.repeat_clause,
        $.select_clause,
        $.function_definition,
        $.time_command,
        $.arithmetic_command,
        $.arithmetic_for_clause,
        $.conditional_command,
        $.case_clause,
      ),
    case_clause: ($) => redirected($, $._case_clause_content),
    _case_clause_content: ($) =>
      seq(
        $._case_selector,
        choice(
          seq($.in_keyword, $._case_tail),
          seq($._header_brace_open_source, $._brace_case_tail),
        ),
      ),
    _case_selector: ($) =>
      seq($.case_keyword, field("word", $.word), repeat($._term)),
    _case_tail: ($) => caseTail($, $._last_case_item, $.esac_keyword),
    _brace_case_tail: ($) =>
      caseTail($, $._last_brace_case_item, $._right_brace_source),
    _terminated_case_item: ($) =>
      seq(
        $._case_item_header,
        optional(field("body", $.list)),
        choice($.case_break, $.case_fallthrough, $.case_continue),
      ),
    _last_case_item: ($) =>
      seq(
        $._case_item_header,
        optional(field("body", alias($._terminated_list, $.list))),
      ),
    _last_brace_case_item: ($) =>
      seq($._case_item_header, optional(field("body", $.list))),
    _case_item_header: ($) => seq($.pattern_list, repeat($._line)),
    pattern_list: ($) =>
      seq(
        $._case_pattern_begin,
        optional($._case_pattern_open_source),
        optional($.pattern_alternatives),
        $._case_pattern_close_source,
      ),
    _case_pattern_open_source: ($) => punctuation($, "case_pattern_open", "("),
    _case_pattern_close_source: ($) =>
      punctuation($, "case_pattern_close", ")"),
    case_break: ($) => lexeme($, "case_break"),
    case_fallthrough: ($) => lexeme($, "case_fallthrough"),
    case_continue: ($) => lexeme($, "case_continue"),
    if_clause: ($) =>
      prec.right(
        seq(repeat($._redirect), ifBranches($, "if", $._if_brace_tail)),
      ),
    _if_branches: ($) => ifBranches($, "elif", $._if_brace_tail),
    _if_then_branches: ($) => ifBranches($, "elif", $._if_then_tail),
    _if_then_tail: ($) =>
      prec.right(
        choice(
          $._if_then_branches,
          seq(
            optional(field("alternative", $.else_clause)),
            $.fi_keyword,
            repeat($._redirect),
          ),
        ),
      ),
    _if_brace_tail: ($) =>
      prec.right(
        choice(
          $._if_branches,
          seq(
            optional(
              field("alternative", alias($._brace_else_clause, $.else_clause)),
            ),
            $._closed_body_end,
            repeat($._redirect),
          ),
        ),
      ),
    _brace_branch_content: ($) =>
      seq(
        condition($),
        field("body", alias($._header_brace_group, $.brace_group)),
      ),
    _short_branch_content: ($) =>
      seq(condition($), field("body", $.sublist), $._short_if_end),
    _omitted_branch_content: ($) =>
      choice(
        seq(condition($), $._short_if_end),
        seq(
          terminated($, "condition"),
          $._short_condition_end,
          $._short_if_end,
        ),
      ),
    ...Object.fromEntries(
      ["if", "elif"].flatMap((keyword) =>
        ["brace", "short", "omitted"].map((form) => [
          `_${keyword}_${form}_branch`,
          ($) => seq($[`${keyword}_keyword`], $[`_${form}_branch_content`]),
        ]),
      ),
    ),
    _if_then_header: ($) =>
      seq($.if_keyword, terminated($, "condition"), $.then_keyword),
    _elif_then_header: ($) =>
      seq($.elif_keyword, terminated($, "condition"), $.then_keyword),
    _if_then_branch: ($) => seq($._if_then_header, terminated($, "body")),
    _elif_then_branch: ($) => seq($._elif_then_header, terminated($, "body")),
    else_clause: ($) => seq($.else_keyword, terminated($, "body")),
    _brace_else_clause: ($) =>
      seq(
        $.else_keyword,
        field("body", alias($._header_brace_group, $.brace_group)),
      ),
    do_group: ($) => seq($.do_keyword, terminated($, "body"), $.done_keyword),
    while_clause: ($) => whileClause($, $.while_keyword),
    until_clause: ($) => whileClause($, $.until_keyword),
    for_clause: ($) => prec.right(seq(repeat($._redirect), forClause($))),
    _for_names: ($) => seq($.for_keyword, repeat1(field("name", $.name))),
    _for_header: ($) =>
      prec.right(
        seq(
          $._for_names,
          choice(
            seq(
              $._loop_in_words,
              choice(headerSeparator($), $._trailing_comment),
            ),
            headerSeparator($),
            seq(
              field("words", alias($._for_words, $.loop_words)),
              optional(headerSeparator($)),
            ),
          ),
        ),
      ),
    _foreach_header: ($) =>
      seq(
        $.foreach_keyword,
        repeat1(field("name", $.name)),
        field("words", alias($._foreach_words, $.loop_words)),
      ),
    _foreach_group_header: ($) =>
      prec.right(
        seq(
          $.foreach_keyword,
          repeat1(field("name", $.name)),
          field("words", alias($._foreach_group_words, $.loop_words)),
          optional(headerSeparator($)),
        ),
      ),
    _foreach_group_header_end: ($) => $._right_paren_source,
    _loop_in_words: ($) => seq(repeat($._line), field("words", $.loop_words)),
    loop_words: ($) => seq($.in_keyword, repeat(field("word", $.word))),
    _for_words: ($) =>
      seq(
        $._for_words_open_source,
        repeat(choice(field("word", $.word), $._term)),
        $._right_paren_source,
      ),
    _foreach_words: ($) =>
      seq(
        $._for_words_open_source,
        repeat(field("word", $.word)),
        $._right_paren_source,
      ),
    _foreach_group_words: ($) =>
      seq(
        $._for_words_open_source,
        repeat(field("word", $.word)),
        $._foreach_group_header_end,
      ),
    repeat_clause: ($) =>
      prec.right(
        seq(repeat($._redirect), $._repeat_header, optional(loopBody($))),
      ),
    _repeat_header: ($) =>
      prec.right(
        seq(
          $.repeat_keyword,
          field("count", alias($._count_word, $.word)),
          optional(headerSeparator($)),
        ),
      ),
    select_clause: ($) =>
      prec.right(seq(repeat($._redirect), $._select_header, loopBody($))),
    _select_header: ($) =>
      prec.right(
        seq(
          $.select_keyword,
          field("name", $.name),
          choice(
            seq($._loop_in_words, headerSeparator($)),
            optional(headerSeparator($)),
          ),
        ),
      ),
    function_definition: ($) => redirected($, $._function_definition_content),
    _function_definition_content: ($) =>
      prec.right(
        choice(
          seq(
            optional($._nocorrect_prefix),
            choice(
              seq(
                $._parenthesized_function_names,
                $._named_parenthesized_function_tail,
              ),
              seq(
                $._function_parentheses,
                optional(headerSeparator($)),
                $._anonymous_parenthesized_function_tail,
              ),
            ),
          ),
          seq(
            $._keyword_function_prefix,
            choice(
              seq($._function_names, $._named_keyword_function_tail),
              $._anonymous_keyword_function_tail,
            ),
          ),
        ),
      ),
    _keyword_function_prefix: ($) =>
      seq(
        $.function_keyword,
        optional($.function_option),
        optional(alias($._function_options_end_source, $.function_option)),
      ),
    _named_parenthesized_function_tail: ($) =>
      prec.right(
        seq(
          $._function_open_source,
          $._right_paren_source,
          optional(headerSeparator($)),
          functionBody(
            $,
            choice(
              prec(1, alias($._named_brace_command, $.command)),
              $.command,
            ),
          ),
        ),
      ),
    _anonymous_parenthesized_function_tail: ($) =>
      prec.right(
        choice(
          functionBody(
            $,
            choice(
              prec(1, alias($._header_brace_group_content, $.brace_group)),
              prec(1, alias($._function_subshell_command, $.command)),
            ),
            $._parenthesized_function_arguments,
          ),
          functionBody(
            $,
            $.command,
            $._inherited_parenthesized_function_arguments,
          ),
        ),
      ),
    _named_keyword_function_tail: ($) =>
      prec.right(keywordFunctionTail($, false)),
    _anonymous_keyword_function_tail: ($) =>
      prec.right(keywordFunctionTail($, true)),
    _short_body: ($) =>
      choice(shortBraceBody($, $._short_brace_sublist), $.sublist),
    _foreach_brace_body: ($) => shortBraceBody($, $._foreach_brace_sublist),
    _foreach_brace_sublist: ($) => alias($._foreach_brace_pipeline, $.pipeline),
    _foreach_brace_pipeline: ($) => alias($._foreach_brace_command, $.command),
    _foreach_brace_command: ($) =>
      alias($._foreach_brace_complex_command, $.complex_command),
    _foreach_brace_complex_command: ($) =>
      alias($._brace_group_content, $.brace_group),
    _short_brace_sublist: ($) => alias($._short_brace_pipeline, $.pipeline),
    _short_brace_pipeline: ($) => alias($._short_brace_command, $.command),
    _short_brace_command: ($) =>
      alias($._short_brace_complex_command, $.complex_command),
    _short_brace_complex_command: ($) =>
      alias($._header_brace_group_content, $.brace_group),
    _named_brace_command: ($) =>
      alias($._named_brace_complex_command, $.complex_command),
    _named_brace_complex_command: ($) =>
      alias($._function_brace_group, $.brace_group),
    _function_subshell_command: ($) =>
      alias($._function_subshell_complex_command, $.complex_command),
    _function_subshell_complex_command: ($) =>
      alias($._function_subshell, $.subshell),
    _function_subshell: ($) =>
      prec.right(1, seq($._subshell_content, repeat($._redirect))),
    _inherited_function_arguments: ($) =>
      seq(
        $._function_arguments_resume,
        repeat(field("argument", alias($._function_argument, $.word))),
        repeat($._redirect),
        $._function_arguments_end,
      ),
    _inherited_parenthesized_function_arguments: ($) =>
      seq(
        $._function_arguments_resume,
        repeat(choice(field("argument", $.word), $._redirect)),
        $._function_arguments_end,
      ),
    _function_brace_group: ($) =>
      prec.right(seq($._header_brace_group_content, repeat($._redirect))),
    _function_parentheses: ($) =>
      seq($._function_open_source, $._right_paren_source),
    _function_arguments: ($) =>
      seq(
        $._function_arguments_begin,
        repeat(field("argument", $.word)),
        repeat($._redirect),
        $._function_arguments_end,
      ),
    _parenthesized_function_arguments: ($) =>
      seq(
        $._function_arguments_begin,
        repeat(choice(field("argument", $.word), $._redirect)),
        $._function_arguments_end,
      ),
    function_option: ($) => lexeme($, "function_option"),
    _function_options_end_source: ($) => lexeme($, "function_options_end"),
    _function_open_source: ($) => punctuation($, "function_open", "("),
    _for_words_open_source: ($) => punctuation($, "for_words_open", "("),
    _function_names: ($) => functionNames($, false),
    _parenthesized_function_names: ($) => functionNames($, true),
    _precommand_function_names: ($) =>
      seq(
        field("name", alias($._precommand_function_first_word, $.word)),
        repeat(
          choice(
            seq($._precommand_option_begin, field("name", $.word)),
            seq($._precommand_operand_begin, field("name", $.word)),
          ),
        ),
        $._precommand_end,
      ),
    _precommand_function_first_word: ($) =>
      alias(
        choice(
          $._precommand_plain_name_source,
          $._precommand_exec_name_source,
          $._precommand_command_name_source,
        ),
        $.literal,
      ),
    always_clause: ($) =>
      redirected(
        $,
        seq(
          field("body", alias($._brace_group_content, $.brace_group)),
          $.always_keyword,
          repeat($._term),
          field("always", alias($._brace_group_content, $.brace_group)),
        ),
      ),
    time_command: ($) =>
      prec.right(
        seq(
          repeat($._redirect),
          $.time_keyword,
          optional(field("pipeline", $.pipeline)),
          $._time_end,
        ),
      ),
    arithmetic_for_clause: ($) =>
      prec.right(
        seq(
          repeat($._redirect),
          $._arithmetic_for_clause_header,
          optional(loopBody($)),
        ),
      ),
    _arithmetic_for_clause_header: ($) =>
      prec.right(
        seq(
          $.for_keyword,
          field("header", $.arithmetic_for_header),
          optional(headerSeparator($)),
        ),
      ),
    arithmetic_for_header: ($) =>
      seq(
        $._arithmetic_for_begin,
        $._arithmetic_open_source,
        $._arithmetic_open_source,
        optional(field("initializer", $.arithmetic_source)),
        $._semicolon_source,
        optional(field("condition", $.arithmetic_source)),
        $._semicolon_source,
        optional(field("update", $.arithmetic_source)),
        $._arithmetic_close_first_source,
        $._arithmetic_close_source,
        $._arithmetic_end,
      ),
    arithmetic_command: ($) => redirected($, $._arithmetic_parentheses),
    _arithmetic_parentheses: ($) =>
      arithmeticParentheses($, $._arithmetic_begin),
    _arithmetic_expansion_parentheses: ($) =>
      arithmeticParentheses($, $._arithmetic_expression_begin),
    arithmetic_expansion: ($) =>
      seq(
        $._arithmetic_dollar_source,
        choice(
          $._arithmetic_expansion_parentheses,
          seq(
            $._arithmetic_square_open_source,
            optional($.arithmetic_source),
            $._arithmetic_square_close_source,
          ),
        ),
      ),
    _parenthesized_arithmetic_expansion: ($) =>
      seq($._arithmetic_dollar_source, $._arithmetic_expansion_parentheses),
    arithmetic_source: ($) =>
      repeat1(choice($._arithmetic_part, $.parenthesized_arithmetic)),
    _arithmetic_part: ($) =>
      choice(
        $.arithmetic_number,
        $.arithmetic_variable,
        $.arithmetic_operator,
        $.arithmetic_function_source,
        $.array_subscript,
        $.arithmetic_source_fragment,
        $.escaped_character,
        ...expansions($),
      ),
    parenthesized_arithmetic: ($) => arithmeticGroup($, $.arithmetic_source),
    arithmetic_function_source: ($) =>
      seq(
        field("name", $.arithmetic_function_name),
        $._arithmetic_function_open_source,
        optional(field("arguments", $.arithmetic_argument_source)),
        $._arithmetic_function_close_source,
      ),
    arithmetic_argument_source: ($) =>
      repeat1(
        choice(
          $._arithmetic_part,
          alias(
            $._parenthesized_arithmetic_argument,
            $.parenthesized_arithmetic,
          ),
        ),
      ),
    _parenthesized_arithmetic_argument: ($) =>
      arithmeticGroup($, $.arithmetic_argument_source),
    arithmetic_number: ($) => lexeme($, "arithmetic_number"),
    arithmetic_variable: ($) => lexeme($, "arithmetic_variable"),
    arithmetic_operator: ($) => lexeme($, "arithmetic_operator"),
    arithmetic_function_name: ($) => lexeme($, "arithmetic_function_name"),
    arithmetic_source_fragment: ($) => lexeme($, "arithmetic_source_fragment"),
    conditional_command: ($) => redirected($, $._conditional_command_content),
    _conditional_command_content: ($) =>
      seq(
        $._condition_begin,
        $._condition_open_source,
        $._condition_open_source,
        repeat($.comment),
        field("condition", $._conditional_expression),
        repeat($.comment),
        $._condition_close_first_source,
        $._condition_close_source,
      ),
    _conditional_expression: ($) =>
      choice($.conditional_or_expression, $._conditional_and),
    _conditional_and: ($) =>
      choice($.conditional_and_expression, $._conditional_not),
    _conditional_not: ($) =>
      choice($.conditional_negation, $._conditional_primary),
    _conditional_primary: ($) =>
      choice(
        $.word,
        $.conditional_unary_expression,
        $.conditional_binary_expression,
        $.conditional_group,
      ),
    conditional_unary_expression: ($) =>
      prec.right(
        seq(
          alias($._condition_unary_operator_source, $.conditional_operator),
          repeat($.comment),
          repeat(prec.right(seq(field("operand", $.word), repeat($.comment)))),
        ),
      ),
    conditional_binary_expression: ($) =>
      seq(
        field("left", $.word),
        repeat($.comment),
        choice(
          seq(
            alias($._condition_binary_operator_source, $.conditional_operator),
            repeat($.comment),
            field("right", $.word),
          ),
          seq(
            alias($._condition_pattern_operator_source, $.conditional_operator),
            repeat($.comment),
            field("right", $.conditional_pattern),
          ),
          seq(
            alias($._condition_regex_operator_source, $.conditional_operator),
            repeat($.comment),
            field("right", $.regex_operand),
          ),
        ),
      ),
    conditional_negation: ($) =>
      seq(
        alias($._condition_not_source, $.conditional_operator),
        repeat($.comment),
        field("operand", $._conditional_not),
      ),
    conditional_and_expression: ($) =>
      seq(
        field("left", $._conditional_and),
        repeat($.comment),
        alias($.and_if, $.conditional_operator),
        repeat($.comment),
        field("right", $._conditional_not),
      ),
    conditional_or_expression: ($) =>
      seq(
        field("left", $._conditional_expression),
        repeat($.comment),
        alias($.or_if, $.conditional_operator),
        repeat($.comment),
        field("right", $._conditional_and),
      ),
    conditional_group: ($) =>
      seq(
        $._condition_group_open_source,
        repeat($.comment),
        field("condition", $._conditional_expression),
        repeat($.comment),
        $._condition_group_close_source,
      ),
    conditional_pattern: ($) => seq($._word_begin, $._word_source, $._word_end),
    _condition_unary_operator_source: ($) =>
      lexeme($, "condition_unary_operator"),
    _condition_binary_operator_source: ($) =>
      lexeme($, "condition_binary_operator"),
    _condition_pattern_operator_source: ($) =>
      lexeme($, "condition_pattern_operator"),
    _condition_regex_operator_source: ($) =>
      lexeme($, "condition_regex_operator"),
    _condition_not_source: ($) => lexeme($, "condition_not"),
    regex_operand: ($) =>
      seq($._regex_begin, field("source", $.regex_source), $._regex_end),
    regex_source: ($) =>
      repeat1(
        choice(
          $.regex_text,
          $.process_substitution,
          ...quotedParts($),
          ...expansions($),
        ),
      ),
    regex_text: ($) => lexeme($, "regex_text"),
    name: ($) => lexeme($, "name"),
    pipe_err: ($) => lexeme($, "pipe_err"),
    async_disown: ($) => lexeme($, "async_disown"),
    _negation_source: ($) => punctuation($, "negation", "!"),
    _term: ($) => choice($._semicolon_source, $._line),
    term: ($) => prec.right(seq(repeat1($._term), $._header_separator_end)),
    simple_command: ($) =>
      prec.right(
        choice(
          $.declaration_command,
          seq(
            repeat1($._redirect),
            optional($._nocorrect_prefix),
            optional(commandBody($)),
          ),
          seq($._nocorrect_prefix, optional(commandBody($))),
          commandBody($),
        ),
      ),
    precommand_modifier: ($) =>
      seq(
        field(
          "name",
          choice(
            alias($._precommand_plain_name_source, $.precommand_modifier_name),
            alias($._precommand_exec_name_source, $.precommand_modifier_name),
            alias(
              $._precommand_command_name_source,
              $.precommand_modifier_name,
            ),
          ),
        ),
        repeat(
          choice(
            seq($._precommand_option_begin, field("option", $.word)),
            seq($._precommand_operand_begin, field("operand", $.word)),
            $._argument_redirect,
          ),
        ),
        $._precommand_end,
      ),
    _nocorrect_prefix: ($) =>
      prec.right(
        seq(
          nocorrectModifier($),
          repeat(choice(nocorrectModifier($), $._redirect)),
        ),
      ),
    _nocorrect_modifier: ($) =>
      field(
        "name",
        alias($._precommand_nocorrect_name_source, $.precommand_modifier_name),
      ),
    _precommand_nocorrect_name_source: ($) =>
      lexeme($, "precommand_nocorrect_name"),
    _precommand_plain_name_source: ($) => lexeme($, "precommand_plain_name"),
    _precommand_exec_name_source: ($) => lexeme($, "precommand_exec_name"),
    _precommand_command_name_source: ($) =>
      lexeme($, "precommand_command_name"),
    declaration_command: ($) =>
      prec.right(
        seq(
          repeat($._redirect),
          optional($._nocorrect_prefix),
          optional(commandModifiers($)),
          choice(
            $.declare_keyword,
            $.export_keyword,
            $.float_keyword,
            $.integer_keyword,
            $.local_keyword,
            $.readonly_keyword,
            $.typeset_keyword,
          ),
          repeat(
            choice(
              alias($._declaration_assignment_word, $.assignment_word),
              field("argument", $.word),
              $._argument_redirect,
            ),
          ),
        ),
      ),
    _declaration_assignment_word: ($) =>
      assignmentWord($, $._declaration_assignment_begin),
    assignment_word: ($) => assignmentWord($, $._assignment_begin),
    _assignment_header: ($) =>
      seq(
        field("name", choice($.variable_name, $.positional_parameter)),
        optional(field("subscript", $.array_subscript)),
        $.assignment_operator,
      ),
    assignment_operator: ($) => lexeme($, "assignment_operator"),
    assignment_value: ($) => $._word_source,
    array_assignment: ($) =>
      seq(
        $._array_open_source,
        repeat(choice($.word, $.array_element_assignment, $._term)),
        $._array_close_source,
      ),
    array_element_assignment: ($) =>
      seq(
        $._array_element_begin,
        field("key", $.array_element_key),
        $.assignment_operator,
        optional(field("value", $.assignment_value)),
        $._array_element_end,
      ),
    array_element_key: ($) => bracketName($, $.array_key_source),
    array_key_source: ($) =>
      bracketNameSource($, $.array_key_text, $.array_key_group),
    array_key_group: ($) => bracketNameGroup($, $.array_key_source),
    array_key_text: ($) => lexeme($, "array_key_text"),
    _array_key_open_source: ($) => punctuation($, "array_key_open", "["),
    _array_key_close_source: ($) => punctuation($, "array_key_close", "]"),
    _array_key_group_open_source: ($) =>
      punctuation($, "array_key_group_open", "("),
    _array_key_group_close_source: ($) =>
      punctuation($, "array_key_group_close", ")"),
    array_subscript: ($) => arraySubscript($, $._subscript_open_source),
    subscript_source: ($) =>
      repeat1(
        choice(
          $.subscript_flags,
          $.subscript_group,
          $.subscript_comma,
          alias($.arithmetic_number, $.subscript_number_candidate),
          alias($.arithmetic_variable, $.subscript_name_candidate),
          alias($.arithmetic_operator, $.subscript_operator_candidate),
          $.subscript_text,
          ...quotedParts($),
          ...expansions($),
        ),
      ),
    subscript_text: ($) => lexeme($, "subscript_text"),
    subscript_comma: ($) => lexeme($, "subscript_comma"),
    subscript_flags: ($) =>
      seq(
        $._subscript_flags_open_source,
        repeat($.subscript_flag),
        $._subscript_flags_close_source,
      ),
    subscript_flag: ($) =>
      prec.right(
        seq($.subscript_flag_name, repeat(field("argument", $.flag_argument))),
      ),
    subscript_flag_name: ($) => lexeme($, "subscript_flag_name"),
    subscript_group: ($) =>
      choice(
        subscriptGroup(
          $,
          $._subscript_paren_open_source,
          $._subscript_paren_close_source,
        ),
        subscriptGroup(
          $,
          $._subscript_bracket_open_source,
          $._subscript_bracket_close_source,
        ),
        subscriptGroup(
          $,
          $._subscript_brace_open_source,
          $._subscript_brace_close_source,
        ),
      ),
    _array_open_source: ($) => punctuation($, "array_open", "("),
    _array_close_source: ($) => punctuation($, "array_close", ")"),
    _subscript_open_source: ($) => punctuation($, "subscript_open", "["),
    _subscript_close_source: ($) => punctuation($, "subscript_close", "]"),
    subshell: ($) => redirected($, $._subshell_content),
    _subshell_content: ($) =>
      groupContent($, $._left_paren_source, $._right_paren_source),
    brace_group: ($) => redirected($, $._brace_group_content),
    _brace_group_content: ($) =>
      groupContent($, $._left_brace_source, $._right_brace_source),
    _header_brace_group: ($) => redirected($, $._header_brace_group_content),
    _header_brace_group_content: ($) =>
      groupContent($, $._header_brace_open_source, $._right_brace_source),
    word: ($) => seq($._word_prefix, $._word_end),
    _word_prefix: ($) =>
      choice(
        seq($._word_begin, $._word_part),
        seq($._word_prefix, $._word_part),
      ),
    _function_argument: ($) =>
      seq($._function_argument_begin, $._word_source, $._word_end),
    _redirect_word: ($) =>
      seq($._redirect_word_begin, $._word_source, $._word_end),
    _file_redirect_word: ($) =>
      seq(
        $._redirect_word_begin,
        choice(
          $.process_substitution,
          seq($._non_process_word_part, repeat($._word_part)),
        ),
        $._word_end,
      ),
    _count_word: ($) => seq($._count_word_begin, $._word_source, $._word_end),
    _word_source: ($) => repeat1($._word_part),
    _word_part: ($) => choice($._non_process_word_part, $.process_substitution),
    _non_process_word_part: ($) =>
      choice($._ordinary_word_part, $.brace_separator),
    _ordinary_word_part: ($) =>
      choice(
        $.here_document_delimiter_quoted,
        $.literal,
        $.pattern_star_source,
        $.pattern_question_source,
        $.pattern_bracket_source,
        $.pattern_group_source,
        $.pattern_numeric_range_source,
        $.pattern_candidate,
        $.glob_qualifier_candidate,
        $.brace_expansion,
        $.brace_closing_source,
        $.tilde_expansion,
        $.equals_expansion,
        ...quotedParts($),
        ...expansions($),
      ),
    pattern_star_source: ($) => lexeme($, "pattern_star"),
    tilde_expansion: ($) =>
      choice(
        alias($._tilde_source_content, $.literal),
        seq(
          alias($._dynamic_tilde_source_content, $.literal),
          $.dynamic_directory_name,
        ),
      ),
    dynamic_directory_name: ($) => bracketName($, $.directory_name_source),
    directory_name_source: ($) =>
      bracketNameSource($, $.directory_name_text, $.directory_name_group),
    directory_name_group: ($) => bracketNameGroup($, $.directory_name_source),
    directory_name_text: ($) => lexeme($, "array_key_text"),
    equals_expansion: ($) => alias($._equals_source_content, $.literal),
    _tilde_source_content: ($) => lexeme($, "tilde_source"),
    _dynamic_tilde_source_content: ($) => lexeme($, "dynamic_tilde_source"),
    _equals_source_content: ($) => lexeme($, "equals_source"),
    pattern_question_source: ($) => lexeme($, "pattern_question"),
    pattern_bracket_source: ($) =>
      seq(
        $._pattern_bracket_open_source,
        optional($.pattern_negation),
        repeat1(
          choice(
            $.pattern_character_range_source,
            $.pattern_bracket_text,
            $.pattern_range_operator,
            $.pattern_character_class,
            $.brace_expansion,
            $.brace_closing_source,
            $.brace_separator,
            $.pattern_group_source,
            ...quotedParts($),
            ...expansions($),
            $.process_substitution,
          ),
        ),
        $._pattern_bracket_close_source,
      ),
    pattern_bracket_text: ($) => lexeme($, "pattern_bracket_text"),
    pattern_character_range_source: ($) =>
      seq(
        field(
          "start",
          alias($._pattern_range_start_source, $.pattern_bracket_text),
        ),
        $.pattern_range_operator,
        field(
          "end",
          alias($._pattern_range_end_source, $.pattern_bracket_text),
        ),
      ),
    _pattern_range_start_source: ($) => lexeme($, "pattern_range_start"),
    _pattern_range_end_source: ($) => lexeme($, "pattern_range_end"),
    pattern_negation: ($) => lexeme($, "pattern_negation"),
    pattern_range_operator: ($) => lexeme($, "pattern_range_operator"),
    pattern_character_class: ($) =>
      seq(
        alias($._pattern_class_open_source, $.pattern_class_delimiter),
        optional($.pattern_class_source),
        alias($._pattern_class_close_source, $.pattern_class_delimiter),
      ),
    _pattern_class_open_source: ($) => lexeme($, "pattern_class_open"),
    _pattern_class_close_source: ($) => lexeme($, "pattern_class_close"),
    pattern_class_source: ($) =>
      bracketNameSource($, $.pattern_class_text, $._pattern_class_group),
    _pattern_class_group: ($) =>
      choice(
        $.brace_expansion,
        $.brace_closing_source,
        $.brace_separator,
        $.pattern_group_source,
      ),
    pattern_class_text: ($) => lexeme($, "pattern_class_text"),
    pattern_group_source: ($) =>
      seq(
        $._pattern_group_open_source,
        optional($.pattern_alternatives),
        choice($._pattern_group_close_source, $._pattern_group_end),
      ),
    pattern_alternatives: ($) =>
      separated($.pattern_alternative, $.pattern_alternation),
    pattern_alternative: ($) => repeat1($._word_part),
    pattern_alternation: ($) => lexeme($, "pattern_alternation"),
    pattern_candidate: ($) =>
      choice(
        $.pattern_candidate_operator,
        seq(
          $._pattern_candidate_open_source,
          optional($.pattern_candidate_source),
          choice($._pattern_candidate_close_source, $._pattern_group_end),
        ),
      ),
    pattern_candidate_operator: ($) => lexeme($, "pattern_candidate_operator"),
    glob_qualifier_candidate: ($) =>
      seq(
        $._glob_qualifier_open_source,
        optional($._glob_qualifier_lists),
        optional($._glob_modifier_tail),
        $._glob_qualifier_close_source,
      ),
    _glob_qualifier_lists: ($) =>
      separated($.glob_qualifier_list_candidate, $.glob_qualifier_separator),
    glob_qualifier_list_candidate: ($) => repeat1($._candidate_part),
    _glob_modifier_tail: ($) =>
      seq(
        $.glob_modifier_candidate,
        repeat(
          choice(
            $.glob_modifier_candidate,
            $._candidate_part,
            $.glob_qualifier_separator,
          ),
        ),
      ),
    pattern_candidate_source: ($) =>
      choice(
        repeat1($._pattern_candidate_part),
        seq(
          repeat($._pattern_candidate_part),
          alias($._glob_qualifier_flag, $.glob_flag_candidate),
          optional($._glob_qualifier_lists),
          optional($._glob_modifier_tail),
        ),
      ),
    _pattern_candidate_part: ($) =>
      choice(
        $._candidate_part,
        $.pattern_flags_prefix,
        $.glob_modifier_candidate,
      ),
    _candidate_part: ($) =>
      choice(
        $.pattern_candidate_text,
        $.glob_flag_candidate,
        $.glob_argument_candidate,
        ...quotedParts($),
        ...expansions($),
        $.pattern_candidate_group,
        $.process_substitution,
        $.brace_expansion,
        $.brace_closing_source,
        $.brace_separator,
      ),
    _glob_qualifier_flag: ($) =>
      field(
        "name",
        alias($._glob_qualifier_flag_name_source, $.glob_flag_name),
      ),
    _glob_qualifier_flag_name_source: ($) =>
      lexeme($, "glob_qualifier_flag_name"),
    pattern_candidate_group: ($) =>
      seq(
        $._pattern_candidate_open_source,
        optional($.pattern_candidate_source),
        choice($._pattern_candidate_close_source, $._pattern_group_end),
      ),
    pattern_candidate_text: ($) => lexeme($, "pattern_candidate_text"),
    pattern_flags_prefix: ($) => lexeme($, "pattern_flags_prefix"),
    glob_flag_candidate: ($) =>
      prec.right(
        seq(
          field("name", $.glob_flag_name),
          optional(field("argument", $.glob_argument_candidate)),
        ),
      ),
    glob_flag_name: ($) => lexeme($, "glob_flag_name"),
    glob_qualifier_separator: ($) => lexeme($, "glob_qualifier_separator"),
    glob_argument_candidate: ($) =>
      seq(
        $._glob_argument_begin,
        choice(
          seq(
            alias($._glob_argument_open_source, $.glob_argument_delimiter),
            optional($.glob_argument_source),
            choice(
              alias($._glob_argument_close_source, $.glob_argument_delimiter),
              $._glob_argument_end,
            ),
          ),
          seq($.glob_argument_source, $._glob_argument_end),
        ),
      ),
    _glob_argument_open_source: ($) => lexeme($, "glob_argument_open"),
    _glob_argument_close_source: ($) => lexeme($, "glob_argument_close"),
    glob_argument_source: ($) =>
      bracketNameSource(
        $,
        $.glob_argument_text,
        choice(
          $.pattern_candidate_group,
          $.brace_expansion,
          $.brace_closing_source,
          $.brace_separator,
        ),
      ),
    glob_argument_text: ($) => lexeme($, "glob_argument_text"),
    glob_modifier_candidate: ($) =>
      parameterModifier(
        $,
        modifierOperation($, $._candidate_modifier_substitution),
        true,
        true,
      ),
    pattern_numeric_range_source: ($) =>
      seq(
        $._numeric_range_open_source,
        optional(field("start", $.pattern_number)),
        $.pattern_range_operator,
        optional(field("end", $.pattern_number)),
        $._numeric_range_close_source,
      ),
    pattern_number: ($) => lexeme($, "pattern_number"),
    brace_expansion: ($) =>
      seq(
        $._brace_expansion_open_source,
        optional(
          choice(
            $._brace_choices,
            $.brace_sequence_source,
            $._brace_unclassified_source,
          ),
        ),
        choice($._brace_expansion_close_source, $._brace_expansion_end),
      ),
    _brace_choices: ($) =>
      seq(
        optional($.brace_alternative),
        repeat1(
          seq(
            alias($._brace_comma_source, $.brace_separator),
            optional($.brace_alternative),
          ),
        ),
      ),
    brace_alternative: ($) => repeat1($._brace_source_part),
    _brace_unclassified_source: ($) => repeat1($._brace_source_part),
    _brace_source_part: ($) =>
      choice(
        $._brace_part,
        alias($._brace_sequence_separator_source, $.brace_separator),
      ),
    _brace_part: ($) => choice($._ordinary_word_part, $.process_substitution),
    brace_sequence_source: ($) =>
      prec.dynamic(
        1,
        seq(
          field("start", alias($._brace_sequence_operand, $.word)),
          alias($._brace_sequence_separator_source, $.brace_separator),
          field("end", alias($._brace_sequence_operand, $.word)),
          optional(
            seq(
              alias($._brace_sequence_separator_source, $.brace_separator),
              field("step", alias($._brace_sequence_operand, $.word)),
            ),
          ),
        ),
      ),
    _brace_sequence_operand: ($) => repeat1($._brace_part),
    brace_separator: ($) => lexeme($, "brace_separator"),
    _brace_comma_source: ($) => lexeme($, "brace_comma"),
    _brace_sequence_separator_source: ($) =>
      lexeme($, "brace_sequence_separator"),
    brace_closing_source: ($) => lexeme($, "brace_source_close"),
    literal: ($) => lexeme($, "literal"),
    escaped_character: ($) => lexeme($, "escaped_character"),
    single_quoted: ($) =>
      seq(
        $._sq_open_source,
        optional($.single_quote_content),
        $._sq_close_source,
      ),
    double_quoted: ($) => seq($._double_quote_prefix, $._dq_close_source),
    _double_quote_prefix: ($) =>
      choice(
        $._dq_open_source,
        seq($._double_quote_prefix, $._double_quote_part),
      ),
    _double_quote_content: ($) => repeat1($._double_quote_part),
    _double_quote_part: ($) =>
      choice($.double_quote_text, $.double_quote_escape, ...expansions($)),
    dollar_single_quoted: ($) =>
      seq(
        $._dollar_sq_open_source,
        $._dollar_sq_quote_source,
        repeat(
          choice($.dollar_single_quote_text, $.dollar_single_quote_escape),
        ),
        $._dollar_sq_close_source,
      ),
    single_quote_content: ($) => lexeme($, "single_quote_content"),
    double_quote_text: ($) => lexeme($, "double_quote_text"),
    double_quote_escape: ($) => lexeme($, "double_quote_escape"),
    dollar_single_quote_text: ($) => lexeme($, "dollar_single_quote_text"),
    dollar_single_quote_escape: ($) => lexeme($, "dollar_single_quote_escape"),
    parameter_expansion: ($) =>
      prec.right(
        choice(
          bracedParameter($),
          seq(
            $._parameter_dollar_source,
            choice(
              seq(
                field("parameter", $.positional_parameter),
                optional(
                  alias(
                    $._positional_parameter_suffix_source,
                    $.parameter_suffix_source,
                  ),
                ),
              ),
              seq(
                field(
                  "parameter",
                  choice(
                    $.variable_name,
                    $.special_parameter,
                    $.parameter_source,
                  ),
                ),
                optional($.parameter_suffix_source),
              ),
            ),
          ),
        ),
      ),
    _braced_parameter_expansion: bracedParameter,
    _braced_parameter_head: ($) =>
      seq(
        $._parameter_dollar_source,
        $._parameter_open_source,
        optional($._parameter_header),
        optional($._parameter_reference),
      ),
    parameter_closing_source: ($) =>
      repeat1(lexeme($, "parameter_closing_text")),
    _parameter_header: ($) =>
      choice(
        seq($.parameter_flags, optional($._parameter_control_prefixes)),
        $._parameter_control_prefixes,
      ),
    _parameter_control_prefixes: ($) =>
      choice(
        seq(
          repeat1(
            choice(
              $.parameter_prefix_operator,
              alias($._empty_double_quoted, $.double_quoted),
            ),
          ),
          optional($.parameter_length_operator),
        ),
        $.parameter_length_operator,
      ),
    _parameter_reference: ($) =>
      choice(
        field(
          "parameter",
          choice($.variable_name, $.positional_parameter, $.special_parameter),
        ),
        seq(
          field(
            "parameter",
            choice(
              $._nested_parameter_reference,
              alias($._quoted_parameter_reference, $.double_quoted),
            ),
          ),
          repeat(alias($._empty_double_quoted, $.double_quoted)),
        ),
      ),
    _nested_parameter_reference: ($) =>
      choice(
        alias($._braced_parameter_expansion, $.parameter_expansion),
        $.command_substitution,
        alias($._parenthesized_arithmetic_expansion, $.arithmetic_expansion),
      ),
    _quoted_parameter_reference: ($) =>
      seq(
        $._dq_open_source,
        choice(
          $._nested_parameter_reference,
          seq($._delimiter_parameter_reference, $._double_quote_content),
        ),
        $._dq_close_source,
      ),
    _empty_double_quoted: ($) => seq($._dq_open_source, $._dq_close_source),
    _parameter_tail: ($) =>
      choice(
        seq(
          repeat1(field("subscript", $.array_subscript)),
          optional($._parameter_operation),
        ),
        $._parameter_operation,
      ),
    _parameter_operation: ($) =>
      choice(
        seq($.parameter_value_operator, optional($.parameter_word)),
        seq($.parameter_pattern_operator, optional($.parameter_pattern)),
        $.parameter_replacement,
        seq($.parameter_substring, optional($._parameter_modifiers)),
        $._parameter_modifiers,
      ),
    parameter_source: ($) =>
      choice(
        seq(
          alias($._length_candidate_source, $.special_parameter),
          choice($.variable_name, $.positional_parameter, $.special_parameter),
        ),
        seq(
          repeat1($.parameter_prefix_operator),
          optional(
            choice(
              $.variable_name,
              $.positional_parameter,
              $.special_parameter,
            ),
          ),
        ),
      ),
    _length_candidate_source: ($) => lexeme($, "length_candidate"),
    parameter_suffix_source: ($) =>
      prec.right(
        choice(
          alias($._subscript_prefix_candidate, $.array_subscript),
          seq(
            alias($._candidate_array_subscript, $.array_subscript),
            repeat(
              alias($._candidate_parameter_modifier, $.parameter_modifier),
            ),
          ),
          $._positional_parameter_suffix_source,
        ),
      ),
    _subscript_prefix_candidate: ($) =>
      seq(
        $._subscript_prefix_open_source,
        optional(
          field(
            "source",
            alias($._subscript_prefix_source, $.subscript_source),
          ),
        ),
        $._subscript_prefix_end,
      ),
    _candidate_array_subscript: ($) =>
      arraySubscript($, $._subscript_candidate_open_source),
    _subscript_candidate_open_source: ($) =>
      punctuation($, "subscript_candidate_open", "["),
    _subscript_prefix_source: ($) =>
      bracketNameSource(
        $,
        alias($.array_key_text, $.subscript_text),
        alias($._subscript_prefix_group, $.subscript_group),
      ),
    _subscript_prefix_group: ($) =>
      bracketNameGroup(
        $,
        alias($._subscript_prefix_source, $.subscript_source),
      ),
    _subscript_prefix_open_source: ($) =>
      punctuation($, "subscript_prefix_open", "["),
    _positional_parameter_suffix_source: ($) =>
      repeat1(alias($._candidate_parameter_modifier, $.parameter_modifier)),
    parameter_length_operator: ($) => lexeme($, "parameter_length_operator"),
    parameter_prefix_operator: ($) => lexeme($, "parameter_prefix_operator"),
    parameter_flags: ($) =>
      seq(
        $._parameter_flags_open_source,
        repeat($.parameter_flag),
        $._parameter_flags_close_source,
      ),
    parameter_flag: ($) =>
      prec.right(
        seq(
          $.parameter_flag_name,
          repeat(
            field(
              "argument",
              alias($._parameter_flag_argument, $.flag_argument),
            ),
          ),
        ),
      ),
    parameter_flag_name: ($) => lexeme($, "parameter_flag_name"),
    _parameter_flag_argument: ($) =>
      seq(
        alias($._flag_argument_open_source, $.flag_argument_delimiter),
        optional(
          alias($._parameter_flag_argument_source, $.flag_argument_source),
        ),
        alias($._flag_argument_close_source, $.flag_argument_delimiter),
      ),
    _parameter_flag_argument_source: ($) =>
      alias($._parameter_flag_argument_text, $.flag_argument_text),
    _parameter_flag_argument_text: ($) =>
      repeat1(lexeme($, "flag_argument_text")),
    flag_argument: ($) =>
      seq(
        alias($._flag_argument_open_source, $.flag_argument_delimiter),
        optional($.flag_argument_source),
        alias($._flag_argument_close_source, $.flag_argument_delimiter),
      ),
    _candidate_flag_argument: ($) =>
      seq(
        alias($._flag_argument_open_source, $.flag_argument_delimiter),
        optional($.flag_argument_source),
        choice(
          alias($._flag_argument_close_source, $.flag_argument_delimiter),
          $._flag_argument_end,
        ),
      ),
    flag_argument_source: ($) =>
      repeat1(
        choice($.flag_argument_text, ...quotedParts($), ...expansions($)),
      ),
    flag_argument_text: ($) => lexeme($, "flag_argument_text"),
    _flag_argument_open_source: ($) => lexeme($, "flag_argument_open"),
    _flag_argument_close_source: ($) => lexeme($, "flag_argument_close"),
    parameter_value_operator: ($) => lexeme($, "parameter_value_operator"),
    parameter_pattern_operator: ($) => lexeme($, "parameter_pattern_operator"),
    parameter_replacement: ($) =>
      seq(
        $.parameter_replacement_operator,
        optional(field("pattern", $.parameter_pattern)),
        optional(
          seq(
            $.parameter_replacement_separator,
            optional(field("replacement", $.parameter_word)),
          ),
        ),
        $._parameter_replacement_end,
      ),
    parameter_replacement_operator: ($) =>
      lexeme($, "parameter_replacement_operator"),
    parameter_replacement_separator: ($) =>
      lexeme($, "parameter_replacement_separator"),
    parameter_substring: ($) =>
      seq(
        $.parameter_substring_operator,
        optional(field("offset", $.parameter_word)),
        optional(
          seq(
            $.parameter_substring_separator,
            optional(field("length", $.parameter_word)),
          ),
        ),
        $._parameter_substring_end,
      ),
    parameter_substring_operator: ($) =>
      lexeme($, "parameter_substring_operator"),
    parameter_substring_separator: ($) =>
      lexeme($, "parameter_substring_separator"),
    _parameter_modifiers: ($) =>
      repeat1(
        choice(
          $.parameter_modifier,
          seq(
            alias($._closed_parameter_substitution, $.parameter_modifier),
            optional(alias($._global_parameter_modifier, $.parameter_modifier)),
          ),
        ),
      ),
    parameter_modifier: ($) =>
      parameterModifier($, modifierOperation($, $._modifier_substitution)),
    _closed_parameter_substitution: ($) =>
      parameterModifier(
        $,
        seq(
          $._modifier_substitution,
          alias($._modifier_substitution_close_source, $.modifier_separator),
        ),
      ),
    _global_parameter_modifier: ($) =>
      seq(
        alias($._modifier_global_prefix, $.modifier_prefix),
        field("name", alias($._modifier_global_name_source, $.modifier_name)),
        $._modifier_end,
      ),
    _candidate_parameter_modifier: ($) =>
      parameterModifier(
        $,
        modifierOperation($, $._candidate_modifier_substitution),
        true,
      ),
    parameter_candidate_source: ($) => repeat1($._parameter_candidate_part),
    _parameter_candidate_part: ($) =>
      choice(
        alias($.brace_closing_source, $.parameter_candidate_text),
        alias($.brace_separator, $.parameter_candidate_text),
        alias($.literal, $.parameter_candidate_text),
        alias($.pattern_star_source, $.parameter_candidate_text),
        alias($.pattern_question_source, $.parameter_candidate_text),
        alias($.pattern_bracket_source, $.parameter_candidate_group),
        alias($.pattern_numeric_range_source, $.parameter_candidate_group),
        $.pattern_candidate,
        $.glob_qualifier_candidate,
        $.parameter_candidate_group,
        ...quotedParts($),
        ...expansions($),
        $.process_substitution,
      ),
    parameter_candidate_group: ($) =>
      choice(
        seq(
          $._pattern_group_open_source,
          optional(
            alias(
              $._parameter_candidate_alternatives,
              $.parameter_candidate_source,
            ),
          ),
          choice($._pattern_group_close_source, $._pattern_group_end),
        ),
        seq(
          $._brace_expansion_open_source,
          repeat($._parameter_candidate_part),
          choice($._brace_expansion_close_source, $._brace_expansion_end),
        ),
      ),
    _parameter_candidate_alternatives: ($) =>
      repeat1(
        choice(
          $._parameter_candidate_part,
          alias($.pattern_alternation, $.parameter_candidate_text),
        ),
      ),
    modifier_control: ($) =>
      seq(
        field("name", alias($._modifier_control_name_source, $.modifier_name)),
        optional(field("argument", $.flag_argument)),
      ),
    _candidate_modifier_control: ($) =>
      seq(
        field("name", alias($._modifier_control_name_source, $.modifier_name)),
        optional(
          field("argument", alias($._candidate_flag_argument, $.flag_argument)),
        ),
      ),
    _modifier_control_name_source: ($) => lexeme($, "modifier_control_name"),
    _modifier_substitution: ($) => modifierSubstitution($, $.parameter_word),
    _candidate_modifier_substitution: ($) =>
      seq(
        modifierSubstitution($, $.parameter_candidate_source, true),
        optional(
          alias($._modifier_substitution_close_source, $.modifier_separator),
        ),
      ),
    modifier_prefix: ($) => lexeme($, "modifier_begin"),
    _modifier_global_prefix: ($) => lexeme($, "modifier_global_begin"),
    _candidate_modifier_prefix: ($) => lexeme($, "candidate_modifier_begin"),
    _glob_modifier_prefix: ($) => lexeme($, "glob_modifier_begin"),
    modifier_name: ($) => lexeme($, "modifier_name"),
    _modifier_global_name_source: ($) => lexeme($, "modifier_global_name"),
    modifier_count: ($) => lexeme($, "modifier_count"),
    _modifier_substitution_name_source: ($) =>
      lexeme($, "modifier_substitution_name"),
    _modifier_substitution_open_source: ($) =>
      lexeme($, "modifier_substitution_open"),
    _modifier_substitution_separator_source: ($) =>
      lexeme($, "modifier_substitution_separator"),
    _modifier_substitution_close_source: ($) =>
      lexeme($, "modifier_substitution_close"),
    parameter_word: ($) => $._word_source,
    parameter_pattern: ($) => $._word_source,
    _parameter_open_source: ($) => punctuation($, "parameter_open", "{"),
    _parameter_close_source: ($) => punctuation($, "parameter_close", "}"),
    variable_name: ($) => lexeme($, "variable_name"),
    positional_parameter: ($) => lexeme($, "positional_parameter"),
    special_parameter: ($) => lexeme($, "special_parameter"),
    command_substitution: ($) =>
      seq(
        $._dollar_source,
        $._command_open_source,
        ...groupBody($),
        $._command_close_source,
      ),
    backquote_substitution: ($) =>
      seq(
        $._backquote_open_source,
        repeat($._line),
        optional(field("body", $.list)),
        optional($._trailing_comment),
        $._backquote_close_source,
      ),
    process_substitution: ($) =>
      seq(
        choice(
          $._process_in_source,
          $._process_out_source,
          $._process_file_source,
        ),
        $._command_open_source,
        ...groupBody($),
        $._command_close_source,
      ),
    _redirect: ($) => choice($.io_file, $.io_here, $.here_string),
    _argument_redirect: ($) =>
      choice(
        $._redirect,
        alias($._variable_io_file, $.io_file),
        alias($._variable_io_here, $.io_here),
        alias($._variable_here_string, $.here_string),
      ),
    _variable_io_file: ($) => seq($.io_variable, $._io_file_content),
    _variable_io_here: ($) => seq($.io_variable, $._io_here_content),
    _variable_here_string: ($) => seq($.io_variable, $._here_string_content),
    io_file: ($) => redirection($, $._io_file_content),
    _io_file_content: ($) =>
      seq(
        $.redirect_operator,
        field("filename", alias($._file_redirect_word, $.word)),
      ),
    io_here: ($) => redirection($, $._io_here_content),
    _io_here_content: ($) =>
      seq(
        choice($.dless, $.dlessdash),
        $._delimiter_begin,
        field("here_end", alias($._redirect_word, $.word)),
        $._delimiter_end,
      ),
    here_string: ($) => redirection($, $._here_string_content),
    _here_string_content: ($) =>
      seq(
        $.here_string_operator,
        field("value", alias($._redirect_word, $.word)),
      ),
    io_variable: ($) =>
      seq(
        $._io_variable_open_source,
        field("name", $.variable_name),
        $._io_variable_close_source,
      ),
    _io_variable_open_source: ($) => punctuation($, "io_variable_open", "{"),
    _io_variable_close_source: ($) => punctuation($, "io_variable_close", "}"),
    io_number: ($) => lexeme($, "io_number"),
    redirect_operator: ($) => lexeme($, "redirect_operator"),
    here_string_operator: ($) => lexeme($, "here_string_operator"),
    dless: ($) => lexeme($, "dless"),
    dlessdash: ($) => lexeme($, "dlessdash"),
    here_document_sequence: ($) =>
      seq(
        $._here_document_sequence_header,
        repeat1(field("document", $.here_document)),
        $._here_sequence_end,
      ),
    _here_document_sequence_header: ($) =>
      seq(
        $._here_sequence_begin,
        optional($.comment),
        field("line_end", alias($._newline_source, $.here_document_line_end)),
      ),
    here_document: ($) =>
      seq(
        $._document_begin,
        optional($.here_document_body),
        optional($.here_document_end),
        $._document_finish,
      ),
    here_document_body: ($) =>
      repeat1(
        choice(
          $.here_document_text,
          $.quoted_here_document_text,
          $.here_document_escape,
          ...expansions($),
        ),
      ),
    here_document_delimiter_quoted: ($) =>
      lexeme($, "here_document_delimiter_quoted"),
    here_document_text: ($) => lexeme($, "here_document_text"),
    quoted_here_document_text: ($) => lexeme($, "quoted_here_document_text"),
    here_document_escape: ($) => lexeme($, "here_document_escape"),
    here_document_end: ($) =>
      seq(
        $._here_end_begin,
        optional($.here_document_end_text),
        optional($._newline_source),
        $._here_end_finish,
      ),
    here_document_end_text: ($) => lexeme($, "here_document_end_text"),
    comment: ($) => $.comment_text,
    comment_text: ($) => lexeme($, "comment_text"),
    _trailing_comment: ($) => alias($._trailing_comment_source, $.comment),
    _trailing_comment_source: ($) =>
      alias($._trailing_comment_text_source, $.comment_text),
    _trailing_comment_text_source: ($) => lexeme($, "trailing_comment_text"),
    _separator: ($) =>
      choice($._semicolon_source, $._ampersand_source, $.async_disown, $._line),
    _line: ($) =>
      choice(
        seq(optional($.comment), $._newline_source),
        $.here_document_sequence,
      ),
    _layout_source: ($) =>
      seq($._layout, repeat1($._layout_piece), $._layout_end),
    _newline_source: ($) => lexeme($, "newline"),
    and_if: ($) => lexeme($, "and_if"),
    or_if: ($) => lexeme($, "or_if"),
    line_continuation: ($) => $._line_continuation,
    ...Object.fromEntries(
      tokens
        .filter((name) => name.endsWith("_keyword"))
        .map((name) => [name, ($) => lexeme($, name)]),
    ),
    ...Object.fromEntries(
      Object.entries({
        header_brace_open: "{",
        sq_open: "'",
        sq_close: "'",
        dq_open: '"',
        dq_close: '"',
        dollar_sq_open: "$",
        dollar_sq_quote: "'",
        dollar_sq_close: "'",
        dollar: "$",
        parameter_dollar: "$",
        command_open: "(",
        command_close: ")",
        backquote_open: "`",
        backquote_close: "`",
        process_in: "<",
        process_out: ">",
        process_file: "=",
        semicolon: ";",
        ampersand: "&",
        pipe: "|",
        left_paren: "(",
        right_paren: ")",
        left_brace: "{",
        right_brace: "}",
        parameter_flags_open: "(",
        parameter_flags_close: ")",
        subscript_flags_open: "(",
        subscript_flags_close: ")",
        subscript_paren_open: "(",
        subscript_paren_close: ")",
        subscript_bracket_open: "[",
        subscript_bracket_close: "]",
        subscript_brace_open: "{",
        subscript_brace_close: "}",
        arithmetic_dollar: "$",
        arithmetic_open: "(",
        arithmetic_close_first: ")",
        arithmetic_close: ")",
        arithmetic_square_open: "[",
        arithmetic_square_close: "]",
        arithmetic_group_open: "(",
        arithmetic_group_close: ")",
        arithmetic_function_open: "(",
        arithmetic_function_close: ")",
        condition_open: "[",
        condition_close_first: "]",
        condition_close: "]",
        condition_group_open: "(",
        condition_group_close: ")",
        pattern_bracket_open: "[",
        pattern_bracket_close: "]",
        pattern_group_open: "(",
        pattern_group_close: ")",
        pattern_candidate_open: "(",
        pattern_candidate_close: ")",
        glob_qualifier_open: "(",
        glob_qualifier_close: ")",
        numeric_range_open: "<",
        numeric_range_close: ">",
        brace_expansion_open: "{",
        brace_expansion_close: "}",
      }).map(([name, spelling]) => [
        `_${name}_source`,
        ($) => punctuation($, name, spelling),
      ]),
    ),
  },
});
