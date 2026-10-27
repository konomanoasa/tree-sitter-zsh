#include "scanner.c"
#include <assert.h>

#ifdef TREE_SITTER_REUSE_ALLOCATOR
void *(*ts_current_malloc)(size_t) = malloc;
void *(*ts_current_calloc)(size_t, size_t) = calloc;
void *(*ts_current_realloc)(void *, size_t) = realloc;
void (*ts_current_free)(void *) = free;
#endif

struct RecoveryInput {
  TSLexer lexer;
  const int32_t *source;
  size_t length;
  size_t position;
  size_t marked;
};

static void recovery_advance(TSLexer *lexer, bool skip) {
  (void)skip;
  struct RecoveryInput *input = (struct RecoveryInput *)lexer;
  assert(input->position < input->length);
  input->position++;
  lexer->lookahead =
    input->position == input->length ? 0 : input->source[input->position];
}

static void recovery_mark_end(TSLexer *lexer) {
  struct RecoveryInput *input = (struct RecoveryInput *)lexer;
  input->marked = input->position;
}

static bool recovery_eof(const TSLexer *lexer) {
  const struct RecoveryInput *input = (const struct RecoveryInput *)lexer;
  return input->position == input->length;
}

static void unrecognized_recovery_source_preserves_context(void) {
  const int32_t source[] = {'$', 0, '\n'};
  struct RecoveryInput input = {
    .lexer =
      {
        .lookahead = source[0],
        .advance = recovery_advance,
        .mark_end = recovery_mark_end,
        .eof = recovery_eof,
      },
    .source = source,
    .length = sizeof(source) / sizeof(*source),
  };
  struct Scanner state = {0};
  assert(init_source(&state));
  assert(push(&state, WORD_BEGIN));
  char before[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
  unsigned length = zsh_scanner_serialize(&state, before);
  bool valid[TOKEN_COUNT] = {0};
  valid[RECOVERY] = true;
  assert(!zsh_scanner_scan(&state, &input.lexer, valid));
  char after[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
  assert(zsh_scanner_serialize(&state, after) == length);
  assert(memcmp(before, after, length) == 0);
  clear(&state);
}

static void recovery_tokens_preserve_boundaries_and_survive_restoration(void) {
  const struct {
    const char *source;
    enum Token context;
    enum Token token;
    size_t contexts_after;
  } cases[] = {
    {"done", TOKEN_COUNT, DONE_KEYWORD, 0},
    {"do\\\nne", TOKEN_COUNT, DONE_KEYWORD, 0},
    {"done_suffix", TOKEN_COUNT, TOKEN_COUNT, 0},
    {"end", TOKEN_COUNT, END_KEYWORD, 0},
    {"always", TOKEN_COUNT, ALWAYS_KEYWORD, 0},
    {"done ; )", SQ_OPEN, SINGLE_QUOTE_CONTENT, 1},
    {"done ; )", DQ_OPEN, DOUBLE_QUOTE_TEXT, 1},
    {"'", SQ_OPEN, SQ_CLOSE, 0},
    {"\"", DQ_OPEN, DQ_CLOSE, 0},
    {"}", PARAMETER_OPEN, PARAMETER_CLOSE, 0},
    {"}", DQ_OPEN, DOUBLE_QUOTE_TEXT, 1},
    {")", COMMAND_OPEN, COMMAND_CLOSE, 0},
    {"`", BACKQUOTE_OPEN, BACKQUOTE_CLOSE, 0},
    {"]", CONDITION_BEGIN, TOKEN_COUNT, 1},
    {"]]suffix", CONDITION_BEGIN, TOKEN_COUNT, 1},
  };
  for (size_t i = 0; i < sizeof(cases) / sizeof(*cases); ++i) {
    int32_t characters[32];
    size_t length = strlen(cases[i].source);
    assert(length < sizeof(characters) / sizeof(*characters));
    for (size_t j = 0; j < length; ++j) characters[j] = cases[i].source[j];
    struct RecoveryInput input = {
      .lexer =
        {
          .lookahead = characters[0],
          .advance = recovery_advance,
          .mark_end = recovery_mark_end,
          .eof = recovery_eof,
        },
      .source = characters,
      .length = length,
    };
    struct Scanner state = {0};
    assert(init_source(&state));
    if (cases[i].context != TOKEN_COUNT) assert(push(&state, cases[i].context));
    bool valid[TOKEN_COUNT];
    memset(valid, true, sizeof(valid));
    bool accepted = zsh_scanner_scan(&state, &input.lexer, valid);
    assert(accepted == (cases[i].token != TOKEN_COUNT));
    if (accepted) {
      assert(input.lexer.result_symbol == cases[i].token);
      assert(input.marked == 0 && state.remaining == length);
      do {
        char saved[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
        unsigned bytes = zsh_scanner_serialize(&state, saved);
        assert(bytes > 0);
        zsh_scanner_deserialize(&state, saved, bytes);
        assert(!state.failed);
        input.position = input.marked;
        input.lexer.lookahead = input.source[input.position];
        assert(zsh_scanner_scan(&state, &input.lexer, valid));
      } while (state.remaining);
      assert(input.marked == length);
      assert(state.count == cases[i].contexts_after);
    }
    clear(&state);
  }
}

static void
heredoc_recovery_keeps_the_end_after_skipped_parameter_source(void) {
  const int32_t source[] = {'!', 'b', 'a', 'd', '}', '\n', 'E', '\n', 'x'};
  const enum Token expected[] = {
    PARAMETER_CLOSE,
    CHARACTER_RIGHT_BRACE,
    HERE_DOCUMENT_TEXT,
    PIECE,
    HERE_END_BEGIN,
    HERE_DOCUMENT_END_TEXT,
    PIECE,
    NEWLINE,
    PIECE,
    HERE_END_FINISH,
    DOCUMENT_FINISH,
  };
  struct RecoveryInput input = {
    .lexer =
      {
        .lookahead = source[0],
        .advance = recovery_advance,
        .mark_end = recovery_mark_end,
        .eof = recovery_eof,
      },
    .source = source,
    .length = sizeof(source) / sizeof(*source),
  };
  struct Scanner state = {0};
  assert(init_source(&state));
  state.documents = ts_calloc(1, sizeof(*state.documents));
  assert(state.documents);
  state.document_count = state.document_capacity = 1;
  state.documents[0] = (struct Document){.length = 1, .active = true};
  state.documents[0].delimiter = ts_malloc(1);
  assert(state.documents[0].delimiter);
  state.documents[0].delimiter[0] = 'E';
  assert(push(&state, DOCUMENT_BEGIN));
  assert(push(&state, PARAMETER_OPEN));
  for (size_t i = 0; i < state.source.stage_count; ++i)
    state.source.stages[i].at_line_start = false;
  bool valid[TOKEN_COUNT] = {[RECOVERY] = true};
  size_t recognized = 0;
  size_t skipped = 0;
  while (recognized < sizeof(expected) / sizeof(*expected)) {
    char saved[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
    unsigned length = zsh_scanner_serialize(&state, saved);
    assert(length > 0);
    zsh_scanner_deserialize(&state, saved, length);
    assert(!state.failed);
    input.position = input.marked;
    input.lexer.lookahead = source[input.position];
    size_t start = input.position;
    if (!zsh_scanner_scan(&state, &input.lexer, valid)) {
      char after[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
      assert(zsh_scanner_serialize(&state, after) == length);
      assert(memcmp(saved, after, length) == 0);
      assert(start < 4);
      input.marked = start + 1;
      skipped++;
      continue;
    }
    assert(input.lexer.result_symbol == expected[recognized++]);
  }
  assert(skipped == 4);
  assert(input.marked == 8);
  assert(state.count == 0);
  assert(state.documents[0].finished);
  clear(&state);
}

static void condition_recovery_closes_only_after_both_source_brackets(void) {
  const int32_t source[] = {']', ']'};
  const enum Token expected[] = {
    CONDITION_CLOSE_FIRST,
    CHARACTER_RIGHT_BRACKET,
    CONDITION_CLOSE,
    CHARACTER_RIGHT_BRACKET,
  };
  for (size_t groups = 0; groups <= 2; ++groups) {
    struct RecoveryInput input = {
      .lexer =
        {
          .lookahead = source[0],
          .advance = recovery_advance,
          .mark_end = recovery_mark_end,
          .eof = recovery_eof,
        },
      .source = source,
      .length = sizeof(source) / sizeof(*source),
    };
    struct Scanner state = {0};
    assert(init_source(&state));
    assert(push(&state, CONDITION_BEGIN));
    for (size_t group = 0; group < groups; ++group)
      assert(push(&state, CONDITION_GROUP_OPEN));
    bool valid[TOKEN_COUNT] = {[RECOVERY] = true};
    for (size_t i = 0; i < sizeof(expected) / sizeof(*expected); ++i) {
      char saved[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
      unsigned bytes = zsh_scanner_serialize(&state, saved);
      assert(bytes > 0);
      zsh_scanner_deserialize(&state, saved, bytes);
      assert(!state.failed);
      if (i == 1) {
        bool wrong_character[TOKEN_COUNT] = {[CHARACTER_LEFT_BRACKET] = true};
        assert(!zsh_scanner_scan(&state, &input.lexer, wrong_character));
        char after[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
        assert(zsh_scanner_serialize(&state, after) == bytes);
        assert(memcmp(saved, after, bytes) == 0);
        input.marked = 0;
      }
      input.position = input.marked;
      input.lexer.lookahead = source[input.position];
      assert(zsh_scanner_scan(&state, &input.lexer, valid));
      assert(input.lexer.result_symbol == expected[i]);
      assert(state.count == (i == 3 ? 0 : groups + 1));
    }
    assert(input.marked == 2);
    assert(!state.word_only);
    clear(&state);
  }
}

static void source_continuation_retains_physical_origin(void) {
  struct SourceCursor cursor;
  struct SourceStage stage = source_stage(SOURCE_REMOVE_CONTINUATIONS);
  assert(source_cursor_init(&cursor, &stage, 1, NULL, NULL));
  const int32_t input[] = {'a', '\\', '\n', 'b'};
  for (size_t i = 0; i < sizeof(input) / sizeof(*input); ++i)
    assert(source_feed(&cursor, input[i]));
  assert(source_finish(&cursor));
  assert(cursor.logical_count == 2);
  assert(cursor.logical[1].value == 'b');
  assert(cursor.logical[1].origin.start == 3);
  assert(cursor.removal_count == 1);
  assert(cursor.removals[0].slash == 1);
  source_cursor_clear(&cursor);
}

static void
dollar_quote_waits_for_its_quote_before_disabling_continuations(void) {
  struct Scanner state = {0}, copy = {0};
  assert(init_source(&state));
  assert(commit(&state, DOLLAR_SQ_OPEN));
  assert(!state.source.stages[0].disabled);
  char encoded[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
  unsigned length = zsh_scanner_serialize(&state, encoded);
  assert(length > 0);
  zsh_scanner_deserialize(&copy, encoded, length);
  assert(!copy.source.stages[0].disabled);
  assert(commit(&copy, DOLLAR_SQ_QUOTE));
  assert(copy.source.stages[0].disabled);
  assert(commit(&copy, DOLLAR_SQ_CLOSE));
  assert(!copy.source.stages[0].disabled);
  assert(copy.count == 0);
  clear(&state);
  clear(&copy);
}

static void scanner_state_round_trip_preserves_pending_documents(void) {
  struct Scanner state = {0};
  assert(init_source(&state));
  assert(push(&state, WORD_BEGIN));
  assert(push(&state, DQ_OPEN));
  assert(push(&state, SUBSCRIPT_OPEN));
  assert(push(&state, BACKQUOTE_OPEN));
  state.contexts[0].parentheses = 2;
  state.documents = ts_calloc(1, sizeof(*state.documents));
  assert(state.documents);
  state.document_count = state.document_capacity = 1;
  state.documents[0] =
    (struct Document){.length = 4, .depth = 1, .strip_tabs = true};
  state.documents[0].delimiter = ts_malloc(4);
  assert(state.documents[0].delimiter);
  state.documents[0].delimiter[0] = 'E';
  state.documents[0].delimiter[1] = 0;
  state.documents[0].delimiter[2] = 0xce;
  state.documents[0].delimiter[3] = 0xa3;
  char first[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
  char second[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
  unsigned count = zsh_scanner_serialize(&state, first);
  assert(count > 0);
  struct Scanner copy = {0};
  zsh_scanner_deserialize(&copy, first, count);
  assert(zsh_scanner_serialize(&copy, second) == count);
  assert(memcmp(first, second, count) == 0);
  assert(copy.documents[0].delimiter[2] == 0xce);
  assert(copy.documents[0].delimiter[3] == 0xa3);
  assert(copy.contexts[2].quoting == SOURCE_DOUBLE_QUOTED);
  assert(copy.contexts[0].parentheses == 2);
  for (unsigned i = 1; i < count; ++i) {
    zsh_scanner_deserialize(&copy, first, i);
    assert(copy.count == 0 && copy.document_count == 0);
  }
  clear(&state);
  clear(&copy);
}

static void substitution_closures_release_only_their_pending_documents(void) {
  const enum Token openers[] = {COMMAND_OPEN, BACKQUOTE_OPEN};
  const struct Document outer[] = {
    {.depth = 0},
    {.depth = 0, .active = true},
    {.depth = 0, .declaring = true}
  };
  for (size_t i = 0; i < sizeof(openers) / sizeof(*openers); ++i) {
    for (size_t j = 0; j < sizeof(outer) / sizeof(*outer); ++j) {
      struct Scanner state = {0}, copy = {0};
      assert(init_source(&state));
      assert(push(&state, openers[i]));
      assert(push(&state, COMMAND_OPEN));
      state.documents = ts_calloc(4, sizeof(*state.documents));
      assert(state.documents);
      state.document_count = state.document_capacity = 4;
      state.documents[0] = outer[j];
      state.documents[1].depth = 1;
      state.documents[2].depth = state.documents[3].depth = 2;
      for (size_t k = 0; k < state.document_count; ++k) {
        state.documents[k].length = 1;
        state.documents[k].delimiter = ts_malloc(1);
        assert(state.documents[k].delimiter);
        state.documents[k].delimiter[0] = (uint8_t)('A' + k);
      }
      char encoded[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
      unsigned length = zsh_scanner_serialize(&state, encoded);
      assert(length > 0);
      zsh_scanner_deserialize(&copy, encoded, length);
      assert(commit(&copy, COMMAND_CLOSE));
      assert(copy.document_count == 2 && depth(&copy) == 1);
      assert(pending_document(&copy) == &copy.documents[1]);
      assert(push(&copy, COMMAND_OPEN));
      assert(!pending_document(&copy));
      assert(commit(&copy, COMMAND_CLOSE));
      assert(commit(
        &copy,
        openers[i] == COMMAND_OPEN ? COMMAND_CLOSE : BACKQUOTE_CLOSE
      ));
      assert(copy.document_count == 1 && depth(&copy) == 0);
      assert(!copy.documents[0].finished);
      assert(copy.documents[0].active == outer[j].active);
      assert(copy.documents[0].declaring == outer[j].declaring);
      assert(copy.documents[0].delimiter[0] == 'A');
      clear(&state);
      clear(&copy);
    }
  }
}

static void decoded_delimiter_bytes_survive_state_restoration(void) {
  const struct {
    int32_t source[24];
    const char *bytes;
    size_t length;
  } cases[] = {
    {{'$', '\'', '\\', 'x', 'F', 'F', '\'', '\n'}, "\xff", 1},
    {{'$', '\'', '\\', '3', '7', '7', '\'', '\n'}, "\xff", 1},
    {{'$', '\'', '\\', 'x', 'C', '3', '\'', '\n'}, "\xc3", 1},
    {{'$', '\'', '\\', 'x', 'B', 'F', '\'', '\n'}, "\xbf", 1},
    {
      {'a', '$', '\'', '\\', 'x', 'F', 'F', '\'', 'b', '\n'},
      "a\xff"
      "b",
      3,
    },
    {
      {'$', '\'', '\\', 'x', 'C', '0', '\\', 'x', 'A', 'F', '\'', '\n'},
      "\xc0\xaf",
      2,
    },
    {
      {'$',
        '\'',
        '\\',
        'x',
        'E',
        'D',
        '\\',
        'x',
        'A',
        '0',
        '\\',
        'x',
        '8',
        '0',
        '\'',
        '\n'},
      "\xed\xa0\x80",
      3,
    },
    {
      {'$',
        '\'',
        '\\',
        'x',
        'F',
        '4',
        '\\',
        'x',
        '9',
        '0',
        '\\',
        'x',
        '8',
        '0',
        '\\',
        'x',
        '8',
        '0',
        '\'',
        '\n'},
      "\xf4\x90\x80\x80",
      4,
    },
    {
      {'$',
        '\'',
        '\\',
        'x',
        'C',
        '3',
        '\'',
        '$',
        '\'',
        '\\',
        '2',
        '7',
        '7',
        '\'',
        '\n'},
      "\xc3\xbf",
      2,
    },
    {{'$', '\'', '\\', 'C', '-', 0xe9, '\'', '\n'}, "\x83\xa9", 2},
    {{'$', '\'', '\\', 'M', '-', 'A', '\'', '\n'}, "\xc1", 1},
    {{'$', '\'', 'a', '\\', '0', 'b', '\'', '\n'}, "a\0b", 3},
  };
  for (size_t i = 0; i < sizeof(cases) / sizeof(*cases); ++i) {
    size_t length = 0;
    while (cases[i].source[length]) ++length;
    struct RecoveryInput input = {
      .lexer =
        {
          .lookahead = cases[i].source[0],
          .advance = recovery_advance,
          .mark_end = recovery_mark_end,
          .eof = recovery_eof,
        },
      .source = cases[i].source,
      .length = length,
    };
    struct Scanner state = {0}, copy = {0};
    assert(init_source(&state));
    struct NativeInput native = {.lexer = &input.lexer};
    struct LogicalLexer logical;
    assert(logical_init(&logical, &native, &state.source));
    assert(read_delimiter(&state, &logical));
    assert(state.document_count == 1 && state.documents[0].quoted);
    assert(state.documents[0].length == cases[i].length);
    assert(
      memcmp(state.documents[0].delimiter, cases[i].bytes, cases[i].length) == 0
    );
    char encoded[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
    unsigned encoded_length = zsh_scanner_serialize(&state, encoded);
    assert(encoded_length > 0);
    zsh_scanner_deserialize(&copy, encoded, encoded_length);
    assert(!copy.failed && copy.document_count == 1);
    assert(copy.documents[0].quoted);
    assert(copy.documents[0].length == cases[i].length);
    assert(
      memcmp(copy.documents[0].delimiter, cases[i].bytes, cases[i].length) == 0
    );
    logical_clear(&logical);
    ts_free(native.characters);
    clear(&state);
    clear(&copy);
  }
}

static void logical_lookahead_restores_each_continuation_stage(void) {
  const int32_t source[] = {'>', '\\', '\n', '!', 'x', '\\', '\n', 'y'};
  for (size_t depth = 0; depth < 2; ++depth) {
    struct RecoveryInput input = {
      .lexer =
        {
          .lookahead = source[0],
          .advance = recovery_advance,
          .mark_end = recovery_mark_end,
          .eof = recovery_eof,
        },
      .source = source,
      .length = sizeof(source) / sizeof(*source),
    };
    struct Scanner scanner = {0};
    assert(init_source(&scanner));
    if (depth) assert(push(&scanner, BACKQUOTE_OPEN));
    struct NativeInput native = {.lexer = &input.lexer};
    struct LogicalLexer logical;
    assert(logical_init(&logical, &native, &scanner.source));
    struct LogicalPosition start = logical_position(&logical);
    for (size_t pass = 0; pass < 2; ++pass) {
      assert(logical_peek(&logical) == '!');
      assert(logical.consumed == 0 && current(&logical) == '>');
      while (logical.result == SOURCE_CHARACTER) advance(&logical);
      logical_restore_position(&logical, &start);
    }
    logical_clear(&logical);
    native_input_clear(&native);
    clear(&scanner);
  }
}

static void
parameter_source_state_preserves_owners_and_pending_command_source(void) {
  struct Scanner state = {0}, copy = {0};
  assert(init_source(&state));
  assert(commit(&state, PARAMETER_OPEN));
  assert(commit(&state, PARAMETER_FLAGS_OPEN));
  state.contexts[1].delimiter_kind = PARAMETER_QUOTED_DOLLAR;
  state.argument_delimiter = '$';
  assert(commit(&state, FLAG_ARGUMENT_OPEN));
  assert(parameter_source_push(&state, COMMAND_OPEN, SOURCE_UNQUOTED));
  state.parameter_frames[1].remaining = 17;
  char encoded[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
  unsigned length = zsh_scanner_serialize(&state, encoded);
  assert(length > 0);
  zsh_scanner_deserialize(&copy, encoded, length);
  assert(copy.contexts[0].source_depth == 1);
  assert(copy.contexts[2].delimiter_kind == PARAMETER_QUOTED_DOLLAR);
  assert(copy.parameter_count == 2 && copy.parameter_frames[1].remaining == 17);
  clear(&copy);
  state.contexts[0].source_depth = state.parameter_count + 2;
  length = zsh_scanner_serialize(&state, encoded);
  assert(length > 0);
  zsh_scanner_deserialize(&copy, encoded, length);
  assert(copy.failed && copy.count == 0 && copy.parameter_count == 0);
  clear(&copy);
  clear(&state);
}

static void scanner_state_overflow_never_truncates_the_context_stack(void) {
  for (size_t parameter = 0; parameter < 2; ++parameter) {
    struct Scanner state = {0};
    assert(init_source(&state));
    char encoded[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
    size_t previous_count = 0;
    for (;;) {
      assert(
        parameter
          ? parameter_source_push(&state, PARAMETER_OPEN, SOURCE_UNQUOTED)
          : push(&state, WORD_BEGIN)
      );
      size_t count = parameter ? state.parameter_count : state.count;
      assert(count == previous_count + 1);
      unsigned length = zsh_scanner_serialize(&state, encoded);
      assert((parameter ? state.parameter_count : state.count) == count);
      if (!length) break;
      assert(length <= sizeof(encoded));
      previous_count = count;
      assert(previous_count < TREE_SITTER_SERIALIZATION_BUFFER_SIZE);
    }
    assert(previous_count > 1);
    if (parameter) state.parameter_count--;
    else assert(pop(&state));
    assert(zsh_scanner_serialize(&state, encoded) > 0);
    clear(&state);
  }
}

static void modifier_operand_start_survives_state_restoration(void) {
  const enum Token openers[] =
    {MODIFIER_BEGIN, UNBRACED_MODIFIER_BEGIN, GLOB_MODIFIER_BEGIN};
  for (size_t i = 0; i < sizeof(openers) / sizeof(*openers); ++i) {
    struct Scanner state = {0};
    assert(init_source(&state));
    assert(push(&state, PARAMETER_OPEN));
    assert(push(&state, openers[i]));
    assert(commit(&state, MODIFIER_SUBSTITUTION_SEPARATOR));
    char encoded[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
    unsigned length = zsh_scanner_serialize(&state, encoded);
    assert(length > 0);
    struct Scanner copy = {0};
    zsh_scanner_deserialize(&copy, encoded, length);
    assert(copy.count == 2);
    assert(copy.contexts[1].opener == openers[i]);
    assert(copy.contexts[1].initial == (openers[i] == MODIFIER_BEGIN));
    assert(copy.contexts[1].word_start);
    assert(commit(&copy, LITERAL));
    assert(copy.contexts[1].initial == (openers[i] == MODIFIER_BEGIN));
    assert(!copy.contexts[1].word_start);
    clear(&state);
    clear(&copy);
  }
}

static void removed_source_preserves_lexical_context_state(void) {
  const enum Token openers[] = {
    WORD_BEGIN,
    ASSIGNMENT_BEGIN,
    PARAMETER_OPEN,
    CASE_PATTERN_BEGIN,
    PATTERN_BRACKET_OPEN,
    PATTERN_FLAGS_OPEN,
    GLOB_QUALIFIER_OPEN,
    GLOB_ARGUMENT_BEGIN,
    SUBSCRIPT_OPEN,
    ARITHMETIC_BEGIN,
  };
  for (size_t i = 0; i < sizeof(openers) / sizeof(*openers); ++i) {
    struct Scanner state = {0}, copy = {0};
    assert(init_source(&state));
    assert(push(&state, openers[i]));
    char expected[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
    unsigned length = zsh_scanner_serialize(&state, expected);
    assert(length > 0);
    zsh_scanner_deserialize(&copy, expected, length);
    assert(commit(&copy, REMOVED_SOURCE));
    char actual[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
    assert(zsh_scanner_serialize(&copy, actual) == length);
    assert(memcmp(actual, expected, length) == 0);
    clear(&state);
    clear(&copy);
  }
}

static void
glob_argument_state_keeps_its_source_delimiter_after_restoration(void) {
  struct Scanner state = {0};
  assert(init_source(&state));
  assert(push(&state, GLOB_QUALIFIER_OPEN));
  state.contexts[0].arguments = GLOB_DELIMITED;
  state.argument_delimiter = ':';
  assert(commit(&state, GLOB_ARGUMENT_BEGIN));
  assert(commit(&state, GLOB_ARGUMENT_OPEN));
  char encoded[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
  unsigned length = zsh_scanner_serialize(&state, encoded);
  assert(length > 0);
  struct Scanner copy = {0};
  zsh_scanner_deserialize(&copy, encoded, length);
  assert(copy.count == 2);
  assert(copy.contexts[0].delimiter == 'q');
  assert(copy.contexts[0].arguments == GLOB_NO_ARGUMENT);
  assert(copy.contexts[1].arguments == GLOB_DELIMITED);
  assert(copy.contexts[1].delimiter == ':');
  assert(!copy.contexts[1].initial);
  assert(commit(&copy, GLOB_ARGUMENT_CLOSE));
  assert(copy.count == 1 && copy.contexts[0].delimiter == 'q');
  clear(&state);
  clear(&copy);
}

static void
redirect_substitution_restores_keyword_position_after_round_trip(void) {
  struct Scanner state = {0};
  assert(init_source(&state));
  assert(commit(&state, REDIRECT_WORD_BEGIN));
  assert(state.word_only);
  assert(commit(&state, COMMAND_OPEN));
  assert(!state.word_only);
  assert(commit(&state, WORD_BEGIN));
  assert(state.word_only);
  char encoded[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
  unsigned length = zsh_scanner_serialize(&state, encoded);
  assert(length > 0);
  struct Scanner copy = {0};
  zsh_scanner_deserialize(&copy, encoded, length);
  assert(copy.word_only);
  assert(commit(&copy, WORD_END));
  assert(commit(&copy, COMMAND_CLOSE));
  assert(copy.word_only);
  assert(commit(&copy, WORD_END));
  assert(!copy.word_only);
  assert(copy.count == 0);
  clear(&state);
  clear(&copy);
}

static void boundary_lookahead_restores_input_after_success_and_failure(void) {
  enum ProbeKind {
    ASSIGNMENT_TARGET,
    ARRAY_ELEMENT_TARGET,
    PATTERN_BRACKET,
    DIRECTORY_PARAMETER,
    ARITHMETIC_PREFIX,
  };
  const struct {
    const char *source;
    enum ProbeKind kind;
    bool expected;
  } cases[] = {
    {"a[$(time time case)]=x", ASSIGNMENT_TARGET, true},
    {"a[$(time { :; time case; })]=x", ASSIGNMENT_TARGET, true},
    {"a[$(time for x in a; do :; time case; done)]=x", ASSIGNMENT_TARGET, true},
    {"a[$(time foreach x (a); :; time case; end)]=x", ASSIGNMENT_TARGET, true},
    {"a[$(time :; time case x in x) :;; esac)]=x", ASSIGNMENT_TARGET, true},
    {"a[$(time : || time case x in x) :;; esac)]=x", ASSIGNMENT_TARGET, true},
    {"a[$([[x]] case)]=x", ASSIGNMENT_TARGET, true},
    {"a[$([\\\n[x]] case)]=x", ASSIGNMENT_TARGET, true},
    {"a[$([[ x ]] case)]=x", ASSIGNMENT_TARGET, false},
    {"a[$([[x]] case]=x", ASSIGNMENT_TARGET, false},
    {"(($(case x in x) print 1;; esac)))", ARITHMETIC_PREFIX, true},
    {"(($(case x in x) print 1;; })))", ARITHMETIC_PREFIX, true},
    {"(($(case x { x) print 1;; esac)))", ARITHMETIC_PREFIX, true},
    {"(($(cat <<E\n)\nE\n)))", ARITHMETIC_PREFIX, true},
    {"((print x) )", ARITHMETIC_PREFIX, false},
    {"(\\\n(1))", ARITHMETIC_PREFIX, true},
    {"((1)\\\n)", ARITHMETIC_PREFIX, true},
    {"((1]))", ARITHMETIC_PREFIX, false},
    {"(([1))", ARITHMETIC_PREFIX, false},
    {"((\"(\"))", ARITHMETIC_PREFIX, false},
    {"((##\"))", ARITHMETIC_PREFIX, true},
    {"((${x:-{}))", ARITHMETIC_PREFIX, true},
    {"((${x:-'}))", ARITHMETIC_PREFIX, true},
    {"((${(s:{a,b}:)x}))", ARITHMETIC_PREFIX, false},
    {"a[$[##']]=x", ASSIGNMENT_TARGET, true},
    {"((1 + $((2", ARITHMETIC_PREFIX, true},
    {"a[']']=x", ASSIGNMENT_TARGET, true},
    {"a[$(case x in x) print ']';; esac)]=x", ASSIGNMENT_TARGET, true},
    {"a[$(case x in x) print ']';; })]=x", ASSIGNMENT_TARGET, true},
    {"a[$(case x { x) print ']';; esac)]=x", ASSIGNMENT_TARGET, true},
    {"a[$(if [[ x ]] then case x in x) :;; esac; fi)]=x",
      ASSIGNMENT_TARGET,
      true},
    {"a[$(if [[ x ]] >out then case x in x) :;; esac; fi)]=x",
      ASSIGNMENT_TARGET,
      true},
    {"a[$(if [[ x ]] then case x in x) :;; esac; fi]=x",
      ASSIGNMENT_TARGET,
      false},
    {"a[$(cat <<'E'\n)]\\\nE\n)]=x", ASSIGNMENT_TARGET, true},
    {"a[$(cat <<$'\\C-A'\n)]\n\1\n)]=x", ASSIGNMENT_TARGET, true},
    {"a[$(cat <<$'\\u0045'\n)]\nE\n)]=x", ASSIGNMENT_TARGET, true},
    {"a[$(cat <<$'\\xFF'\nbody\n)]=x", ASSIGNMENT_TARGET, false},
    {"a[$'\\C-']=x", ASSIGNMENT_TARGET, true},
    {"a[$(cat <<A <<B\n)]\nA\n)]\nB\n)]=x", ASSIGNMENT_TARGET, true},
    {"a[`print ']'`]=x", ASSIGNMENT_TARGET, true},
    {"a[$(print x # comment\\\n)]=y", ASSIGNMENT_TARGET, true},
    {"a[`print x # comment`]=y", ASSIGNMENT_TARGET, true},
    {"a[$(cat <<E\nunclosed", ASSIGNMENT_TARGET, false},
    {"a[$(cat <<\\\n-E\n]\nE\n)]=x", ASSIGNMENT_TARGET, true},
    {"a[$(case x in x) print ']';\\\n; esac)]=x", ASSIGNMENT_TARGET, true},
    {"a['unclosed]=x", ASSIGNMENT_TARGET, false},
    {"a[$(print x)]word", ASSIGNMENT_TARGET, false},
    {"a[1 + 0]=x", ASSIGNMENT_TARGET, false},
    {"a[(1 + 0)]=x", ASSIGNMENT_TARGET, true},
    {"a[$[1 + 0]]=x", ASSIGNMENT_TARGET, true},
    {"a[$((case + 1))]=x", ASSIGNMENT_TARGET, true},
    {"a[b[1 2]]=x", ASSIGNMENT_TARGET, false},
    {"[a[b]=x", ARRAY_ELEMENT_TARGET, true},
    {"[(a b)]=x", ARRAY_ELEMENT_TARGET, true},
    {"[a[1]]=x", ARRAY_ELEMENT_TARGET, false},
    {"[(a]b)]=x", ARRAY_ELEMENT_TARGET, false},
    {"[a\"$(print -r -- \"]\")\"b]", PATTERN_BRACKET, true},
    {"[a$(cat <<E\n]\nE\n)b]", PATTERN_BRACKET, true},
    {"[a$(case x in x) print ']';; esac)b]", PATTERN_BRACKET, true},
    {"[a$(case x in x) print ']';; })b]", PATTERN_BRACKET, true},
    {"[a$(case x { x) print ']';; esac)b]", PATTERN_BRACKET, true},
    {"[(a]b)]", PATTERN_BRACKET, false},
    {"[a|print b]", PATTERN_BRACKET, false},
    {"[a$(print unclosed]", PATTERN_BRACKET, false},
    {"[a<(case x in x) :;; esac)]", PATTERN_BRACKET, true},
    {"[a<(:)]=x", ARRAY_ELEMENT_TARGET, true},
    {"[a<1-3>]=x", ARRAY_ELEMENT_TARGET, true},
    {"[a b]}", DIRECTORY_PARAMETER, true},
    {"[a|b]}", DIRECTORY_PARAMETER, true},
    {"[a} b]", DIRECTORY_PARAMETER, false},
  };
  for (size_t i = 0; i < sizeof(cases) / sizeof(*cases); ++i) {
    size_t length = strlen(cases[i].source);
    int32_t *characters = ts_malloc(length * sizeof(*characters));
    assert(characters);
    for (size_t j = 0; j < length; ++j) characters[j] = cases[i].source[j];
    struct RecoveryInput input = {
      .lexer =
        {
          .lookahead = characters[0],
          .advance = recovery_advance,
          .mark_end = recovery_mark_end,
          .eof = recovery_eof,
        },
      .source = characters,
      .length = length,
    };
    struct Scanner scanner = {0};
    assert(init_source(&scanner));
    if (cases[i].kind == DIRECTORY_PARAMETER)
      assert(push(&scanner, PARAMETER_OPEN));
    struct NativeInput native = {.lexer = &input.lexer};
    struct LogicalLexer logical;
    assert(logical_init(&logical, &native, &scanner.source));
    bool found = cases[i].kind == ARITHMETIC_PREFIX
      ? arithmetic_start(&logical, NULL)
      : cases[i].kind == PATTERN_BRACKET
      ? pattern_bracket_start(&logical, NULL, false)
      : cases[i].kind == DIRECTORY_PARAMETER
      ? subscript_boundary(&logical, true, true, SOURCE_UNQUOTED, &scanner)
      : assignment_start(&logical, cases[i].kind == ARRAY_ELEMENT_TARGET, NULL);
    if (found != cases[i].expected)
      fprintf(stderr, "boundary: %s\n", cases[i].source);
    assert(found == cases[i].expected);
    assert(logical.consumed == 0 && current(&logical) == characters[0]);
    assert(logical.cursor.stage_count == 1);
    assert(native.lookahead_depth == 0);
    assert(!logical.cursor.stages[0].disabled);
    logical_clear(&logical);
    native_input_clear(&native);
    clear(&scanner);
    ts_free(characters);
  }
}

static void command_substitution_opening_keeps_lookahead_local(void) {
  const char text[] = "($(print abcdefghijklmnopqrstuvwxyz))";
  int32_t source[sizeof(text) - 1];
  for (size_t i = 0; i < sizeof(source) / sizeof(*source); ++i)
    source[i] = text[i];
  struct RecoveryInput input = {
    .lexer =
      {
        .lookahead = source[0],
        .advance = recovery_advance,
        .mark_end = recovery_mark_end,
        .eof = recovery_eof,
      },
    .source = source,
    .length = sizeof(source) / sizeof(*source),
  };
  struct Scanner state = {0};
  assert(init_source(&state));
  assert(push(&state, WORD_BEGIN));
  bool valid[TOKEN_COUNT] = {0};
  valid[COMMAND_OPEN] = true;
  assert(zsh_scanner_scan(&state, &input.lexer, valid));
  assert(input.lexer.result_symbol == COMMAND_OPEN);
  assert(state.remaining == 1 && input.marked == 0);
  assert(input.position <= 2 + LOOKAHEAD_EXTENSION);
  clear(&state);
}

static void failed_state_restoration_refuses_tokens_until_the_next_one(void) {
  const int32_t source[] = {'x', '\n'};
  struct RecoveryInput input = {
    .lexer =
      {
        .lookahead = source[0],
        .advance = recovery_advance,
        .mark_end = recovery_mark_end,
        .eof = recovery_eof,
      },
    .source = source,
    .length = sizeof(source) / sizeof(*source),
  };
  struct Scanner state = {0};
  assert(init_source(&state));
  assert(push(&state, WORD_BEGIN));
  assert(push(&state, DQ_OPEN));
  char encoded[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
  unsigned length = zsh_scanner_serialize(&state, encoded);
  assert(length > 1);
  struct Scanner copy = {0};
  zsh_scanner_deserialize(&copy, encoded, length - 1);
  assert(copy.failed && copy.count == 0);
  bool valid[TOKEN_COUNT];
  memset(valid, true, sizeof(valid));
  valid[RECOVERY] = false;
  assert(!zsh_scanner_scan(&copy, &input.lexer, valid));
  memset(valid, false, sizeof(valid));
  valid[RECOVERY] = true;
  assert(!zsh_scanner_scan(&copy, &input.lexer, valid));
  assert(input.position == 0);
  zsh_scanner_deserialize(&copy, encoded, length);
  assert(!copy.failed && copy.count == 2);
  assert(zsh_scanner_scan(&copy, &input.lexer, valid));
  assert(input.lexer.result_symbol == DOUBLE_QUOTE_TEXT && input.marked == 0);
  clear(&state);
  clear(&copy);
}

static void
timing_scope_survives_restoration_and_independent_command_sources(void) {
  for (size_t i = 0; i < 2; ++i) {
    enum Token open = i ? BACKQUOTE_OPEN : COMMAND_OPEN;
    enum Token close = i ? BACKQUOTE_CLOSE : COMMAND_CLOSE;
    struct Scanner state = {0}, copy = {0};
    assert(init_source(&state));
    assert(commit(&state, TIME_KEYWORD));
    assert(timing_context(&state));
    assert(commit(&state, LEFT_PAREN));
    assert(timing_context(&state));
    assert(commit(&state, RIGHT_PAREN));
    assert(commit(&state, WORD_BEGIN));
    assert(commit(&state, open));
    assert(!timing_context(&state));
    assert(commit(&state, TIME_KEYWORD));
    char encoded[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
    unsigned length = zsh_scanner_serialize(&state, encoded);
    assert(length > 0);
    zsh_scanner_deserialize(&copy, encoded, length);
    assert(timing_context(&copy));
    assert(commit(&copy, TIME_END));
    assert(!timing_context(&copy));
    assert(commit(&copy, close));
    assert(timing_context(&copy));
    assert(commit(&copy, WORD_END));
    assert(commit(&copy, TIME_END));
    assert(!timing_context(&copy));
    assert(copy.count == 0);
    clear(&state);
    clear(&copy);
  }
}

int main(void) {
  timing_scope_survives_restoration_and_independent_command_sources();
  unrecognized_recovery_source_preserves_context();
  recovery_tokens_preserve_boundaries_and_survive_restoration();
  heredoc_recovery_keeps_the_end_after_skipped_parameter_source();
  condition_recovery_closes_only_after_both_source_brackets();
  source_continuation_retains_physical_origin();
  logical_lookahead_restores_each_continuation_stage();
  dollar_quote_waits_for_its_quote_before_disabling_continuations();
  scanner_state_round_trip_preserves_pending_documents();
  substitution_closures_release_only_their_pending_documents();
  decoded_delimiter_bytes_survive_state_restoration();
  parameter_source_state_preserves_owners_and_pending_command_source();
  scanner_state_overflow_never_truncates_the_context_stack();
  modifier_operand_start_survives_state_restoration();
  removed_source_preserves_lexical_context_state();
  glob_argument_state_keeps_its_source_delimiter_after_restoration();
  redirect_substitution_restores_keyword_position_after_round_trip();
  boundary_lookahead_restores_input_after_success_and_failure();
  command_substitution_opening_keeps_lookahead_local();
  failed_state_restoration_refuses_tokens_until_the_next_one();
  return 0;
}
