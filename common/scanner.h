#include "input.h"
#include "tokens.h"
#include <stdlib.h>

enum SourceQuoting {
  SOURCE_UNQUOTED,
  SOURCE_DOUBLE_QUOTED,
  SOURCE_HERE_DOCUMENT,
  SOURCE_ARITHMETIC,
  SOURCE_PARAMETER_QUOTED,
};

enum GlobArgument {
  GLOB_NO_ARGUMENT,
  GLOB_INTEGER,
  GLOB_RANGE,
  GLOB_MODE,
  GLOB_TIME,
  GLOB_SIZE,
  GLOB_NAME,
  GLOB_ORDER,
  GLOB_DELIMITED,
  GLOB_SOURCE,
};

enum ParameterCharacter {
  PARAMETER_LITERAL,
  PARAMETER_SPECIAL,
  PARAMETER_QUOTED_DOLLAR,
};

enum SubscriptFlag {
  SUBSCRIPT_MATCH = 1,
  SUBSCRIPT_LITERAL_MATCH = 2,
};

struct Context {
  enum Token opener;
  size_t stages;
  bool disabled;
  int32_t delimiter;
  size_t arguments;
  size_t braces;
  size_t parentheses;
  size_t brackets;
  bool initial;
  bool word_start;
  bool word_only;
  enum SourceQuoting quoting;
  enum ParameterCharacter delimiter_kind;
  int32_t flag_name;
  size_t source_depth;
  bool source_tail;
  bool extended_glob;
  bool parameter_pattern;
  bool pattern_negated;
  bool pattern_excluded;
  unsigned subscript_flags;
};

struct ParameterSourceFrame {
  enum Token opener;
  enum SourceQuoting quoting;
  bool escaped;
  bool dollar;
  size_t remaining;
};

enum { DOCUMENT_STAGE_COUNT = 5 };

struct Document {
  uint8_t *delimiter;
  size_t length;
  size_t depth;
  size_t delimiter_remaining;
  bool quoted;
  bool strip_tabs;
  bool active;
  bool finished;
  bool found;
  bool ending;
  bool end_line;
  bool declaring;
};

struct Scanner {
  struct SourceSnapshot source;
  struct Context *contexts;
  size_t count;
  size_t capacity;
  struct ParameterSourceFrame *parameter_frames;
  size_t parameter_count;
  size_t parameter_capacity;
  enum Token emission;
  size_t remaining;
  size_t character;
  bool physical;
  bool removed_newline;
  struct Document *documents;
  size_t document_count;
  size_t document_capacity;
  bool strip_next;
  int32_t argument_delimiter;
  bool word_only;
  bool failed;
};

static bool word_context(enum Token token) {
  return token == WORD_BEGIN ||
    token == REDIRECT_WORD_BEGIN ||
    token == FUNCTION_ARGUMENT_BEGIN ||
    token == COUNT_WORD_BEGIN;
}

static bool scalar_assignment_context(enum Token token) {
  return token == ASSIGNMENT_BEGIN || token == DECLARATION_ASSIGNMENT_BEGIN;
}

static bool assignment_context(enum Token token) {
  return scalar_assignment_context(token) || token == ARRAY_ELEMENT_BEGIN;
}

static bool declaration_keyword(enum Token token) {
  switch (token) {
    case DECLARE_KEYWORD:
    case EXPORT_KEYWORD:
    case FLOAT_KEYWORD:
    case INTEGER_KEYWORD:
    case LOCAL_KEYWORD:
    case READONLY_KEYWORD:
    case TYPESET_KEYWORD:
      return true;
    default:
      return false;
  }
}

static bool modifier_context(enum Token token) {
  return token == MODIFIER_BEGIN ||
    token == UNBRACED_MODIFIER_BEGIN ||
    token == GLOB_MODIFIER_BEGIN;
}

static bool modifier_initial(int32_t c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '&';
}

static bool precommand_context(enum Token token) {
  return token == PRECOMMAND_PLAIN_NAME ||
    token == PRECOMMAND_EXEC_NAME ||
    token == PRECOMMAND_COMMAND_NAME;
}

static bool substitution_context(enum Token token) {
  return token == COMMAND_OPEN || token == BACKQUOTE_OPEN;
}

static bool timing_context(const struct Scanner *s) {
  for (size_t i = s->count; i > 0; --i) {
    enum Token opener = s->contexts[i - 1].opener;
    if (opener == TIME_KEYWORD) return true;
    if (substitution_context(opener)) break;
  }
  return false;
}

static bool subscript_context(enum Token token) {
  return token == SUBSCRIPT_OPEN ||
    token == SUBSCRIPT_PAREN_OPEN ||
    token == SUBSCRIPT_BRACKET_OPEN ||
    token == SUBSCRIPT_BRACE_OPEN;
}

static bool key_context(enum Token token) {
  return token == ARRAY_KEY_OPEN || token == ARRAY_KEY_GROUP_OPEN;
}

static bool arithmetic_key_context(const struct Scanner *s) {
  for (size_t i = s->count; i > 0; --i) {
    enum Token token = s->contexts[i - 1].opener;
    if (token == ARRAY_KEY_GROUP_OPEN) continue;
    return token == ARRAY_KEY_OPEN &&
      i > 1 &&
      s->contexts[i - 2].opener == ARRAY_ELEMENT_BEGIN;
  }
  return false;
}

static bool arithmetic_context(enum Token token);

static enum SourceQuoting source_quoting(const struct Scanner *s) {
  if (!s->count) return SOURCE_UNQUOTED;
  const struct Context *top = &s->contexts[s->count - 1];
  if (top->opener == DQ_OPEN) return SOURCE_DOUBLE_QUOTED;
  if (top->opener == DOCUMENT_BEGIN) return SOURCE_HERE_DOCUMENT;
  if (arithmetic_context(top->opener)) return SOURCE_ARITHMETIC;
  return top->quoting;
}

static bool name_start(int32_t c) {
  return c == '_' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}
static bool digit(int32_t c) {
  return c >= '0' && c <= '9';
}
static bool name_character(int32_t c) {
  return name_start(c) || digit(c);
}
static bool in_set(int32_t c, const char *set) {
  return c > 0 && c < 128 && strchr(set, (char)c) != NULL;
}

static int32_t closing_delimiter(int32_t c) {
  switch (c) {
    case '(':
      return ')';
    case '[':
      return ']';
    case '{':
      return '}';
    case '<':
      return '>';
    default:
      return c;
  }
}
static bool horizontal(int32_t c) {
  return c == ' ' || c == '\t';
}
static bool boundary(int32_t c) {
  return c == SOURCE_END_BOUNDARY ||
    c == SOURCE_BACKQUOTE_BOUNDARY ||
    horizontal(c) ||
    c == '\n' ||
    c == ';' ||
    c == '&' ||
    c == '|' ||
    c == '<' ||
    c == '>' ||
    c == '(' ||
    c == ')' ||
    c == '}';
}

static int32_t current(const struct LogicalLexer *input) {
  return input->result == SOURCE_CHARACTER ? input->lexer.lookahead
                                           : SOURCE_END_BOUNDARY;
}

static bool word_boundary(struct LogicalLexer *in, enum Token context) {
  int32_t c = current(in);
  if (c != '}') return boundary(c);
  if (scalar_assignment_context(context)) return false;
  int32_t next = logical_peek(in);
  return next != '}' && boundary(next);
}

static bool pattern_context(enum Token token) {
  return token == PATTERN_GROUP_OPEN ||
    token == PATTERN_FLAGS_OPEN ||
    token == GLOB_QUALIFIER_OPEN ||
    token == PATTERN_BRACKET_OPEN ||
    token == PATTERN_CLASS_OPEN ||
    token == GLOB_ARGUMENT_BEGIN ||
    token == BRACE_EXPANSION_OPEN;
}

static unsigned subscript_flags(const struct Scanner *s) {
  for (size_t i = s->count; i > 0; --i) {
    const struct Context *context = &s->contexts[i - 1];
    if (context->opener == SUBSCRIPT_OPEN) return context->subscript_flags;
    if (
      !subscript_context(context->opener) && !pattern_context(context->opener)
    )
      break;
  }
  return 0;
}

static bool subscript_pattern(const struct Scanner *s) {
  return subscript_flags(s) == SUBSCRIPT_MATCH;
}

static const struct Context *word_source_owner(const struct Scanner *s) {
  for (size_t i = s->count; i > 0; --i)
    if (!pattern_context(s->contexts[i - 1].opener)) return &s->contexts[i - 1];
  return NULL;
}

static bool pattern_syntax(const struct Scanner *s) {
  if (s->count && subscript_context(s->contexts[s->count - 1].opener))
    return subscript_pattern(s);
  enum SourceQuoting quoting = source_quoting(s);
  if (!quoting) return true;
  if (quoting != SOURCE_PARAMETER_QUOTED) return false;
  for (size_t i = s->count; i > 0; --i) {
    const struct Context *context = &s->contexts[i - 1];
    if (pattern_context(context->opener)) continue;
    if (subscript_context(context->opener)) return subscript_pattern(s);
    return context->opener == PARAMETER_REPLACEMENT_OPERATOR
      ? context->arguments == 0
      : context->opener == PARAMETER_OPEN && context->parameter_pattern;
  }
  return false;
}

static bool extended_glob(const struct Scanner *s) {
  for (size_t i = s->count; i > 0; --i) {
    const struct Context *context = &s->contexts[i - 1];
    enum Token token = context->opener;
    if (pattern_context(token)) continue;
    if (modifier_context(token) || token == PARAMETER_SUBSTRING_OPERATOR)
      return false;
    if (token == PARAMETER_REPLACEMENT_OPERATOR) {
      return context->arguments == 0 &&
        (ZSH_EXTENDED_GLOB || (i > 1 && s->contexts[i - 2].extended_glob));
    }
    break;
  }
  return ZSH_EXTENDED_GLOB;
}

static bool filename_pattern(const struct Scanner *s) {
  for (size_t i = s->count; i > 0; --i) {
    enum Token token = s->contexts[i - 1].opener;
    if (substitution_context(token)) return true;
    if (
      token == CASE_PATTERN_BEGIN ||
      token == CONDITION_BEGIN ||
      token == CONDITION_GROUP_OPEN ||
      subscript_context(token) ||
      token == PARAMETER_OPEN ||
      token == PARAMETER_REPLACEMENT_OPERATOR ||
      modifier_context(token)
    )
      return false;
  }
  return true;
}

static bool pattern_path_context(const struct Scanner *s) {
  for (size_t i = s->count; i > 0; --i) {
    const struct Context *context = &s->contexts[i - 1];
    if (context->pattern_excluded) return false;
    if (!pattern_context(context->opener)) break;
  }
  return filename_pattern(s);
}

static bool argument_source(const struct Context *owner) {
  if (!owner) return true;
  enum Token token = owner->opener;
  return word_context(token) ||
    token == ASSIGNMENT_BEGIN ||
    token == DECLARATION_ASSIGNMENT_BEGIN ||
    token == ARRAY_ELEMENT_BEGIN ||
    token == ARRAY_OPEN ||
    token == ARRAY_KEY_OPEN ||
    token == ARRAY_KEY_GROUP_OPEN ||
    token == SUBSCRIPT_PREFIX_OPEN ||
    token == UNBRACED_MODIFIER_BEGIN ||
    precommand_context(token) ||
    substitution_context(token) ||
    token == TIME_KEYWORD ||
    token == LEFT_PAREN ||
    token == FOR_WORDS_OPEN ||
    token == CASE_PATTERN_BEGIN ||
    token == REGEX_BEGIN ||
    token == CONDITION_BEGIN ||
    token == CONDITION_GROUP_OPEN;
}

static bool process_start(const struct Scanner *s, struct LogicalLexer *in) {
  int32_t c = current(in);
  if ((c != '<' && c != '>' && c != '=') || logical_peek(in) != '(')
    return false;
  const struct Context *owner = NULL;
  for (size_t i = s->count; i > 0; --i) {
    enum Token token = s->contexts[i - 1].opener;
    if (
      pattern_context(token) ||
      token == ARRAY_KEY_OPEN ||
      token == ARRAY_KEY_GROUP_OPEN ||
      token == SUBSCRIPT_PREFIX_OPEN ||
      token == UNBRACED_MODIFIER_BEGIN ||
      token == GLOB_MODIFIER_BEGIN
    )
      continue;
    owner = &s->contexts[i - 1];
    break;
  }
  if (!argument_source(owner)) return false;
  if (c != '=') return true;
  if (!s->count || s->contexts[s->count - 1].opener == TIME_KEYWORD)
    return true;
  const struct Context *top = &s->contexts[s->count - 1];
  return (top->word_start ||
           (top->opener == CASE_PATTERN_BEGIN && top->initial)) &&
    (word_context(top->opener) ||
      top->opener == CASE_PATTERN_BEGIN ||
      top->opener == REGEX_BEGIN ||
      assignment_context(top->opener));
}

static bool word_source_grouped(const struct Scanner *s) {
  for (size_t i = s->count; i > 0; --i) {
    const struct Context *context = &s->contexts[i - 1];
    if (
      context->parentheses ||
      context->opener == PATTERN_GROUP_OPEN ||
      context->opener == PATTERN_FLAGS_OPEN ||
      context->opener == GLOB_QUALIFIER_OPEN
    )
      return true;
    if (!pattern_context(context->opener) && !modifier_context(context->opener))
      return context->opener == CASE_PATTERN_BEGIN && context->delimiter == '(';
  }
  return false;
}

static bool word_source_end(
  struct LogicalLexer *in,
  const struct Context *owner,
  bool grouped
) {
  if (in->result != SOURCE_CHARACTER) return true;
  int32_t c = current(in);
  if (owner) {
    switch (owner->opener) {
      case PARAMETER_OPEN:
        return c == '}';
      case PARAMETER_REPLACEMENT_OPERATOR:
        return c == '}' || (owner->arguments == 0 && c == '/');
      case PARAMETER_SUBSTRING_OPERATOR:
        return c == '}' || (owner->arguments == 0 && c == ':');
      case MODIFIER_BEGIN:
      case UNBRACED_MODIFIER_BEGIN:
      case GLOB_MODIFIER_BEGIN:
        if (c == owner->delimiter) return true;
        if (owner->initial) return c == '}';
        break;
      default:
        break;
    }
  }
  if (owner && owner->parentheses) {
    if (c == ')') return false;
    grouped = true;
  }
  if (grouped && (horizontal(c) || c == '\n' || c == '|' || c == '}'))
    return false;
  return word_boundary(in, owner ? owner->opener : WORD_BEGIN);
}

static bool enclosing_source_end(
  const struct Scanner *s,
  struct LogicalLexer *in,
  size_t count,
  bool grouped
) {
  if (in->result != SOURCE_CHARACTER) return true;
  int32_t c = current(in);
  bool nested_group = false;
  for (size_t i = count; i > 0; --i) {
    const struct Context *context = &s->contexts[i - 1];
    if (context->parentheses) {
      if (c == ')') return false;
      grouped = true;
    }
    switch (context->opener) {
      case UNBRACED_MODIFIER_BEGIN:
      case GLOB_MODIFIER_BEGIN:
        if (c == context->delimiter) return true;
        break;
      case PATTERN_BRACKET_OPEN:
      case ARRAY_KEY_OPEN:
      case SUBSCRIPT_PREFIX_OPEN:
      case SUBSCRIPT_OPEN:
      case SUBSCRIPT_BRACKET_OPEN:
        if (c == ']') return true;
        break;
      case PATTERN_CLASS_OPEN:
        if (c == context->delimiter && logical_peek(in) == ']') return true;
        break;
      case PATTERN_GROUP_OPEN:
      case PATTERN_FLAGS_OPEN:
      case GLOB_QUALIFIER_OPEN:
      case ARRAY_KEY_GROUP_OPEN:
      case SUBSCRIPT_PAREN_OPEN:
        if (c == ')') return true;
        grouped = true;
        nested_group = true;
        break;
      case BRACE_EXPANSION_OPEN:
        if (!nested_group && c == '}') return true;
        break;
      case SUBSCRIPT_BRACE_OPEN:
        if (c == '}') return true;
        break;
      case DQ_OPEN:
        return c == '"';
      case DOCUMENT_BEGIN:
        return c == '\n';
      case FLAG_ARGUMENT_OPEN:
        return c == context->delimiter || (c == '}' && !context->braces);
      case GLOB_ARGUMENT_BEGIN:
        if (!nested_group && context->delimiter && c == context->delimiter)
          return true;
        break;
      default:
        return word_source_end(in, context, grouped);
    }
  }
  return word_source_end(in, NULL, grouped);
}
static bool physical(enum Token token) {
  switch (token) {
    case ERE_SOURCE_BAR:
    case ERE_BAR:
    case ERE_LEFT_ANCHOR_BEGIN:
    case ERE_RIGHT_ANCHOR_BEGIN:
    case REGEX_OPEN:
    case REGEX_CLOSE:
    case ERE_WILDCARD_BEGIN:
    case ERE_STAR:
    case ERE_PLUS:
    case ERE_QUESTION:
    case ERE_INTERVAL_OPEN:
    case ERE_COMMA:
    case ERE_INTERVAL_CLOSE:
    case ERE_BRACKET_OPEN:
    case ERE_BRACKET_CLOSE:
    case ERE_NEGATION:
    case ERE_LITERAL_HYPHEN:
    case ERE_RANGE_END_HYPHEN:
    case ERE_HYPHEN:
    case ERE_CLASS_OPEN:
    case ERE_COLON:
    case ERE_COMPOUND_CLOSE:
    case ERE_COLLATING_OPEN:
    case ERE_DOT:
    case ERE_EQUIVALENCE_OPEN:
    case ERE_EQUAL:
    case SQ_OPEN:
    case SQ_CLOSE:
    case DQ_OPEN:
    case DQ_CLOSE:
    case DOLLAR_SQ_OPEN:
    case DOLLAR_SQ_CLOSE:
    case DOLLAR_SQ_QUOTE:
    case DOLLAR:
    case PARAMETER_DOLLAR:
    case COMMAND_OPEN:
    case COMMAND_CLOSE:
    case BACKQUOTE_OPEN:
    case BACKQUOTE_CLOSE:
    case PROCESS_IN:
    case PROCESS_OUT:
    case PROCESS_FILE:
    case SEMICOLON:
    case AMPERSAND:
    case PIPE:
    case NEGATION:
    case LEFT_PAREN:
    case FUNCTION_OPEN:
    case FOR_WORDS_OPEN:
    case CASE_PATTERN_OPEN:
    case CASE_PATTERN_CLOSE:
    case RIGHT_PAREN:
    case LEFT_BRACE:
    case HEADER_BRACE_OPEN:
    case RIGHT_BRACE:
    case IO_VARIABLE_OPEN:
    case IO_VARIABLE_CLOSE:
    case ARRAY_OPEN:
    case ARRAY_CLOSE:
    case ARRAY_KEY_OPEN:
    case ARRAY_KEY_CLOSE:
    case ARRAY_KEY_GROUP_OPEN:
    case ARRAY_KEY_GROUP_CLOSE:
    case PARAMETER_OPEN:
    case PARAMETER_CLOSE:
    case SUBSCRIPT_OPEN:
    case UNBRACED_SUBSCRIPT_OPEN:
    case SUBSCRIPT_PREFIX_OPEN:
    case SUBSCRIPT_CLOSE:
    case PARAMETER_FLAGS_OPEN:
    case PARAMETER_FLAGS_CLOSE:
    case SUBSCRIPT_FLAGS_OPEN:
    case SUBSCRIPT_FLAGS_CLOSE:
    case SUBSCRIPT_PAREN_OPEN:
    case SUBSCRIPT_PAREN_CLOSE:
    case SUBSCRIPT_BRACKET_OPEN:
    case SUBSCRIPT_BRACKET_CLOSE:
    case SUBSCRIPT_BRACE_OPEN:
    case SUBSCRIPT_BRACE_CLOSE:
    case ARITHMETIC_DOLLAR:
    case ARITHMETIC_OPEN:
    case ARITHMETIC_CLOSE_FIRST:
    case ARITHMETIC_CLOSE:
    case ARITHMETIC_SQUARE_OPEN:
    case ARITHMETIC_SQUARE_CLOSE:
    case ARITHMETIC_GROUP_OPEN:
    case ARITHMETIC_GROUP_CLOSE:
    case ARITHMETIC_FUNCTION_OPEN:
    case ARITHMETIC_FUNCTION_CLOSE:
    case CONDITION_OPEN:
    case CONDITION_CLOSE_FIRST:
    case CONDITION_CLOSE:
    case CONDITION_GROUP_OPEN:
    case CONDITION_GROUP_CLOSE:
    case PATTERN_BRACKET_OPEN:
    case PATTERN_BRACKET_CLOSE:
    case PATTERN_GROUP_OPEN:
    case PATTERN_GROUP_CLOSE:
    case PATTERN_FLAGS_OPEN:
    case PATTERN_FLAGS_CLOSE:
    case GLOB_QUALIFIER_OPEN:
    case GLOB_QUALIFIER_CLOSE:
    case NUMERIC_RANGE_OPEN:
    case NUMERIC_RANGE_CLOSE:
    case BRACE_EXPANSION_OPEN:
    case BRACE_EXPANSION_CLOSE:
      return true;
    default:
      return false;
  }
}

static void clear(struct Scanner *s) {
  source_snapshot_clear(&s->source);
  ts_free(s->contexts);
  ts_free(s->parameter_frames);
  for (size_t i = 0; i < s->document_count; ++i)
    ts_free(s->documents[i].delimiter);
  ts_free(s->documents);
  *s = (struct Scanner){0};
}

static bool init_source(struct Scanner *s) {
  if (s->source.stage_count) return true;
  s->source.stages = ts_malloc(sizeof(*s->source.stages));
  if (!s->source.stages) return false;
  s->source.stages[0] = source_stage(SOURCE_REMOVE_CONTINUATIONS);
  s->source.stage_count = 1;
  return true;
}

static enum SourceQuoting
context_quoting(const struct Scanner *s, enum Token token) {
  enum SourceQuoting quoting = source_quoting(s);
  if (token == PARAMETER_OPEN)
    return quoting ? SOURCE_PARAMETER_QUOTED : SOURCE_UNQUOTED;
  return pattern_context(token) ||
      subscript_context(token) ||
      modifier_context(token) ||
      token == PARAMETER_FLAGS_OPEN ||
      token == PARAMETER_REPLACEMENT_OPERATOR ||
      token == PARAMETER_SUBSTRING_OPERATOR ||
      token == SUBSCRIPT_FLAGS_OPEN ||
      token == FLAG_ARGUMENT_OPEN
    ? quoting
    : SOURCE_UNQUOTED;
}

static bool within_double_quotes(const struct Scanner *s) {
  for (size_t i = s->count; i > 0; --i) {
    enum Token opener = s->contexts[i - 1].opener;
    if (opener == DQ_OPEN) return true;
    if (substitution_context(opener)) break;
  }
  return false;
}

static void
document_stages(struct SourceStage *stages, const struct Document *d) {
  stages[0].disabled = true;
  stages[1] = source_stage(SOURCE_STRIP_LEADING_TABS);
  stages[1].disabled = !d->strip_tabs;
  stages[2] = source_stage(SOURCE_REMOVE_CONTINUATIONS);
  stages[2].disabled = d->quoted;
  stages[3] = source_stage(SOURCE_STRIP_LEADING_TABS);
  stages[3].disabled = true;
  stages[4] = source_stage(SOURCE_REMOVE_CONTINUATIONS);
  stages[4].disabled = true;
}

static struct Document *active_document(const struct Scanner *s);

static bool push_stages(struct Scanner *s, enum Token token, bool quoted) {
  size_t count = s->source.stage_count;
  if (token == SQ_OPEN || token == COMMENT_TEXT) {
    s->source.stages[count - 1].disabled = true;
    return true;
  }
  if (!substitution_context(token) && token != DOCUMENT_BEGIN) return true;
  size_t added = token == COMMAND_OPEN ? 1
    : token == DOCUMENT_BEGIN          ? DOCUMENT_STAGE_COUNT - 1
                                       : 2;
  struct SourceStage *stages =
    ts_realloc(s->source.stages, (count + added) * sizeof(*stages));
  if (!stages) return false;
  s->source.stages = stages;
  if (token == COMMAND_OPEN) {
    stages[count - 1].disabled = true;
    stages[count] = source_stage(SOURCE_REMOVE_CONTINUATIONS);
  } else if (token == BACKQUOTE_OPEN) {
    stages[count] = source_stage(SOURCE_BACKQUOTE_DECODE);
    stages[count].quoted = quoted;
    stages[count + 1] = source_stage(SOURCE_REMOVE_CONTINUATIONS);
  } else {
    const struct Document *doc = active_document(s);
    if (!doc) doc = &s->documents[s->document_count - 1];
    document_stages(&stages[count - 1], doc);
  }
  s->source.stage_count = count + added;
  return true;
}

static bool push(struct Scanner *s, enum Token token) {
  struct Context *contexts =
    source_grow(s->contexts, &s->capacity, s->count + 1, sizeof(*contexts));
  if (!contexts) return false;
  s->contexts = contexts;
  bool quoted = token == BACKQUOTE_OPEN && within_double_quotes(s);
  enum SourceQuoting quoting = context_quoting(s, token);
  size_t count = s->source.stage_count;
  s->contexts[s->count++] = (struct Context){
    .opener = token,
    .stages = count,
    .disabled = s->source.stages[count - 1].disabled,
    .initial = !modifier_context(token) || token == MODIFIER_BEGIN,
    .word_start = true,
    .word_only = s->word_only,
    .quoting = quoting,
    .source_depth = token == PARAMETER_OPEN ? s->parameter_count : 0,
  };
  struct Context *context = &s->contexts[s->count - 1];
  if (substitution_context(token)) s->word_only = false;
  else if (
    word_context(token) ||
    assignment_context(token) ||
    precommand_context(token) ||
    token == ARRAY_OPEN ||
    token == FOR_WORDS_OPEN ||
    token == ARITHMETIC_BEGIN ||
    token == CONDITION_BEGIN
  )
    s->word_only = true;
  int32_t delimiter = s->argument_delimiter;
  if (token == GLOB_QUALIFIER_OPEN) context->delimiter = 'q';
  if (token == PATTERN_CLASS_OPEN) context->delimiter = delimiter;
  if (token == FLAG_ARGUMENT_OPEN)
    context->delimiter = closing_delimiter(delimiter);
  if (token == FLAG_ARGUMENT_OPEN && s->count > 1)
    context->delimiter_kind = s->contexts[s->count - 2].delimiter_kind;
  if (token == GLOB_ARGUMENT_BEGIN && s->count > 1) {
    struct Context *parent = &s->contexts[s->count - 2];
    context->arguments = parent->arguments;
    parent->arguments = 0;
    if (context->arguments == GLOB_DELIMITED)
      context->delimiter = delimiter == '[' ? ']'
        : delimiter == '<'                  ? '>'
                                            : delimiter;
  }
  return push_stages(s, token, quoted);
}

static bool
word_only_after_context(enum Token opener, bool saved, bool previous) {
  if (opener == WORD_BEGIN) return true;
  if (
    opener == COUNT_WORD_BEGIN ||
    opener == ARITHMETIC_BEGIN ||
    opener == CONDITION_BEGIN ||
    opener == CASE_PATTERN_BEGIN
  )
    return false;
  if (
    opener == REDIRECT_WORD_BEGIN ||
    opener == FUNCTION_ARGUMENT_BEGIN ||
    assignment_context(opener) ||
    substitution_context(opener)
  )
    return saved;
  return previous;
}

static bool pop(struct Scanner *s) {
  if (!s->count) return false;
  struct Context context = s->contexts[--s->count];
  if (
    s->count &&
    (pattern_context(context.opener) || modifier_context(context.opener))
  ) {
    s->contexts[s->count - 1].braces += context.braces;
    s->contexts[s->count - 1].parentheses += context.parentheses;
  }
  if (context.opener == PARAMETER_OPEN && context.source_depth)
    s->parameter_count = context.source_depth - 1;
  s->word_only =
    word_only_after_context(context.opener, context.word_only, s->word_only);
  s->source.stage_count = context.stages;
  s->source.stages[context.stages - 1].disabled = context.disabled;
  return true;
}

static size_t depth(const struct Scanner *s) {
  size_t count = 0;
  for (size_t i = 0; i < s->count; ++i)
    if (substitution_context(s->contexts[i].opener)) count++;
  return count;
}
static struct Document *active_document(const struct Scanner *s) {
  for (size_t i = s->document_count; i > 0; --i)
    if (s->documents[i - 1].active && !s->documents[i - 1].finished)
      return &s->documents[i - 1];
  return NULL;
}
static struct Document *declaring_document(struct Scanner *s) {
  size_t current_depth = depth(s);
  for (size_t i = s->document_count; i > 0; --i)
    if (
      s->documents[i - 1].declaring &&
      s->documents[i - 1].depth == current_depth
    )
      return &s->documents[i - 1];
  return NULL;
}
static bool within_here_delimiter(const struct Scanner *s) {
  for (size_t i = s->document_count; i > 0; --i)
    if (s->documents[i - 1].declaring) return true;
  return false;
}
static struct Document *pending_document(struct Scanner *s) {
  size_t current_depth = depth(s);
  for (size_t i = 0; i < s->document_count; ++i)
    if (
      !s->documents[i].active &&
      !s->documents[i].finished &&
      !s->documents[i].declaring &&
      s->documents[i].depth == current_depth
    )
      return &s->documents[i];
  return NULL;
}
static void release_finished(struct Scanner *s) {
  while (s->document_count && s->documents[s->document_count - 1].finished)
    ts_free(s->documents[--s->document_count].delimiter);
}
static void finish_pending_documents(struct Scanner *s, size_t document_depth) {
  for (size_t i = 0; i < s->document_count; ++i) {
    struct Document *d = &s->documents[i];
    if (d->depth == document_depth && !d->active && !d->declaring)
      d->finished = true;
  }
  release_finished(s);
}
static bool word_only_after(enum Token token, bool previous) {
  if (declaration_keyword(token)) return true;
  switch (token) {
    case NEWLINE:
    case SEMICOLON:
    case AMPERSAND:
    case ASYNC_DISOWN:
    case PIPE:
    case PIPE_ERR:
    case AND_IF:
    case OR_IF:
    case NEGATION:
    case LEFT_PAREN:
    case RIGHT_PAREN:
    case LEFT_BRACE:
    case HEADER_BRACE_OPEN:
    case RIGHT_BRACE:
    case CONDITION_CLOSE:
    case ARITHMETIC_END:
    case IF_KEYWORD:
    case ELIF_KEYWORD:
    case THEN_KEYWORD:
    case ELSE_KEYWORD:
    case WHILE_KEYWORD:
    case UNTIL_KEYWORD:
    case DO_KEYWORD:
    case ESAC_KEYWORD:
    case ALWAYS_KEYWORD:
    case TIME_KEYWORD:
    case COPROC_KEYWORD:
    case NAME:
    case FUNCTION_BODY_BEGIN:
    case PRECOMMAND_NOCORRECT_NAME:
      return false;
    case FI_KEYWORD:
    case DONE_KEYWORD:
    case END_KEYWORD:
    case FOR_KEYWORD:
    case SELECT_KEYWORD:
    case FOREACH_KEYWORD:
    case REPEAT_KEYWORD:
    case CASE_KEYWORD:
    case IN_KEYWORD:
    case FUNCTION_KEYWORD:
    case CLOSED_BODY_END:
    case FUNCTION_ARGUMENTS_BEGIN:
      return true;
    default:
      return previous;
  }
}

static void track_word_only(struct Scanner *s, enum Token token) {
  s->word_only = word_only_after(token, s->word_only);
  if (
    (token == NEWLINE || token == SEMICOLON) &&
    s->count &&
    s->contexts[s->count - 1].opener == FOR_WORDS_OPEN
  )
    s->word_only = true;
}

static void track_context(struct Context *top, enum Token token) {
  bool layout = token == LAYOUT ||
    token == LAYOUT_END ||
    token == ARITHMETIC_OUTPUT_BASE ||
    token == ARITHMETIC_BASE_END;
  if (!layout)
    top->word_start = token == ASSIGNMENT_OPERATOR ||
      token == PARAMETER_VALUE_OPERATOR ||
      token == PARAMETER_PATTERN_OPERATOR ||
      token == PARAMETER_REPLACEMENT_SEPARATOR ||
      token == PARAMETER_SUBSTRING_SEPARATOR ||
      token == MODIFIER_SUBSTITUTION_OPEN ||
      token == MODIFIER_SUBSTITUTION_SEPARATOR ||
      token == BRACE_SEPARATOR ||
      token == PATTERN_ALTERNATION;
  if (
    word_context(top->opener) ||
    assignment_context(top->opener) ||
    top->opener == PARAMETER_OPEN
  ) {
    top->initial = token == ASSIGNMENT_OPERATOR ||
      token == PARAMETER_VALUE_OPERATOR ||
      token == PARAMETER_PATTERN_OPERATOR;
    if (token != LITERAL) top->delimiter = 0;
    if (token == PARAMETER_PATTERN_OPERATOR) top->parameter_pattern = true;
    else if (token == PARAMETER_VALUE_OPERATOR) top->parameter_pattern = false;
  }
  if (top->opener == CONDITION_BEGIN || top->opener == CONDITION_GROUP_OPEN)
    top->delimiter = token == CONDITION_CLOSE_FIRST ? ']' : 0;
  if (top->opener == CASE_PATTERN_BEGIN && !layout) {
    if (token == CASE_PATTERN_OPEN) top->delimiter = '(';
    top->initial = token == PATTERN_ALTERNATION || token == CASE_PATTERN_OPEN;
  }
  if (top->opener == PATTERN_BRACKET_OPEN && token != PATTERN_NEGATION)
    top->initial = false;
  if (
    top->opener == PATTERN_FLAGS_OPEN ||
    top->opener == GLOB_QUALIFIER_OPEN ||
    top->opener == GLOB_ARGUMENT_BEGIN
  )
    top->initial = false;
  if (arithmetic_context(top->opener) && !layout)
    top->arguments = token == ARITHMETIC_VARIABLE;
  if (subscript_context(top->opener)) {
    top->initial = token == SUBSCRIPT_COMMA;
    top->word_start = token == SUBSCRIPT_FLAGS_OPEN || token == SUBSCRIPT_COMMA;
    if (token == SUBSCRIPT_COMMA) top->subscript_flags = 0;
    if (!layout) top->arguments = token == ARITHMETIC_VARIABLE;
  }
  if (top->word_start) {
    top->pattern_negated = false;
    top->pattern_excluded = false;
  }
}

static bool context_opener(enum Token token) {
  switch (token) {
    case TIME_KEYWORD:
    case HERE_SEQUENCE_BEGIN:
    case LEFT_PAREN:
    case FOR_WORDS_OPEN:
    case DOCUMENT_BEGIN:
    case ARRAY_ELEMENT_BEGIN:
    case ASSIGNMENT_BEGIN:
    case DECLARATION_ASSIGNMENT_BEGIN:
    case ARRAY_OPEN:
    case PARAMETER_OPEN:
    case SUBSCRIPT_OPEN:
    case SUBSCRIPT_PREFIX_OPEN:
    case ARRAY_KEY_OPEN:
    case ARRAY_KEY_GROUP_OPEN:
    case PARAMETER_FLAGS_OPEN:
    case SUBSCRIPT_FLAGS_OPEN:
    case FLAG_ARGUMENT_OPEN:
    case SUBSCRIPT_PAREN_OPEN:
    case SUBSCRIPT_BRACKET_OPEN:
    case SUBSCRIPT_BRACE_OPEN:
    case PARAMETER_REPLACEMENT_OPERATOR:
    case PARAMETER_SUBSTRING_OPERATOR:
    case MODIFIER_BEGIN:
    case UNBRACED_MODIFIER_BEGIN:
    case GLOB_MODIFIER_BEGIN:
    case GLOB_ARGUMENT_BEGIN:
    case ARITHMETIC_BEGIN:
    case ARITHMETIC_SQUARE_OPEN:
    case ARITHMETIC_GROUP_OPEN:
    case ARITHMETIC_FUNCTION_OPEN:
    case CONDITION_BEGIN:
    case CONDITION_GROUP_OPEN:
    case REGEX_BEGIN:
    case PRECOMMAND_PLAIN_NAME:
    case PRECOMMAND_EXEC_NAME:
    case PRECOMMAND_COMMAND_NAME:
    case PATTERN_BRACKET_OPEN:
    case PATTERN_CLASS_OPEN:
    case PATTERN_GROUP_OPEN:
    case PATTERN_FLAGS_OPEN:
    case GLOB_QUALIFIER_OPEN:
    case NUMERIC_RANGE_OPEN:
    case BRACE_EXPANSION_OPEN:
    case CASE_PATTERN_BEGIN:
    case WORD_BEGIN:
    case REDIRECT_WORD_BEGIN:
    case FUNCTION_ARGUMENT_BEGIN:
    case COUNT_WORD_BEGIN:
    case SQ_OPEN:
    case DQ_OPEN:
    case DOLLAR_SQ_OPEN:
    case COMMAND_OPEN:
    case BACKQUOTE_OPEN:
      return true;
    default:
      return false;
  }
}

static bool context_closer(enum Token token) {
  switch (token) {
    case TIME_END:
    case COMMENT_TEXT:
    case ARRAY_ELEMENT_END:
    case ASSIGNMENT_END:
    case ARRAY_CLOSE:
    case PARAMETER_CLOSE:
    case SUBSCRIPT_CLOSE:
    case SUBSCRIPT_PREFIX_END:
    case ARRAY_KEY_CLOSE:
    case ARRAY_KEY_GROUP_CLOSE:
    case PARAMETER_FLAGS_CLOSE:
    case SUBSCRIPT_FLAGS_CLOSE:
    case FLAG_ARGUMENT_CLOSE:
    case FLAG_ARGUMENT_END:
    case SUBSCRIPT_PAREN_CLOSE:
    case SUBSCRIPT_BRACKET_CLOSE:
    case SUBSCRIPT_BRACE_CLOSE:
    case PARAMETER_REPLACEMENT_END:
    case PARAMETER_SUBSTRING_END:
    case MODIFIER_END:
    case GLOB_ARGUMENT_END:
    case GLOB_ARGUMENT_CLOSE:
    case ARITHMETIC_END:
    case ARITHMETIC_SQUARE_CLOSE:
    case ARITHMETIC_GROUP_CLOSE:
    case ARITHMETIC_FUNCTION_CLOSE:
    case CONDITION_GROUP_CLOSE:
    case REGEX_END:
    case PRECOMMAND_END:
    case PATTERN_BRACKET_CLOSE:
    case PATTERN_CLASS_CLOSE:
    case PATTERN_GROUP_CLOSE:
    case PATTERN_GROUP_END:
    case PATTERN_FLAGS_CLOSE:
    case GLOB_QUALIFIER_CLOSE:
    case NUMERIC_RANGE_CLOSE:
    case BRACE_EXPANSION_CLOSE:
    case BRACE_EXPANSION_END:
    case CASE_PATTERN_CLOSE:
    case WORD_END:
    case SQ_CLOSE:
    case DQ_CLOSE:
    case DOLLAR_SQ_CLOSE:
      return true;
    default:
      return false;
  }
}

static bool parameter_source_push(
  struct Scanner *s,
  enum Token opener,
  enum SourceQuoting quoting
) {
  struct ParameterSourceFrame *source = source_grow(
    s->parameter_frames,
    &s->parameter_capacity,
    s->parameter_count + 1,
    sizeof(*source)
  );
  if (!source) return false;
  s->parameter_frames = source;
  source[s->parameter_count++] = (struct ParameterSourceFrame){
    .opener = opener,
    .quoting = quoting,
  };
  return true;
}

static bool parameter_source_literal(const struct Scanner *s) {
  if (!s->parameter_count) return false;
  enum Token opener = s->parameter_frames[s->parameter_count - 1].opener;
  return opener == SQ_OPEN ||
    opener == DOLLAR_SQ_OPEN ||
    (opener == COMMAND_OPEN &&
      s->parameter_frames[s->parameter_count - 1].remaining);
}

static struct Context *group_source_owner(struct Scanner *s, enum Token group) {
  for (size_t i = s->count; i > 0; --i) {
    struct Context *owner = &s->contexts[i - 1];
    if (
      owner->opener == SQ_OPEN ||
      owner->opener == DQ_OPEN ||
      owner->opener == DOLLAR_SQ_OPEN ||
      owner->opener == FLAG_ARGUMENT_OPEN ||
      owner->opener == REGEX_BEGIN
    )
      break;
    if (group == BRACE_EXPANSION_OPEN ? owner->braces : owner->parentheses)
      return owner;
    if (
      owner->opener == group ||
      (group == PATTERN_GROUP_OPEN &&
        (owner->opener == PATTERN_FLAGS_OPEN ||
          owner->opener == GLOB_QUALIFIER_OPEN)) ||
      word_context(owner->opener) ||
      assignment_context(owner->opener) ||
      owner->opener == PARAMETER_OPEN ||
      owner->opener == CASE_PATTERN_BEGIN ||
      substitution_context(owner->opener)
    )
      break;
  }
  return NULL;
}

static bool commit(struct Scanner *s, enum Token token) {
  if (token == REMOVED_SOURCE || token == DELIMITER_PARAMETER_REFERENCE)
    return true;
  if (token == BRACE_EXPANSION_END) {
    if (!s->count || s->contexts[s->count - 1].opener != BRACE_EXPANSION_OPEN)
      return false;
    s->contexts[s->count - 1].braces++;
  } else if (token == PATTERN_GROUP_END) {
    if (
      !s->count ||
      (s->contexts[s->count - 1].opener != PATTERN_GROUP_OPEN &&
        s->contexts[s->count - 1].opener != PATTERN_FLAGS_OPEN &&
        s->contexts[s->count - 1].opener != GLOB_QUALIFIER_OPEN)
    )
      return false;
    s->contexts[s->count - 1].parentheses++;
  } else if (token == BRACE_SOURCE_CLOSE) {
    struct Context *owner = group_source_owner(s, BRACE_EXPANSION_OPEN);
    if (!owner) return false;
    owner->braces--;
  }
  if (token == ARITHMETIC_EXPRESSION_BEGIN || token == ARITHMETIC_FOR_BEGIN)
    token = ARITHMETIC_BEGIN;
  if (token == UNBRACED_SUBSCRIPT_OPEN) token = SUBSCRIPT_OPEN;
  if (token == MODIFIER_GLOBAL_BEGIN) token = MODIFIER_BEGIN;
  if (token == BRACE_COMMA || token == BRACE_SEQUENCE_SEPARATOR)
    token = BRACE_SEPARATOR;
  track_word_only(s, token);
  if (s->count) track_context(&s->contexts[s->count - 1], token);
  if (token == DLESS || token == DLESSDASH) s->strip_next = token == DLESSDASH;
  if (token == DOLLAR_SQ_QUOTE)
    s->source.stages[s->source.stage_count - 1].disabled = true;
  struct Document *d;
  switch (token) {
    case NEWLINE:
      d = active_document(s);
      if (d && d->ending) d->end_line = true;
      break;
    case DELIMITER_BEGIN:
      if (!s->document_count) return false;
      s->documents[s->document_count - 1].declaring = true;
      return true;
    case DELIMITER_END:
      d = declaring_document(s);
      if (!d || d->delimiter_remaining) return false;
      d->declaring = false;
      return true;
    case HERE_SEQUENCE_END:
      release_finished(s);
      return pop(s);
    case RIGHT_PAREN:
      return !s->count ||
        (s->contexts[s->count - 1].opener != LEFT_PAREN &&
          s->contexts[s->count - 1].opener != FOR_WORDS_OPEN) ||
        pop(s);
    case HERE_END_BEGIN:
      d = active_document(s);
      if (!d) return false;
      while (s->count && s->contexts[s->count - 1].opener != DOCUMENT_BEGIN)
        if (!pop(s)) return false;
      d->ending = true;
      return true;
    case HERE_END_FINISH:
      d = active_document(s);
      if (!d) return false;
      d->found = false;
      return true;
    case DOCUMENT_FINISH:
      d = active_document(s);
      if (!d) return false;
      d->finished = true;
      while (s->count && s->contexts[s->count - 1].opener != DOCUMENT_BEGIN)
        if (!pop(s)) return false;
      return pop(s);
    case CONDITION_CLOSE:
      while (
        s->count && s->contexts[s->count - 1].opener == CONDITION_GROUP_OPEN
      )
        if (!pop(s)) return false;
      return s->count &&
        s->contexts[s->count - 1].opener == CONDITION_BEGIN &&
        pop(s);
    case COMMAND_CLOSE:
    case BACKQUOTE_CLOSE:
      finish_pending_documents(s, depth(s));
      return pop(s);
    default:
      break;
  }
  if (context_opener(token)) {
    if (!push(s, token)) return false;
  } else if (context_closer(token)) {
    if (!pop(s)) return false;
    if (token == ARRAY_CLOSE && !pop(s)) return false;
  }
  if (token == PARAMETER_FLAGS_OPEN) {
    if (
      !s->parameter_count &&
      !parameter_source_push(s, PARAMETER_OPEN, source_quoting(s))
    )
      return false;
    if (s->count < 2) return false;
    struct Context *owner = &s->contexts[s->count - 2];
    if (owner->opener != PARAMETER_OPEN) return false;
    owner->source_depth = s->parameter_count;
  }
  if (
    token == PARAMETER_FLAGS_CLOSE &&
    s->count &&
    s->parameter_count == 1 &&
    s->contexts[s->count - 1].source_depth == 1
  ) {
    s->contexts[s->count - 1].source_depth = 0;
    s->parameter_count = 0;
  }
  if (s->parameter_count)
    s->source.stages[s->source.stage_count - 1].disabled =
      parameter_source_literal(s);
  return true;
}

static bool encode(const struct Scanner *s, uint8_t *buffer, size_t *length) {
  size_t offset = 0;
  uint8_t source[SOURCE_STATE_CAPACITY];
  size_t source_length;
  if (!source_snapshot_serialize(
        &s->source,
        source,
        sizeof(source),
        &source_length
      ))
    return false;
#define PUT(value) \
  do { \
    if (!source_write_unsigned( \
          buffer, \
          TREE_SITTER_SERIALIZATION_BUFFER_SIZE, \
          &offset, \
          (value) \
        )) \
      return false; \
  } while (0)
  PUT(source_length);
  if (source_length > TREE_SITTER_SERIALIZATION_BUFFER_SIZE - offset)
    return false;
  memcpy(buffer + offset, source, source_length);
  offset += source_length;
  PUT(s->count);
  for (size_t i = 0; i < s->count; ++i) {
    PUT(s->contexts[i].opener);
    PUT(s->contexts[i].stages);
    PUT(s->contexts[i].disabled);
    PUT(s->contexts[i].delimiter);
    PUT(s->contexts[i].arguments);
    PUT(s->contexts[i].braces);
    PUT(s->contexts[i].parentheses);
    PUT(s->contexts[i].initial);
    PUT(s->contexts[i].word_start);
    PUT(s->contexts[i].word_only);
    PUT(s->contexts[i].quoting);
    PUT(s->contexts[i].pattern_negated);
    PUT(s->contexts[i].pattern_excluded);
    if (s->contexts[i].opener == SUBSCRIPT_OPEN)
      PUT(s->contexts[i].subscript_flags);
    if (s->contexts[i].opener == ARITHMETIC_SQUARE_OPEN)
      PUT(s->contexts[i].brackets);
    if (s->contexts[i].opener == PARAMETER_FLAGS_OPEN)
      PUT(s->contexts[i].flag_name);
    if (
      s->contexts[i].opener == PARAMETER_FLAGS_OPEN ||
      s->contexts[i].opener == FLAG_ARGUMENT_OPEN
    )
      PUT(s->contexts[i].delimiter_kind);
    if (s->contexts[i].opener == PARAMETER_OPEN) {
      PUT(s->contexts[i].source_depth);
      PUT(s->contexts[i].source_tail);
      PUT(s->contexts[i].extended_glob);
      PUT(s->contexts[i].parameter_pattern);
    }
  }
  PUT(s->parameter_count);
  for (size_t i = 0; i < s->parameter_count; ++i) {
    PUT(s->parameter_frames[i].opener);
    PUT(s->parameter_frames[i].quoting);
    PUT(s->parameter_frames[i].escaped);
    PUT(s->parameter_frames[i].dollar);
    PUT(s->parameter_frames[i].remaining);
  }
  PUT(s->emission);
  PUT(s->remaining);
  PUT(s->character);
  PUT(s->physical);
  PUT(s->removed_newline);
  PUT(s->strip_next);
  PUT(s->argument_delimiter);
  PUT(s->word_only);
  PUT(s->document_count);
  for (size_t i = 0; i < s->document_count; ++i) {
    const struct Document *d = &s->documents[i];
    PUT(d->length);
    PUT(d->depth);
    PUT(d->delimiter_remaining);
    PUT(
      d->quoted |
      (d->strip_tabs << 1) |
      (d->active << 2) |
      (d->finished << 3) |
      (d->found << 4) |
      (d->ending << 5) |
      (d->declaring << 6) |
      (d->end_line << 7)
    );
    for (size_t j = 0; j < d->length; ++j) PUT((uint32_t)d->delimiter[j]);
  }
#undef PUT
  *length = offset;
  return true;
}

static bool decode(struct Scanner *s, const uint8_t *buffer, size_t length) {
  size_t offset = 0;
  uint64_t value;
#define GET(target) \
  do { \
    if ( \
      !source_read_unsigned(buffer, length, &offset, &value) || \
      value > SIZE_MAX \
    ) \
      return false; \
    (target) = value; \
  } while (0)
  size_t source_length;
  GET(source_length);
  if (
    source_length > length - offset ||
    !source_snapshot_deserialize(&s->source, buffer + offset, source_length)
  )
    return false;
  offset += source_length;
  size_t count;
  GET(count);
  if (count > (length - offset) / 13) return false;
  if (count) {
    s->contexts = ts_calloc(count, sizeof(*s->contexts));
    if (!s->contexts) return false;
    s->count = s->capacity = count;
  }
  for (size_t i = 0; i < count; ++i) {
    GET(s->contexts[i].opener);
    GET(s->contexts[i].stages);
    GET(s->contexts[i].disabled);
    GET(s->contexts[i].delimiter);
    GET(s->contexts[i].arguments);
    GET(s->contexts[i].braces);
    GET(s->contexts[i].parentheses);
    GET(s->contexts[i].initial);
    GET(s->contexts[i].word_start);
    GET(s->contexts[i].word_only);
    GET(s->contexts[i].quoting);
    GET(s->contexts[i].pattern_negated);
    GET(s->contexts[i].pattern_excluded);
    if (s->contexts[i].opener == SUBSCRIPT_OPEN)
      GET(s->contexts[i].subscript_flags);
    if (s->contexts[i].opener == ARITHMETIC_SQUARE_OPEN)
      GET(s->contexts[i].brackets);
    if (s->contexts[i].opener == PARAMETER_FLAGS_OPEN)
      GET(s->contexts[i].flag_name);
    if (
      s->contexts[i].opener == PARAMETER_FLAGS_OPEN ||
      s->contexts[i].opener == FLAG_ARGUMENT_OPEN
    ) {
      GET(s->contexts[i].delimiter_kind);
      if (s->contexts[i].delimiter_kind > PARAMETER_QUOTED_DOLLAR) return false;
    }
    if (s->contexts[i].opener == PARAMETER_OPEN) {
      GET(s->contexts[i].source_depth);
      GET(s->contexts[i].source_tail);
      GET(s->contexts[i].extended_glob);
      GET(s->contexts[i].parameter_pattern);
    }
    if (
      s->contexts[i].opener >= TOKEN_COUNT ||
      s->contexts[i].quoting > SOURCE_PARAMETER_QUOTED ||
      s->contexts[i].stages == 0 ||
      s->contexts[i].stages > s->source.stage_count
    )
      return false;
  }
  GET(s->parameter_count);
  if (s->parameter_count > (length - offset) / 5) return false;
  for (size_t i = 0; i < count; ++i)
    if (s->contexts[i].source_depth > s->parameter_count + 1) return false;
  if (s->parameter_count) {
    s->parameter_frames =
      ts_calloc(s->parameter_count, sizeof(*s->parameter_frames));
    if (!s->parameter_frames) return false;
    s->parameter_capacity = s->parameter_count;
  }
  for (size_t i = 0; i < s->parameter_count; ++i) {
    GET(s->parameter_frames[i].opener);
    GET(s->parameter_frames[i].quoting);
    GET(s->parameter_frames[i].escaped);
    GET(s->parameter_frames[i].dollar);
    GET(s->parameter_frames[i].remaining);
    if (
      s->parameter_frames[i].opener >= TOKEN_COUNT ||
      s->parameter_frames[i].quoting > SOURCE_PARAMETER_QUOTED
    )
      return false;
  }
  GET(s->emission);
  GET(s->remaining);
  GET(s->character);
  GET(s->physical);
  GET(s->removed_newline);
  GET(s->strip_next);
  GET(s->argument_delimiter);
  GET(s->word_only);
  GET(s->document_count);
  if (s->document_count > (length - offset) / 4) {
    s->document_count = 0;
    return false;
  }
  if (s->document_count) {
    s->documents = ts_calloc(s->document_count, sizeof(*s->documents));
    if (!s->documents) {
      s->document_count = 0;
      return false;
    }
    s->document_capacity = s->document_count;
  }
  for (size_t i = 0; i < s->document_count; ++i) {
    struct Document *d = &s->documents[i];
    size_t flags;
    GET(d->length);
    GET(d->depth);
    GET(d->delimiter_remaining);
    GET(flags);
    if (d->length > length - offset || flags > 255) return false;
    d->quoted = flags & 1;
    d->strip_tabs = flags & 2;
    d->active = flags & 4;
    d->finished = flags & 8;
    d->found = flags & 16;
    d->ending = flags & 32;
    d->declaring = flags & 64;
    d->end_line = flags & 128;
    if (d->length) {
      d->delimiter = ts_calloc(d->length, sizeof(*d->delimiter));
      if (!d->delimiter) return false;
    }
    for (size_t j = 0; j < d->length; ++j) {
      GET(d->delimiter[j]);
      if (value > UINT8_MAX) return false;
    }
  }
#undef GET
  return offset == length && s->emission < TOKEN_COUNT;
}

static enum Token source_character(int32_t c) {
  switch (c) {
    case '\'':
      return CHARACTER_SINGLE_QUOTE;
    case '"':
      return CHARACTER_DOUBLE_QUOTE;
    case '$':
      return CHARACTER_DOLLAR;
    case '(':
      return CHARACTER_LEFT_PAREN;
    case ')':
      return CHARACTER_RIGHT_PAREN;
    case '`':
      return CHARACTER_BACKQUOTE;
    case '<':
      return CHARACTER_LESS;
    case '>':
      return CHARACTER_GREATER;
    case '=':
      return CHARACTER_EQUALS;
    case ';':
      return CHARACTER_SEMICOLON;
    case '&':
      return CHARACTER_AMPERSAND;
    case '|':
      return CHARACTER_PIPE;
    case '!':
      return CHARACTER_BANG;
    case '{':
      return CHARACTER_LEFT_BRACE;
    case '}':
      return CHARACTER_RIGHT_BRACE;
    case '[':
      return CHARACTER_LEFT_BRACKET;
    case ']':
      return CHARACTER_RIGHT_BRACKET;
    case '*':
      return CHARACTER_STAR;
    case '+':
      return CHARACTER_PLUS;
    case '?':
      return CHARACTER_QUESTION;
    case '^':
      return CHARACTER_CARET;
    case ',':
      return CHARACTER_COMMA;
    case '.':
      return CHARACTER_DOT;
    case ':':
      return CHARACTER_COLON;
    case '-':
      return CHARACTER_HYPHEN;
    default:
      return TOKEN_COUNT;
  }
}

static bool emit(struct Scanner *s, TSLexer *lexer, const bool *valid) {
  struct SourceCursor cursor;
  if (!source_cursor_resume(&cursor, &s->source, NULL, NULL)) return false;
  size_t consumed = 0;
  enum Token token = s->physical            ? PREFIX
    : s->emission == LAYOUT                 ? LAYOUT_PIECE
    : s->emission == ARITHMETIC_OUTPUT_BASE ? ARITHMETIC_BASE_PIECE
    : s->emission == REMOVED_SOURCE         ? REMOVED_SOURCE
                                            : PIECE;
  if (s->removed_newline) {
    token = REMOVED_NEWLINE;
    if (lexer->lookahead != '\n') {
      source_cursor_clear(&cursor);
      return false;
    }
    source_feed(&cursor, '\n');
    lexer->advance(lexer, false);
    consumed = 1;
    s->removed_newline = false;
  } else {
    while (consumed < s->remaining && !lexer->eof(lexer)) {
      if (
        consumed &&
        (lexer->lookahead == '\\' || (s->physical && consumed == s->character))
      )
        break;
      int32_t c = lexer->lookahead;
      source_feed(&cursor, c);
      lexer->advance(lexer, false);
      consumed++;
      lexer->mark_end(lexer);
      if (s->physical && consumed - 1 == s->character) {
        token = source_character(c);
        break;
      }
      if (c == '\\') {
        if (lexer->lookahead == '\n' && consumed < s->remaining) {
          source_feed(&cursor, '\n');
          for (size_t i = 0; i < cursor.removal_count; ++i) {
            if (
              cursor.removals[i].kind == SOURCE_REMOVED_CONTINUATION &&
              cursor.removals[i].slash == (int64_t)consumed - 1
            ) {
              token = LINE_CONTINUATION;
              s->removed_newline = true;
              break;
            }
          }
        }
        break;
      }
    }
  }
  bool success = consumed > 0 &&
    token < TOKEN_COUNT &&
    valid[token] &&
    source_snapshot_at(&cursor, consumed, &s->source);
  source_cursor_clear(&cursor);
  if (!success) return false;
  lexer->mark_end(lexer);
  for (size_t i = 0; i < s->document_count; ++i) {
    struct Document *d = &s->documents[i];
    if (d->declaring) {
      if (consumed > d->delimiter_remaining) return false;
      d->delimiter_remaining -= consumed;
    }
  }
  s->remaining -= consumed;
  s->character = s->character > consumed ? s->character - consumed : 0;
  if (s->remaining == 0 && !commit(s, s->emission)) return false;
  lexer->result_symbol = token;
  return true;
}

static void advance(struct LogicalLexer *input) {
  input->lexer.advance(&input->lexer, false);
}
// Read past the longest keyword and its boundary so keyword-to-word edits
// invalidate reused reductions closed by zero-width list markers.
enum { LOOKAHEAD_EXTENSION = 16 };
static void extend_lookahead(struct LogicalLexer *in) {
  struct LogicalPosition saved = logical_position(in);
  while (horizontal(current(in))) advance(in);
  for (
    size_t i = 0; i < LOOKAHEAD_EXTENSION && in->result == SOURCE_CHARACTER; ++i
  )
    advance(in);
  logical_restore_position(in, &saved);
}
static bool closing_brace_start(struct LogicalLexer *in) {
  if (current(in) != '}') return false;
  struct LogicalPosition saved = logical_position(in);
  do {
    advance(in);
  } while (current(in) == '}');
  bool result = boundary(current(in));
  logical_restore_position(in, &saved);
  return result;
}
static void skip_name(struct LogicalLexer *in) {
  while (name_character(current(in))) advance(in);
}
static void skip_digits(struct LogicalLexer *in) {
  while (digit(current(in)) || current(in) == '_') advance(in);
}
static void skip_numeric_range(struct LogicalLexer *in) {
  do {
    advance(in);
  } while (in->result == SOURCE_CHARACTER && current(in) != '>');
  advance(in);
}
static void skip_line(struct LogicalLexer *in) {
  while (
    in->result == SOURCE_CHARACTER &&
    current(in) != '\n' &&
    !logical_backquote_end(in)
  )
    advance(in);
}

static bool read_comment(struct LogicalLexer *in) {
  size_t index = in->cursor.stage_count - 1;
  struct SourceStage original = in->cursor.stages[index], raw = original;
  raw.disabled = true;
  if (!logical_replace_view(in, index, &raw, 1)) return false;
  skip_line(in);
  return logical_replace_view(in, index, &original, 1);
}

static enum Token comment_kind(struct LogicalLexer *in) {
  struct LogicalLexer ahead;
  if (!logical_fork(&ahead, in, in->consumed, in->cursor.stage_count, NULL, 0))
    return TOKEN_COUNT;
  enum Token token = TOKEN_COUNT;
  if (read_comment(&ahead))
    token = current(&ahead) == '\n' ? COMMENT_TEXT : TRAILING_COMMENT_TEXT;
  logical_clear(&ahead);
  return token;
}

static bool dollar_group(int32_t next) {
  return next == '(' || next == '[' || next == '{';
}
static bool double_quote_escape(int32_t next) {
  return next == '$' || next == '`' || next == '\\' || next == '"';
}
static bool dollar_quote_start(struct LogicalLexer *in) {
  return current(in) == '$' && logical_peek(in) == '\'';
}
static bool expansion_start(struct LogicalLexer *in) {
  if (current(in) != '$') return false;
  int32_t next = logical_peek(in);
  if (in_set(next, "^=~+")) {
    struct LogicalPosition saved = logical_position(in);
    advance(in);
    while (in_set(current(in), "^=~")) advance(in);
    bool result = true;
    if (current(in) == '+') {
      advance(in);
      result = name_character(current(in));
    }
    logical_restore_position(in, &saved);
    return result;
  }
  return next == '\'' ||
    dollar_group(next) ||
    name_character(next) ||
    in_set(next, "?!#$*-@");
}
static bool
quoted_expansion_start(struct LogicalLexer *in, enum SourceQuoting quoting) {
  return expansion_start(in) && (!quoting || !dollar_quote_start(in));
}
static bool quoted_part_start(int32_t c) {
  return c == '\\' || c == '\'' || c == '"' || c == '`';
}
static bool nested_source_start(struct LogicalLexer *in) {
  int32_t c = current(in);
  return c == '\'' ||
    c == '"' ||
    c == '`' ||
    (c == '$' && (dollar_group(logical_peek(in)) || logical_peek(in) == '\''));
}
static bool class_start(struct LogicalLexer *in) {
  int32_t next = logical_peek(in);
  return current(in) == '[' && (next == ':' || next == '=' || next == '.');
}

static size_t subscript_boundary(
  struct LogicalLexer *in,
  bool element,
  bool word_boundary,
  enum SourceQuoting quoting,
  const struct Scanner *owner
);

static bool
assignment_start(struct LogicalLexer *in, bool element, size_t *value_start) {
  struct LogicalPosition start = logical_position(in);
  if (element) {
    if (current(in) != '[') return false;
  } else {
    if (digit(current(in))) {
      do {
        advance(in);
      } while (digit(current(in)));
    } else {
      if (!name_start(current(in))) return false;
      do {
        advance(in);
      } while (name_character(current(in)));
    }
  }
  bool result = true;
  if (current(in) == '[') {
    size_t end = subscript_boundary(in, element, true, SOURCE_UNQUOTED, NULL);
    result = end != 0;
    while (in->result == SOURCE_CHARACTER && in->consumed < end) advance(in);
  }
  if (current(in) == '+') advance(in);
  result = result && current(in) == '=';
  if (result && value_start) {
    advance(in);
    *value_start = in->consumed;
  }
  logical_restore_position(in, &start);
  return result;
}

static bool arithmetic_context(enum Token token) {
  return token == ARITHMETIC_BEGIN ||
    token == ARITHMETIC_SQUARE_OPEN ||
    token == ARITHMETIC_GROUP_OPEN ||
    token == ARITHMETIC_FUNCTION_OPEN;
}

static struct Context *arithmetic_owner(struct Scanner *s) {
  for (size_t i = s->count; i > 0; --i) {
    struct Context *context = &s->contexts[i - 1];
    if (!arithmetic_context(context->opener)) break;
    if (
      context->opener == ARITHMETIC_BEGIN ||
      context->opener == ARITHMETIC_SQUARE_OPEN
    )
      return context;
  }
  return NULL;
}

static bool arithmetic_opening(int32_t c) {
  return c == '(' || c == '[';
}

static bool read_nested_boundary(
  struct LogicalLexer *in,
  bool arithmetic,
  bool *incomplete
);

static bool arithmetic_candidate(struct LogicalLexer *in, size_t *end);

// Memoization prevents repeated nested probes after a failed candidate.
// Depth-limited results are incomplete and must not be cached.
static bool arithmetic_start(struct LogicalLexer *in, size_t *end) {
  if (end) *end = 0;
  if (current(in) != '(' || logical_peek(in) != '(') return false;
  struct NativeInput *native = in->native;
  size_t position = logical_raw_position(in);
  const struct ProbeMemo *memo = probe_memo_find(native, position, in);
  if (memo) {
    if (end) *end = memo->end;
    return memo->result;
  }
  bool exhausted = native->depth_exhausted;
  native->depth_exhausted = false;
  size_t found = 0;
  bool result = arithmetic_candidate(in, &found);
  if (!native->depth_exhausted)
    probe_memo_store(native, position, in, found, result);
  native->depth_exhausted |= exhausted;
  if (end) *end = found;
  return result;
}

static bool arithmetic_candidate(struct LogicalLexer *in, size_t *end) {
  struct LogicalPosition saved = logical_position(in);
  size_t nesting = 0, brackets = 0;
  bool result = false;
  do {
    int32_t c = current(in);
    if (c == '`' || (c == '$' && dollar_group(logical_peek(in)))) {
      bool incomplete;
      if (!read_nested_boundary(in, true, &incomplete)) {
        result = incomplete;
        break;
      }
      continue;
    }
    advance(in);
    if (c == '\\' && in->result == SOURCE_CHARACTER) {
      if (!arithmetic_opening(current(in))) advance(in);
    } else if (c == '[') brackets++;
    else if (c == ']') {
      if (!brackets) break;
      brackets--;
    } else if (c == '(') nesting++;
    else if (c == ')') {
      if (--nesting == 1 && current(in) != ')') break;
      if (nesting == 0) {
        result = brackets == 0;
        if (result && end) *end = in->consumed;
        break;
      }
    }
  } while (in->result == SOURCE_CHARACTER && !logical_backquote_end(in));
  logical_restore_position(in, &saved);
  return result;
}

static bool matches(struct LogicalLexer *in, const char *text) {
  struct LogicalPosition saved = logical_position(in);
  for (size_t i = 0; text[i]; ++i) {
    if (current(in) != text[i]) {
      logical_restore_position(in, &saved);
      return false;
    }
    advance(in);
  }
  return true;
}

static bool numeric_range_start(struct LogicalLexer *in) {
  struct LogicalPosition saved = logical_position(in);
  if (current(in) != '<') return false;
  advance(in);
  while (digit(current(in))) advance(in);
  bool found = current(in) == '-';
  if (found) {
    advance(in);
    while (digit(current(in))) advance(in);
    found = current(in) == '>';
  }
  logical_restore_position(in, &saved);
  return found;
}

static bool command_word_end(struct LogicalLexer *in) {
  int32_t c = current(in);
  return word_boundary(in, WORD_BEGIN) &&
    !(c == '(' && logical_peek(in) != ')') &&
    !((c == '<' || c == '>') && logical_peek(in) == '(') &&
    !numeric_range_start(in);
}

static bool opens_command_word(struct LogicalLexer *in, size_t length) {
  struct LogicalPosition saved = logical_position(in);
  for (size_t i = 0; i < length; ++i) advance(in);
  bool result = command_word_end(in);
  logical_restore_position(in, &saved);
  return result;
}

static bool condition_open_start(struct LogicalLexer *in) {
  return current(in) == '[' &&
    logical_peek(in) == '[' &&
    opens_command_word(in, 2);
}

static bool case_terminator(enum Token token) {
  return token == CASE_BREAK ||
    token == CASE_FALLTHROUGH ||
    token == CASE_CONTINUE;
}

static enum Token read_control_operator(struct LogicalLexer *in) {
  int32_t c = current(in);
  if (!in_set(c, ";&|\n") || (c == '&' && logical_peek(in) == '>'))
    return TOKEN_COUNT;
  advance(in);
  int32_t next = current(in);
  enum Token token = c == ';' ? SEMICOLON
    : c == '&'                ? AMPERSAND
    : c == '|'                ? PIPE
                              : NEWLINE;
  if (c == ';') {
    if (next == ';') token = CASE_BREAK;
    else if (next == '&') token = CASE_FALLTHROUGH;
    else if (next == '|') token = CASE_CONTINUE;
    else return token;
  } else if (c == '&') {
    if (next == '&') token = AND_IF;
    else if (next == '|' || next == '!') token = ASYNC_DISOWN;
    else return token;
  } else if (c == '|') {
    if (next == '|') token = OR_IF;
    else if (next == '&') token = PIPE_ERR;
    else return token;
  } else return token;
  advance(in);
  return token;
}

static bool condition_close_start(struct LogicalLexer *in) {
  if (current(in) != ']' || logical_peek(in) != ']') return false;
  struct LogicalPosition saved = logical_position(in);
  advance(in);
  advance(in);
  bool result = command_word_end(in);
  logical_restore_position(in, &saved);
  return result;
}

static bool regex_boundary(
  const struct Scanner *s,
  struct LogicalLexer *in,
  const struct Context *context
) {
  int32_t c = current(in);
  if (c == '<' || c == '>')
    return !(context && context->delimiter == '>') &&
      !process_start(s, in) &&
      !numeric_range_start(in);
  if (c == ';' || c == '&') return true;
  if ((context && context->arguments) || c == '(') return false;
  if (c == '}')
    return !(context && context->braces) &&
      (context ? word_boundary(in, WORD_BEGIN) : closing_brace_start(in));
  return boundary(c);
}

static bool read_condition_word(struct LogicalLexer *in);

static enum Token
condition_operator(struct LogicalLexer *in, bool unary, size_t *length) {
  struct LogicalPosition saved = logical_position(in);
  enum Token token = TOKEN_COUNT;
  if (
    (current(in) == '<' || current(in) == '>') &&
    logical_peek(in) != '(' &&
    !numeric_range_start(in)
  ) {
    advance(in);
    return CONDITION_BINARY_OPERATOR;
  }
  if (matches(in, "=~")) token = CONDITION_REGEX_OPERATOR;
  else if (matches(in, "==") || matches(in, "!=") || matches(in, "="))
    token = CONDITION_PATTERN_OPERATOR;
  else if (current(in) == '-') {
    advance(in);
    if (unary && word_boundary(in, WORD_BEGIN) && current(in) != '(') {
      if (length) *length = 1;
      return CONDITION_UNARY_OPERATOR;
    }
    int32_t second = current(in);
    bool nonempty = !word_boundary(in, WORD_BEGIN);
    advance(in);
    size_t count = second >= 0 &&
        second < 128 &&
        second != '\\' &&
        second != '\'' &&
        second != '"' &&
        second != '`' &&
        word_boundary(in, WORD_BEGIN) &&
        current(in) != '('
      ? 2
      : 3;
    logical_restore_position(in, &saved);
    if (nonempty && (unary || count > 2) && read_condition_word(in)) {
      token = unary ? CONDITION_UNARY_OPERATOR : CONDITION_BINARY_OPERATOR;
      if (length) *length = count;
    }
  }
  if (
    token != TOKEN_COUNT && word_boundary(in, WORD_BEGIN) && current(in) != '('
  )
    return token;
  logical_restore_position(in, &saved);
  return TOKEN_COUNT;
}

static bool condition_operand(struct LogicalLexer *in) {
  for (;;) {
    while (horizontal(current(in)) || current(in) == '\n') advance(in);
    if (current(in) != '#') break;
    if (!read_comment(in)) return false;
  }
  int32_t c = current(in), next = logical_peek(in);
  return in->result == SOURCE_CHARACTER &&
    !logical_backquote_end(in) &&
    c != ')' &&
    c != ';' &&
    !condition_close_start(in) &&
    !(c == '&' && next == '&') &&
    !(c == '|' && next == '|');
}

static bool condition_infix(struct LogicalLexer *in) {
  bool binary = false, short_second = false;
  size_t words = 1;
  while (words < 4 && condition_operand(in)) {
    if (words == 1) {
      struct LogicalPosition start = logical_position(in);
      binary = condition_operator(in, false, NULL) != TOKEN_COUNT;
      if (binary) {
        words++;
        continue;
      }
      size_t length = 0;
      short_second =
        condition_operator(in, true, &length) == CONDITION_UNARY_OPERATOR &&
        length == 2;
      logical_restore_position(in, &start);
    }
    if (!read_condition_word(in)) break;
    words++;
  }
  return words == 3 && (binary || short_second);
}

static bool brace_expansion_start(
  struct LogicalLexer *in,
  const struct Context *owner,
  bool grouped
);

static bool read_pattern_bracket(
  struct LogicalLexer *in,
  const struct Context *owner,
  bool grouped
) {
  struct LogicalPosition saved = logical_position(in);
  if (current(in) != '[') return false;
  advance(in);
  if (current(in) == '!' || current(in) == '^') advance(in);
  if (current(in) == ']') advance(in);
  size_t parentheses = 0, braces = 0;
  int32_t class_marker = 0;
  while (in->result == SOURCE_CHARACTER) {
    int32_t c = current(in);
    if (
      nested_source_start(in) ||
      ((c == '<' || c == '>') &&
        logical_peek(in) == '(' &&
        argument_source(owner))
    ) {
      if (!read_nested_boundary(in, false, NULL)) break;
      continue;
    }
    if (class_marker && c == class_marker && logical_peek(in) == ']') {
      advance(in);
      advance(in);
      class_marker = 0;
      continue;
    }
    if (!class_marker && class_start(in)) {
      advance(in);
      class_marker = current(in);
      advance(in);
      continue;
    }
    if (c == '(') {
      if (logical_peek(in) == ')') break;
      parentheses++;
    } else if (c == ')') {
      if (!parentheses) break;
      parentheses--;
    } else if (brace_expansion_start(in, owner, grouped || parentheses)) {
      braces++;
    } else if (c == '}' && braces) {
      braces--;
    } else if (word_source_end(in, owner, grouped || parentheses)) break;
    advance(in);
    if (c == '\\' && in->result == SOURCE_CHARACTER) advance(in);
    else if (c == ']' && !class_marker) {
      if (parentheses || braces) break;
      return true;
    }
  }
  logical_restore_position(in, &saved);
  return false;
}

static bool pattern_bracket_start(
  struct LogicalLexer *in,
  const struct Context *owner,
  bool grouped
) {
  struct LogicalPosition saved = logical_position(in);
  bool found = read_pattern_bracket(in, owner, grouped);
  logical_restore_position(in, &saved);
  return found;
}

static bool brace_expansion_start(
  struct LogicalLexer *in,
  const struct Context *owner,
  bool grouped
) {
  if (current(in) != '{') return false;
  struct LogicalPosition saved = logical_position(in);
  advance(in);
  bool result = current(in) == '}' ||
    !word_source_end(in, owner, grouped) ||
    !command_word_end(in);
  logical_restore_position(in, &saved);
  return result;
}

static bool read_pattern_parenthesis(
  struct LogicalLexer *in,
  const struct Context *owner,
  bool *alternative,
  bool extended
) {
  size_t parentheses = 0;
  if (alternative) *alternative = false;
  while (in->result == SOURCE_CHARACTER && !logical_backquote_end(in)) {
    int32_t c = current(in);
    if (c == '[' && read_pattern_bracket(in, NULL, true)) continue;
    if (c != '(' && c != ')' && word_source_end(in, owner, true)) return false;
    if (nested_source_start(in)) {
      if (!read_nested_boundary(in, false, NULL)) break;
      continue;
    }
    advance(in);
    if (c == '\\' && in->result == SOURCE_CHARACTER) advance(in);
    else if (c == '(') {
      if (parentheses && alternative) *alternative = true;
      parentheses++;
    } else if (c == ')' && --parentheses == 0) {
      return true;
    } else if ((c == '|' || (extended && c == '~')) && alternative)
      *alternative = true;
  }
  return false;
}

static bool bare_qualifier_start(
  struct LogicalLexer *in,
  const struct Context *owner,
  bool extended
) {
  struct LogicalPosition saved = logical_position(in);
  bool alternative = false;
  bool found = read_pattern_parenthesis(in, owner, &alternative, extended) &&
    !alternative &&
    boundary(current(in)) &&
    current(in) != '(' &&
    !numeric_range_start(in);
  logical_restore_position(in, &saved);
  return found;
}

static bool
case_pattern_prefix(struct LogicalLexer *in, const struct Context *owner) {
  struct LogicalPosition saved = logical_position(in);
  bool prefix = true;
  if (read_pattern_parenthesis(in, owner, NULL, false)) {
    bool separated = horizontal(current(in));
    while (horizontal(current(in))) advance(in);
    int32_t c = current(in);
    prefix = c != ')' &&
      c != '|' &&
      (separated || (boundary(c) && c != '(' && !numeric_range_start(in)));
  }
  logical_restore_position(in, &saved);
  return prefix;
}

static bool
glob_argument_character(enum GlobArgument kind, int32_t c, bool initial) {
  if (kind == GLOB_NAME) return name_character(c);
  if (kind == GLOB_ORDER) return initial && in_set(c, "nLlamcdN");
  if (digit(c)) return true;
  if (kind == GLOB_RANGE) return c == ',';
  if (kind == GLOB_MODE && (c == '?' || (initial && c == '='))) return true;
  if (c == '+' || c == '-') return initial;
  if (!initial) return false;
  if (kind == GLOB_TIME) return in_set(c, "Mwdhms");
  if (kind == GLOB_SIZE) return in_set(c, "kKmMpPgGtT");
  return false;
}

static bool
arithmetic_character_boundary(struct LogicalLexer *in, bool semicolon) {
  int32_t c = current(in);
  return in->result != SOURCE_CHARACTER ||
    c == '(' ||
    c == '[' ||
    c == ')' ||
    c == ']' ||
    (semicolon && c == ';') ||
    c == '`' ||
    expansion_start(in);
}

static bool
arithmetic_character(struct LogicalLexer *in, bool escaped, bool semicolon) {
  while (in->result == SOURCE_CHARACTER) {
    int32_t c = current(in);
    if (
      arithmetic_opening(c) ||
      (!escaped && arithmetic_character_boundary(in, semicolon))
    )
      return false;
    escaped = false;
    advance(in);
    if (c == '^') {
      if (arithmetic_character_boundary(in, semicolon)) return false;
      advance(in);
      return true;
    }
    if (c != '\\' || in->result != SOURCE_CHARACTER) return true;
    c = current(in);
    if (arithmetic_opening(c)) return false;
    advance(in);
    if (c == 'M' || c == 'C') {
      if (current(in) == '-') advance(in);
      continue;
    }
    bool octal = c >= '0' && c <= '7';
    size_t remaining = c == 'u' ? 4
      : c == 'U'                ? 8
      : c == 'x'                ? 2
      : octal                   ? 2
                                : 0;
    while (remaining && in->result == SOURCE_CHARACTER) {
      int32_t value = current(in);
      if (
        octal ? value < '0' || value > '7'
              : !digit(value) &&
            !(value >= 'a' && value <= 'f') &&
            !(value >= 'A' && value <= 'F')
      )
        break;
      advance(in);
      remaining--;
    }
    return true;
  }
  return false;
}

static enum Token arithmetic_token(
  struct LogicalLexer *in,
  const bool *valid,
  bool after_variable
) {
  int32_t c = current(in);
  if (
    valid[ARITHMETIC_NUMBER] &&
    (digit(c) || (c == '.' && digit(logical_peek(in))))
  ) {
    bool based = c == '0' && in_set(logical_peek(in), "xXbB");
    advance(in);
    if (based) {
      advance(in);
      skip_name(in);
    } else {
      skip_digits(in);
      if (current(in) == '#') {
        advance(in);
        skip_name(in);
      } else {
        if (current(in) == '.') {
          advance(in);
          skip_digits(in);
        }
        if (current(in) == 'e' || current(in) == 'E') {
          advance(in);
          if (current(in) == '+' || current(in) == '-') advance(in);
          skip_digits(in);
        }
      }
    }
    return ARITHMETIC_NUMBER;
  }
  if (
    !after_variable &&
    c == '[' &&
    (logical_peek(in) == '#' || digit(logical_peek(in)))
  ) {
    struct LogicalPosition saved = logical_position(in);
    advance(in);
    bool output = current(in) == '#';
    while (digit(current(in)) || current(in) == '#' || current(in) == '_')
      advance(in);
    enum Token token = output ? ARITHMETIC_OUTPUT_BASE : ARITHMETIC_NUMBER;
    if (current(in) == ']' && valid[token]) {
      advance(in);
      if (!output) skip_name(in);
      return token;
    }
    logical_restore_position(in, &saved);
  }
  if (
    valid[ARITHMETIC_NUMBER] &&
    c == '#' &&
    (logical_peek(in) == '#' || logical_peek(in) == '\\')
  ) {
    bool escaped_prefix = logical_peek(in) == '\\';
    advance(in);
    advance(in);
    if (!arithmetic_character(in, escaped_prefix, valid[SEMICOLON]))
      return valid[ARITHMETIC_OPERATOR] ? ARITHMETIC_OPERATOR : TOKEN_COUNT;
    return ARITHMETIC_NUMBER;
  }
  if (
    (valid[ARITHMETIC_VARIABLE] || valid[ARITHMETIC_FUNCTION_NAME]) &&
    name_start(c)
  ) {
    do {
      advance(in);
    } while (name_character(current(in)));
    struct LogicalPosition end = logical_position(in);
    while (horizontal(current(in))) advance(in);
    enum Token token = current(in) == '(' && valid[ARITHMETIC_FUNCTION_NAME]
      ? ARITHMETIC_FUNCTION_NAME
      : ARITHMETIC_VARIABLE;
    logical_restore_position(in, &end);
    if (valid[token]) return token;
  }
  static const struct {
    const char *spelling;
    enum Token token;
  } operators[] = {
    {"<<=", ARITHMETIC_ASSIGNMENT_OPERATOR},
    {">>=", ARITHMETIC_ASSIGNMENT_OPERATOR},
    {"&&=", ARITHMETIC_ASSIGNMENT_OPERATOR},
    {"||=", ARITHMETIC_ASSIGNMENT_OPERATOR},
    {"^^=", ARITHMETIC_ASSIGNMENT_OPERATOR},
    {"**=", ARITHMETIC_ASSIGNMENT_OPERATOR},
    {"++", ARITHMETIC_UPDATE_OPERATOR},
    {"--", ARITHMETIC_UPDATE_OPERATOR},
    {"<<", ARITHMETIC_SHIFT_OPERATOR},
    {">>", ARITHMETIC_SHIFT_OPERATOR},
    {"**", ARITHMETIC_POWER_OPERATOR},
    {"<=", ARITHMETIC_COMPARISON_OPERATOR},
    {">=", ARITHMETIC_COMPARISON_OPERATOR},
    {"==", ARITHMETIC_EQUALITY_OPERATOR},
    {"!=", ARITHMETIC_EQUALITY_OPERATOR},
    {"&&", ARITHMETIC_LOGICAL_AND_OPERATOR},
    {"||", ARITHMETIC_LOGICAL_OR_OPERATOR},
    {"^^", ARITHMETIC_LOGICAL_OR_OPERATOR},
    {"+=", ARITHMETIC_ASSIGNMENT_OPERATOR},
    {"-=", ARITHMETIC_ASSIGNMENT_OPERATOR},
    {"*=", ARITHMETIC_ASSIGNMENT_OPERATOR},
    {"/=", ARITHMETIC_ASSIGNMENT_OPERATOR},
    {"%=", ARITHMETIC_ASSIGNMENT_OPERATOR},
    {"&=", ARITHMETIC_ASSIGNMENT_OPERATOR},
    {"^=", ARITHMETIC_ASSIGNMENT_OPERATOR},
    {"|=", ARITHMETIC_ASSIGNMENT_OPERATOR},
    {"+", ARITHMETIC_ADDITIVE_OPERATOR},
    {"-", ARITHMETIC_ADDITIVE_OPERATOR},
    {"!", ARITHMETIC_UNARY_OPERATOR},
    {"~", ARITHMETIC_UNARY_OPERATOR},
    {"&", ARITHMETIC_BITWISE_AND_OPERATOR},
    {"^", ARITHMETIC_BITWISE_XOR_OPERATOR},
    {"|", ARITHMETIC_BITWISE_OR_OPERATOR},
    {"*", ARITHMETIC_MULTIPLICATIVE_OPERATOR},
    {"/", ARITHMETIC_MULTIPLICATIVE_OPERATOR},
    {"%", ARITHMETIC_MULTIPLICATIVE_OPERATOR},
    {"<", ARITHMETIC_COMPARISON_OPERATOR},
    {">", ARITHMETIC_COMPARISON_OPERATOR},
    {"?", ARITHMETIC_QUESTION_OPERATOR},
    {":", ARITHMETIC_COLON_OPERATOR},
    {"=", ARITHMETIC_ASSIGNMENT_OPERATOR},
    {",", ARITHMETIC_COMMA_OPERATOR},
    {"#", ARITHMETIC_UNARY_OPERATOR},
  };
  for (size_t i = 0; i < sizeof(operators) / sizeof(*operators); ++i) {
    if (matches(in, operators[i].spelling)) {
      if (valid[operators[i].token]) return operators[i].token;
      return valid[ARITHMETIC_OPERATOR] ? ARITHMETIC_OPERATOR : TOKEN_COUNT;
    }
  }
  return TOKEN_COUNT;
}

static bool descriptor_operator(struct LogicalLexer *in) {
  int32_t c = current(in);
  return (c == '<' || c == '>') &&
    logical_peek(in) != '(' &&
    !numeric_range_start(in);
}

static bool has_variable_descriptor(struct LogicalLexer *in) {
  struct LogicalPosition saved = logical_position(in);
  advance(in);
  bool result = name_start(current(in));
  skip_name(in);
  result = result && current(in) == '}';
  if (result) {
    advance(in);
    result = descriptor_operator(in);
  }
  logical_restore_position(in, &saved);
  return result;
}

static enum Token read_redirect(struct LogicalLexer *in) {
  static const struct {
    const char *word;
    enum Token token;
    int32_t incompatible;
  } operators[] = {
    {"&>>|", REDIRECT_OPERATOR, 0},
    {"&>>!", REDIRECT_OPERATOR, 0},
    {">>&|", REDIRECT_OPERATOR, 0},
    {">>&!", REDIRECT_OPERATOR, 0},
    {"<<<", HERE_STRING_OPERATOR, 0},
    {"<<-", DLESSDASH, 0},
    {">>|", REDIRECT_OPERATOR, 0},
    {">>!", REDIRECT_OPERATOR, 0},
    {">&|", REDIRECT_OPERATOR, 0},
    {">&!", REDIRECT_OPERATOR, 0},
    {"&>|", REDIRECT_OPERATOR, 0},
    {"&>!", REDIRECT_OPERATOR, 0},
    {">>&", REDIRECT_OPERATOR, 0},
    {"&>>", REDIRECT_OPERATOR, 0},
    {"<<", DLESS, 0},
    {">>", REDIRECT_OPERATOR, 0},
    {">|", REDIRECT_OPERATOR, '<'},
    {">!", REDIRECT_OPERATOR, '<'},
    {"<&", REDIRECT_OPERATOR, 0},
    {">&", REDIRECT_OPERATOR, 0},
    {"&>", REDIRECT_OPERATOR, 0},
    {"<>", REDIRECT_OPERATOR, 0},
    {"<", REDIRECT_OPERATOR, '>'},
    {">", REDIRECT_OPERATOR, '<'},
  };
  struct LogicalPosition start = logical_position(in);
  for (size_t i = 0; i < sizeof(operators) / sizeof(*operators); ++i) {
    const char *word = operators[i].word;
    size_t j = 0;
    while (word[j] && current(in) == word[j]) {
      advance(in);
      j++;
    }
    bool process_suffix = j <= 2 &&
      (word[0] == '<' || word[0] == '>') &&
      j &&
      word[0] == word[j - 1];
    if (!word[j] && !(process_suffix && current(in) == '(')) {
      int32_t incompatible = operators[i].incompatible;
      if (incompatible) {
        struct LogicalPosition end = logical_position(in);
        while (horizontal(current(in))) advance(in);
        bool rejected = current(in) == incompatible && logical_peek(in) == '(';
        logical_restore_position(in, rejected ? &start : &end);
        if (rejected) return TOKEN_COUNT;
      }
      return operators[i].token;
    }
    logical_restore_position(in, &start);
  }
  return TOKEN_COUNT;
}

static bool has_descriptor(struct LogicalLexer *in) {
  struct LogicalPosition saved = logical_position(in);
  advance(in);
  bool result = descriptor_operator(in);
  logical_restore_position(in, &saved);
  return result;
}

static size_t utf8_encode(uint32_t value, uint8_t bytes[4]) {
  if (value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return 0;
  size_t length = value < 0x80 ? 1
    : value < 0x800            ? 2
    : value < 0x10000          ? 3
                               : 4;
  static const uint8_t prefixes[] = {0, 0, 0xc0, 0xe0, 0xf0};
  for (size_t i = length - 1; i > 0; --i) {
    bytes[i] = 0x80 | (value & 0x3f);
    value >>= 6;
  }
  bytes[0] = prefixes[length] | value;
  return length;
}

static bool delimiter_bytes(
  struct Document *d,
  size_t *capacity,
  const uint8_t *bytes,
  size_t length
) {
  if (!length) return true;
  if (length > SIZE_MAX - d->length) return false;
  uint8_t *next =
    source_grow(d->delimiter, capacity, d->length + length, sizeof(*next));
  if (!next) return false;
  d->delimiter = next;
  memcpy(d->delimiter + d->length, bytes, length);
  d->length += length;
  return true;
}

static bool delimiter_append(struct Document *d, size_t *capacity, int32_t c) {
  uint8_t bytes[4];
  size_t length = utf8_encode((uint32_t)c, bytes);
  return length && delimiter_bytes(d, capacity, bytes, length);
}

static bool
delimiter_matches(const struct Document *d, int32_t c, size_t *position) {
  uint8_t bytes[4];
  size_t length = utf8_encode((uint32_t)c, bytes);
  if (
    !length ||
    *position > d->length ||
    length > d->length - *position ||
    memcmp(d->delimiter + *position, bytes, length) != 0
  )
    return false;
  *position += length;
  return true;
}

static bool delimiter_starts(const struct Document *d, int32_t c) {
  size_t position = 0;
  return d && delimiter_matches(d, c, &position);
}

struct DollarEscape {
  uint8_t bytes[4];
  size_t length;
  bool valid;
};

static bool
dollar_escape(struct LogicalLexer *in, struct DollarEscape *escape) {
  *escape = (struct DollarEscape){.valid = true};
  uint8_t *modifiers = NULL;
  size_t count = 0, capacity = 0;
  bool success = true, unicode = false;
  for (;;) {
    advance(in);
    if (in->result != SOURCE_CHARACTER) {
      success = false;
      break;
    }
    int32_t c = current(in);
    advance(in);
    if (c == 'M' || c == 'C') {
      if (!count || modifiers[count - 1] != c) {
        uint8_t *next =
          source_grow(modifiers, &capacity, count + 1, sizeof(*next));
        if (!next) {
          success = false;
          break;
        }
        modifiers = next;
        modifiers[count++] = (uint8_t)c;
      }
      if (current(in) == '-') advance(in);
      if (in->result != SOURCE_CHARACTER || current(in) == '\'') break;
      if (current(in) == '\\') continue;
      escape->length = utf8_encode((uint32_t)current(in), escape->bytes);
      escape->valid = escape->length != 0;
      advance(in);
    } else if (c == 'u' || c == 'U' || c == 'x' || (c >= '0' && c <= '7')) {
      unicode = c == 'u' || c == 'U';
      bool octal = c >= '0' && c <= '7';
      size_t remaining = c == 'u' ? 4 : c == 'U' ? 8 : 2;
      uint32_t value = octal ? (uint32_t)(c - '0') : 0;
      while (remaining && in->result == SOURCE_CHARACTER) {
        int32_t v = current(in);
        int32_t n = digit(v)     ? v - '0'
          : v >= 'a' && v <= 'f' ? v - 'a' + 10
          : v >= 'A' && v <= 'F' ? v - 'A' + 10
                                 : -1;
        if (n < 0 || n >= (octal ? 8 : 16)) break;
        value = value * (octal ? 8 : 16) + (uint32_t)n;
        remaining--;
        advance(in);
      }
      if (unicode) {
        escape->length = utf8_encode(value, escape->bytes);
        escape->valid = escape->length != 0;
      } else {
        escape->bytes[0] = (uint8_t)value;
        escape->length = 1;
      }
    } else {
      const char *escapes = "abeEfnrtv";
      const uint8_t values[] = {7, 8, 27, 27, 12, 10, 13, 9, 11};
      const char *escaped = c > 0 && c < 128 ? strchr(escapes, (char)c) : NULL;
      escape->length = utf8_encode(
        escaped ? values[escaped - escapes] : (uint32_t)c,
        escape->bytes
      );
      escape->valid = escape->length != 0;
    }
    break;
  }
  if (!unicode && escape->length) {
    while (count) {
      uint8_t value = escape->bytes[0];
      escape->bytes[0] = modifiers[--count] == 'M' ? value | 0x80
        : value == '?'                             ? 0x7f
                                                   : value & 0x9f;
    }
  }
  ts_free(modifiers);
  return success;
}

static bool delimiter_substitution(
  struct LogicalLexer *in,
  struct Document *d,
  size_t *capacity
) {
  size_t start = logical_raw_position(in);
  if (!read_nested_boundary(in, false, NULL)) return false;
  struct SourceStage stage = in->cursor.stages[in->cursor.stage_count - 1];
  stage.disabled = true;
  struct LogicalLexer source;
  if (!logical_fork(&source, in, start, in->cursor.stage_count - 1, &stage, 1))
    return false;
  bool success = true;
  while (source.result == SOURCE_CHARACTER && source.consumed < in->consumed) {
    if (!delimiter_append(d, capacity, current(&source))) {
      success = false;
      break;
    }
    advance(&source);
  }
  success = success && source.result != SOURCE_FAILURE;
  logical_clear(&source);
  return success;
}

static bool read_delimiter(struct Scanner *s, struct LogicalLexer *in) {
  struct Document d = {.depth = depth(s), .strip_tabs = s->strip_next};
  size_t capacity = 0, count = 0, group_capacity = 0;
  struct DelimiterGroup {
    int32_t closer;
    int32_t quote;
    size_t braces;
    bool pattern;
  } *groups = NULL;
  size_t braces = 0;
  int32_t quote = 0;
  bool dollar = false, saw_source = false, success = true, range = false;
  while (in->result == SOURCE_CHARACTER) {
    int32_t c = current(in);
    bool process = !quote && (c == '<' || c == '>') && logical_peek(in) == '(';
    if (!quote && !range && c == '<') range = numeric_range_start(in);
    if (
      !quote &&
      !count &&
      !range &&
      !process &&
      c != '(' &&
      !(c == '}' && braces) &&
      word_boundary(in, WORD_BEGIN)
    )
      break;
    if (
      !quote &&
      count &&
      !range &&
      !process &&
      groups[count - 1].pattern &&
      in_set(c, ";&<>")
    )
      break;
    saw_source = true;
    bool expansion =
      (!quote || quote == '"') && c == '$' && dollar_group(logical_peek(in));
    if (expansion || process) {
      if (!delimiter_append(&d, &capacity, c)) {
        success = false;
        break;
      }
      advance(in);
      c = current(in);
      if (c == '(') {
        if (!delimiter_substitution(in, &d, &capacity)) {
          success = false;
          break;
        }
        continue;
      }
    }
    if (!quote && c == '$' && logical_peek(in) == '\'') {
      advance(in);
      c = current(in);
      dollar = true;
    }
    if (
      (!quote && (c == '\'' || c == '"' || c == '`')) || (quote && c == quote)
    ) {
      if (c != '`') d.quoted = true;
      else if (!delimiter_append(&d, &capacity, c)) {
        success = false;
        break;
      }
      quote = quote ? 0 : c;
      advance(in);
      struct SourceStage stage = in->cursor.stages[in->cursor.stage_count - 1];
      stage.disabled = quote == '\'';
      if (!logical_replace_view(in, in->cursor.stage_count - 1, &stage, 1)) {
        success = false;
        break;
      }
      if (!quote) dollar = false;
      continue;
    }
    if (c == '\\' && (quote != '\'' || dollar)) {
      d.quoted = true;
      if (dollar) {
        struct DollarEscape escape;
        if (
          !dollar_escape(in, &escape) ||
          !escape.valid ||
          !delimiter_bytes(&d, &capacity, escape.bytes, escape.length)
        ) {
          success = false;
          break;
        }
        continue;
      }
      advance(in);
      if (in->result != SOURCE_CHARACTER) {
        success = false;
        break;
      }
      c = current(in);
      if (
        quote &&
        !double_quote_escape(c) &&
        !delimiter_append(&d, &capacity, '\\')
      ) {
        success = false;
        break;
      }
    } else if (!quote || expansion) {
      size_t open = count;
      while (open && in_set(c, "{}") && groups[open - 1].pattern) open--;
      if (!expansion && c == '{' && open && groups[open - 1].closer == '}') {
        groups[open - 1].braces++;
      } else if (open && c == '}' && groups[open - 1].braces) {
        groups[open - 1].braces--;
      } else if (open && c == groups[open - 1].closer) {
        count = open - 1;
        quote = groups[count].quote;
      } else if (!count && c == '}' && braces) {
        braces--;
      } else if (c == '(' || (expansion && (c == '{' || c == '['))) {
        struct DelimiterGroup *next =
          source_grow(groups, &group_capacity, count + 1, sizeof(*next));
        if (!next) {
          success = false;
          break;
        }
        groups = next;
        groups[count++] = (struct DelimiterGroup){
          .closer = closing_delimiter(c),
          .quote = quote,
          .pattern = !expansion,
        };
        quote = 0;
      } else if (!count && c == '{') braces++;
    }
    if (!delimiter_append(&d, &capacity, c)) {
      success = false;
      break;
    }
    advance(in);
    if (range && c == '>') range = false;
  }
  if (in->result != SOURCE_CHARACTER)
    while (count && groups[count - 1].pattern) count--;
  ts_free(groups);
  if (!success || !saw_source || quote || count) {
    ts_free(d.delimiter);
    return false;
  }
  d.delimiter_remaining = logical_raw_position(in);
  if (d.strip_tabs) {
    size_t tabs = 0;
    while (tabs < d.length && d.delimiter[tabs] == '\t') tabs++;
    if (tabs) {
      d.length -= tabs;
      memmove(d.delimiter, d.delimiter + tabs, d.length);
    }
  }
  struct Document *documents = source_grow(
    s->documents,
    &s->document_capacity,
    s->document_count + 1,
    sizeof(*documents)
  );
  if (!documents) {
    ts_free(d.delimiter);
    return false;
  }
  s->documents = documents;
  s->documents[s->document_count++] = d;
  return true;
}

struct DocumentBoundary {
  struct LogicalLexer view;
  size_t document;
  bool line_start;
  bool found;
  size_t end;
};

struct DocumentInput {
  const struct Scanner *scanner;
  struct DocumentBoundary *boundaries;
  size_t count;
};

static void document_input_clear(struct DocumentInput *input) {
  for (size_t i = 0; i < input->count; ++i)
    logical_clear(&input->boundaries[i].view);
  ts_free(input->boundaries);
}

static bool document_input_init(
  struct DocumentInput *input,
  struct NativeInput *native,
  struct Scanner *s
) {
  *input = (struct DocumentInput){.scanner = s};
  if (!active_document(s)) return true;
  input->boundaries = ts_calloc(s->document_count, sizeof(*input->boundaries));
  if (!input->boundaries) return false;
  size_t context = 0;
  for (size_t i = 0; i < s->document_count; ++i) {
    const struct Document *d = &s->documents[i];
    if (!d->active || d->finished) continue;
    while (context < s->count && s->contexts[context].opener != DOCUMENT_BEGIN)
      context++;
    if (context == s->count) return false;
    struct SourceSnapshot snapshot = s->source;
    snapshot.stage_count =
      s->contexts[context++].stages + DOCUMENT_STAGE_COUNT - 2;
    if (snapshot.stage_count > s->source.stage_count) return false;
    if (d->ending) continue;
    struct DocumentBoundary *bound = &input->boundaries[input->count++];
    bound->document = i;
    bound->line_start = snapshot.stages[snapshot.stage_count - 1].at_line_start;
    if (!logical_init_at(&bound->view, native, &snapshot, 0, false))
      return false;
  }
  return true;
}

static void document_boundary_advance(struct DocumentBoundary *bound) {
  bound->line_start = current(&bound->view) == '\n';
  advance(&bound->view);
}

static enum SourceResult document_boundary(void *payload, size_t position) {
  struct DocumentInput *input = payload;
  const struct Scanner *s = input->scanner;
  for (size_t i = 0; i < input->count; ++i) {
    struct DocumentBoundary *bound = &input->boundaries[i];
    if (bound->document >= s->document_count) continue;
    const struct Document *document = &s->documents[bound->document];
    if (document->finished) continue;
    struct LogicalLexer *view = &bound->view;
    while (!bound->found && position >= view->consumed) {
      if (view->result == SOURCE_FAILURE) return SOURCE_FAILURE;
      if (bound->line_start) {
        size_t start = view->consumed;
        size_t length = 0;
        bool matches = true;
        while (
          view->result == SOURCE_CHARACTER &&
          !logical_backquote_end(view) &&
          current(view) != '\n' &&
          matches
        ) {
          matches = delimiter_matches(document, current(view), &length);
          document_boundary_advance(bound);
        }
        if (view->result == SOURCE_FAILURE) return SOURCE_FAILURE;
        if (
          matches &&
          length == document->length &&
          (current(view) == '\n' || view->consumed > start)
        ) {
          bound->found = true;
          bound->end = start;
          break;
        }
        if (position < view->consumed) break;
      }
      if (view->result != SOURCE_CHARACTER || logical_backquote_end(view))
        break;
      document_boundary_advance(bound);
    }
    if (bound->found && position >= bound->end) return SOURCE_END;
  }
  return SOURCE_CHARACTER;
}

enum BoundaryKind {
  BOUNDARY_CONDITION_WORD,
  BOUNDARY_CONDITION,
  BOUNDARY_SUBSCRIPT,
  BOUNDARY_KEY,
  BOUNDARY_GROUP,
  BOUNDARY_PARAMETER,
  BOUNDARY_ARITHMETIC,
  BOUNDARY_SINGLE,
  BOUNDARY_DOLLAR_SINGLE,
  BOUNDARY_DOUBLE,
  BOUNDARY_COMMAND,
  BOUNDARY_SHELL_GROUP,
  BOUNDARY_FUNCTION_HEADER,
  BOUNDARY_LOOP_WORDS,
  BOUNDARY_BACKQUOTE,
  BOUNDARY_CASE,
  BOUNDARY_COMMAND_LIST,
};

struct BoundaryFrame {
  enum BoundaryKind kind;
  int32_t closer;
  size_t brackets;
  size_t parentheses;
  size_t stages;
  bool disabled;
  bool command;
  bool timed;
  bool inherited_timing;
  bool header_scope;
  bool body_ready;
  enum Token terminator;
  bool body_pending;
  bool single_body;
  bool declaration;
  bool word;
  enum Token word_kind;
  bool word_command;
  enum Token header;
  bool named_function;
  bool function_arguments;
  enum Token body_header;
  enum Token end_token;
  enum {
    BOUNDARY_NOT_CASE,
    BOUNDARY_CASE_SELECTOR,
    BOUNDARY_CASE_HEADER,
    BOUNDARY_CASE_PATTERN,
    BOUNDARY_CASE_PATTERN_SOURCE,
    BOUNDARY_CASE_BODY,
  } case_part;
  bool brace_case;
  bool key;
  bool condition;
  bool word_boundary;
  bool arithmetic;
  enum SourceQuoting quoting;
};

struct BoundaryProbe {
  struct BoundaryFrame *frames;
  size_t count;
  size_t capacity;
  struct Scanner documents;
  const struct Scanner *owner;
};

static bool boundary_condition_header(enum Token token) {
  return token == IF_KEYWORD ||
    token == ELIF_KEYWORD ||
    token == WHILE_KEYWORD ||
    token == UNTIL_KEYWORD;
}

static bool boundary_loop_header(enum Token token) {
  return token == FOR_KEYWORD ||
    token == SELECT_KEYWORD ||
    token == FOREACH_KEYWORD ||
    token == REPEAT_KEYWORD;
}

static bool boundary_compound_header(enum Token token) {
  return boundary_loop_header(token) ||
    token == FUNCTION_KEYWORD ||
    (boundary_condition_header(token) && token != ELIF_KEYWORD);
}

static size_t boundary_depth(const struct BoundaryProbe *probe) {
  size_t depth = 0;
  for (size_t i = 0; i < probe->count; ++i)
    if (
      probe->frames[i].kind == BOUNDARY_COMMAND ||
      probe->frames[i].kind == BOUNDARY_BACKQUOTE
    )
      depth++;
  return depth;
}

static bool boundary_push(
  struct BoundaryProbe *probe,
  struct LogicalLexer *in,
  enum BoundaryKind kind,
  int32_t closer
) {
  struct BoundaryFrame *frames = source_grow(
    probe->frames,
    &probe->capacity,
    probe->count + 1,
    sizeof(*frames)
  );
  if (!frames) return false;
  probe->frames = frames;
  size_t count = in->cursor.stage_count;
  bool key = kind == BOUNDARY_KEY ||
    (kind == BOUNDARY_GROUP && probe->count && frames[probe->count - 1].key);
  bool condition = kind == BOUNDARY_CONDITION ||
    kind == BOUNDARY_CONDITION_WORD ||
    (kind == BOUNDARY_GROUP &&
      probe->count &&
      frames[probe->count - 1].condition);
  bool word_boundary = kind == BOUNDARY_CONDITION_WORD ||
    (kind == BOUNDARY_SUBSCRIPT &&
      probe->count &&
      frames[probe->count - 1].word_boundary);
  enum SourceQuoting quoting =
    probe->count && (kind == BOUNDARY_SUBSCRIPT || kind == BOUNDARY_GROUP)
    ? frames[probe->count - 1].quoting
    : SOURCE_UNQUOTED;
  if (
    kind == BOUNDARY_PARAMETER &&
    probe->count &&
    (frames[probe->count - 1].kind == BOUNDARY_DOUBLE ||
      frames[probe->count - 1].arithmetic ||
      frames[probe->count - 1].quoting != SOURCE_UNQUOTED)
  )
    quoting = SOURCE_PARAMETER_QUOTED;
  bool arithmetic = kind == BOUNDARY_ARITHMETIC ||
    (probe->count &&
      frames[probe->count - 1].arithmetic &&
      (kind == BOUNDARY_PARAMETER ||
        kind == BOUNDARY_SUBSCRIPT ||
        kind == BOUNDARY_GROUP));
  bool timed = probe->count &&
    kind != BOUNDARY_COMMAND &&
    kind != BOUNDARY_BACKQUOTE &&
    frames[probe->count - 1].timed;
  frames[probe->count++] = (struct BoundaryFrame){
    .kind = kind,
    .closer = closer,
    .stages = count,
    .disabled = in->cursor.stages[count - 1].disabled,
    .command = true,
    .timed = timed,
    .inherited_timing = timed,
    .terminator = TOKEN_COUNT,
    .word = true,
    .word_kind = WORD_BEGIN,
    .word_command = true,
    .header = TOKEN_COUNT,
    .body_header = TOKEN_COUNT,
    .end_token = TOKEN_COUNT,
    .case_part =
      kind == BOUNDARY_CASE ? BOUNDARY_CASE_SELECTOR : BOUNDARY_NOT_CASE,
    .key = key,
    .condition = condition,
    .word_boundary = word_boundary,
    .arithmetic = arithmetic,
    .quoting = quoting,
  };
  if (kind == BOUNDARY_SINGLE || kind == BOUNDARY_DOLLAR_SINGLE) {
    struct SourceStage stage = in->cursor.stages[count - 1];
    stage.disabled = true;
    return logical_replace_view(in, count - 1, &stage, 1);
  }
  if (kind == BOUNDARY_COMMAND || kind == BOUNDARY_BACKQUOTE) {
    struct SourceStage stages[] = {
      in->cursor.stages[count - 1],
      source_stage(SOURCE_BACKQUOTE_DECODE),
      source_stage(SOURCE_REMOVE_CONTINUATIONS),
    };
    if (kind == BOUNDARY_COMMAND) stages[0].disabled = true;
    for (size_t i = probe->count - 1; i > 0; --i) {
      enum BoundaryKind parent = frames[i - 1].kind;
      if (
        parent == BOUNDARY_DOUBLE ||
        frames[i - 1].quoting == SOURCE_DOUBLE_QUOTED
      ) {
        stages[1].quoted = true;
        break;
      }
      if (parent == BOUNDARY_COMMAND || parent == BOUNDARY_BACKQUOTE) break;
    }
    if (kind == BOUNDARY_COMMAND) stages[1] = stages[2];
    return logical_replace_view(
      in,
      count - 1,
      stages,
      kind == BOUNDARY_COMMAND ? 2 : 3
    );
  }
  return true;
}

static void boundary_finish_word(struct BoundaryFrame *frame) {
  if (frame->word) return;
  frame->command = !word_only_after_context(
    frame->word_kind,
    !frame->word_command,
    !frame->command
  );
  if (frame->header == FUNCTION_KEYWORD) frame->named_function = true;
  if (frame->word_kind == COUNT_WORD_BEGIN) frame->body_ready = true;
  frame->word_kind =
    frame->function_arguments ? FUNCTION_ARGUMENT_BEGIN : WORD_BEGIN;
  frame->word = true;
}

static bool boundary_pop(struct BoundaryProbe *probe, struct LogicalLexer *in) {
  struct BoundaryFrame frame = probe->frames[--probe->count];
  struct SourceStage stage = in->cursor.stages[frame.stages - 1];
  stage.disabled = frame.disabled;
  enum Token end = frame.end_token != TOKEN_COUNT ? frame.end_token
    : frame.header_scope                          ? CLOSED_BODY_END
    : frame.kind == BOUNDARY_FUNCTION_HEADER      ? FUNCTION_BODY_BEGIN
    : frame.kind == BOUNDARY_LOOP_WORDS           ? RIGHT_PAREN
    : frame.kind == BOUNDARY_SHELL_GROUP
    ? (frame.closer == ')' ? RIGHT_PAREN : RIGHT_BRACE)
    : frame.kind == BOUNDARY_CASE      ? ESAC_KEYWORD
    : frame.kind == BOUNDARY_CONDITION ? CONDITION_CLOSE
                                       : TOKEN_COUNT;
  if (end != TOKEN_COUNT && probe->count) {
    struct BoundaryFrame *parent = &probe->frames[probe->count - 1];
    if (end == ASSIGNMENT_END) boundary_finish_word(parent);
    parent->command = !word_only_after(end, !parent->command);
    parent->word = true;
    if (
      end != FUNCTION_ARGUMENTS_BEGIN &&
      (frame.header_scope ||
        frame.kind == BOUNDARY_CASE ||
        frame.kind == BOUNDARY_CONDITION ||
        frame.kind == BOUNDARY_SHELL_GROUP) &&
      boundary_condition_header(parent->header)
    )
      parent->body_ready = true;
  }
  if (frame.kind == BOUNDARY_COMMAND || frame.kind == BOUNDARY_BACKQUOTE)
    finish_pending_documents(&probe->documents, boundary_depth(probe) + 1);
  if (!logical_replace_view(in, frame.stages - 1, &stage, 1)) return false;
  if (probe->count) {
    struct BoundaryFrame *parent = &probe->frames[probe->count - 1];
    if (
      (parent->single_body ||
        (parent->header_scope && parent->header == TOKEN_COUNT)) &&
      (frame.kind == BOUNDARY_SHELL_GROUP ||
        frame.kind == BOUNDARY_COMMAND_LIST)
    ) {
      parent->end_token = end;
      return boundary_pop(probe, in);
    }
    if (
      frame.kind == BOUNDARY_LOOP_WORDS ||
      (frame.kind == BOUNDARY_FUNCTION_HEADER &&
        frame.header == FUNCTION_KEYWORD)
    ) {
      parent->header = frame.header;
      parent->body_ready = true;
    }
  }
  return true;
}

static bool
boundary_documents(struct BoundaryProbe *probe, struct LogicalLexer *in) {
  struct Scanner *documents = &probe->documents;
  for (size_t i = 0; i < documents->document_count; ++i) {
    struct Document *d = &documents->documents[i];
    if (d->finished || d->depth != boundary_depth(probe)) continue;
    size_t count = in->cursor.stage_count;
    struct SourceStage original = in->cursor.stages[count - 1];
    struct SourceStage stages[DOCUMENT_STAGE_COUNT] = {original};
    document_stages(stages, d);
    if (!logical_replace_view(in, count - 1, stages, DOCUMENT_STAGE_COUNT))
      return false;
    size_t length = 0;
    bool matched = true;
    while (in->result == SOURCE_CHARACTER && !logical_backquote_end(in)) {
      int32_t c = current(in);
      advance(in);
      if (c == '\n') {
        if (matched && length == d->length) {
          d->finished = true;
          break;
        }
        length = 0;
        matched = true;
      } else {
        matched = matched && delimiter_matches(d, c, &length);
      }
    }
    if (!d->finished || !logical_replace_view(in, count - 1, &original, 1))
      return false;
  }
  return true;
}

static bool boundary_word(struct LogicalLexer *in, const char *word) {
  struct LogicalPosition saved = logical_position(in);
  if (matches(in, word) && command_word_end(in)) return true;
  logical_restore_position(in, &saved);
  return false;
}

static enum Token read_keyword(struct LogicalLexer *in, bool timed);

static bool
read_boundary(struct BoundaryProbe *probe, struct LogicalLexer *in) {
  while (probe->count && in->result == SOURCE_CHARACTER) {
    struct BoundaryFrame *frame = &probe->frames[probe->count - 1];
    enum BoundaryKind kind = frame->kind;
    if (kind == BOUNDARY_CASE) {
      if (frame->case_part == BOUNDARY_CASE_PATTERN && !frame->word)
        frame->case_part = BOUNDARY_CASE_PATTERN_SOURCE;
      if (frame->case_part == BOUNDARY_CASE_PATTERN_SOURCE)
        frame->command = false;
    }
    int32_t c = current(in);
    bool arithmetic_text = kind == BOUNDARY_ARITHMETIC ||
      (frame->arithmetic &&
        (kind == BOUNDARY_SUBSCRIPT || kind == BOUNDARY_GROUP));
    bool command = kind == BOUNDARY_COMMAND ||
      kind == BOUNDARY_BACKQUOTE ||
      kind == BOUNDARY_CASE ||
      kind == BOUNDARY_COMMAND_LIST ||
      kind == BOUNDARY_SHELL_GROUP;
    bool single = kind == BOUNDARY_SINGLE || kind == BOUNDARY_DOLLAR_SINGLE;
    if (frame->quoting == SOURCE_DOUBLE_QUOTED && c == '"') return false;
    if (
      kind == BOUNDARY_GROUP &&
      frame->quoting == SOURCE_PARAMETER_QUOTED &&
      c == '}'
    )
      return false;
    if (logical_backquote_end(in)) {
      if (kind == BOUNDARY_COMMAND_LIST) {
        if (!boundary_pop(probe, in)) return false;
        continue;
      }
      if (kind != BOUNDARY_BACKQUOTE) return false;
      advance(in);
      if (!boundary_pop(probe, in)) return false;
      continue;
    }
    if ((command || kind == BOUNDARY_CONDITION) && frame->word && c == '#') {
      if (!read_comment(in)) return false;
      continue;
    }
    if (
      command &&
      frame->body_ready &&
      (boundary_loop_header(frame->header) ||
        frame->header == FUNCTION_KEYWORD ||
        (frame->word_kind != REDIRECT_WORD_BEGIN &&
          !horizontal(c) &&
          !in_set(c, "\n;&|") &&
          !(in_set(c, "<>") && logical_peek(in) != '(') &&
          !(digit(c) && has_descriptor(in))))
    ) {
      struct LogicalPosition start = logical_position(in);
      bool short_body = boundary_loop_header(frame->header) ||
        frame->header == FUNCTION_KEYWORD ||
        (!boundary_word(in, "then") &&
          !boundary_word(in, "do") &&
          !boundary_word(in, "always"));
      logical_restore_position(in, &start);
      frame->body_ready = false;
      if (!short_body) frame->command = true;
      if (short_body) {
        enum Token terminator =
          frame->header == FOREACH_KEYWORD ? END_KEYWORD : TOKEN_COUNT;
        enum Token body_header = frame->body_header;
        bool function_arguments = frame->function_arguments;
        if (kind == BOUNDARY_COMMAND_LIST && frame->header == ELIF_KEYWORD)
          frame->single_body = true;
        frame->header = TOKEN_COUNT;
        frame->timed = frame->inherited_timing;
        if (!boundary_push(probe, in, BOUNDARY_COMMAND_LIST, 0)) return false;
        struct BoundaryFrame *body = &probe->frames[probe->count - 1];
        body->terminator = terminator;
        body->body_header = body_header;
        body->function_arguments = function_arguments;
        if (function_arguments) body->word_kind = FUNCTION_ARGUMENT_BEGIN;
        body->body_pending = true;
        continue;
      }
    }
    if (command && frame->word && !horizontal(c) && !in_set(c, "\n;&|")) {
      frame->word_command = frame->command;
      if (
        frame->header == FUNCTION_KEYWORD &&
        c == '{' &&
        boundary(logical_peek(in))
      ) {
        frame->body_header =
          frame->named_function ? TOKEN_COUNT : FUNCTION_KEYWORD;
        frame->function_arguments = !frame->named_function;
        frame->header = TOKEN_COUNT;
        frame->command = true;
      }
      if (frame->body_pending && c == '{') frame->single_body = true;
      if (c != '{' && c != '(') frame->body_header = TOKEN_COUNT;
      size_t value = 0;
      if (
        (frame->command || frame->declaration) &&
        frame->word_kind == WORD_BEGIN &&
        assignment_start(in, false, &value)
      ) {
        frame->word_kind =
          frame->declaration ? DECLARATION_ASSIGNMENT_BEGIN : ASSIGNMENT_BEGIN;
        frame->word = false;
        while (in->result == SOURCE_CHARACTER && in->consumed < value)
          advance(in);
        if (current(in) == '(') {
          advance(in);
          if (!boundary_push(probe, in, BOUNDARY_GROUP, ')')) return false;
          probe->frames[probe->count - 1].end_token = ASSIGNMENT_END;
        }
        continue;
      }
    }
    if (c == '\\' && kind != BOUNDARY_SINGLE) {
      if (kind == BOUNDARY_DOLLAR_SINGLE) {
        struct DollarEscape escape;
        if (!dollar_escape(in, &escape)) return false;
      } else {
        advance(in);
        if (in->result == SOURCE_CHARACTER && !logical_backquote_end(in))
          advance(in);
      }
      frame->word = false;
      continue;
    }
    if (single) {
      advance(in);
      if (c == '\'' && !boundary_pop(probe, in)) return false;
      continue;
    }
    if (kind == BOUNDARY_DOUBLE && c == '"') {
      advance(in);
      if (!boundary_pop(probe, in)) return false;
      continue;
    }
    if (c == '$') {
      advance(in);
      c = current(in);
      size_t end = 0;
      bool arithmetic = c == '(' && arithmetic_start(in, &end);
      frame->word = false;
      if (arithmetic) {
        if (!end) return false;
        while (in->result == SOURCE_CHARACTER && in->consumed < end)
          advance(in);
        continue;
      }
      enum BoundaryKind next = c == '[' ? BOUNDARY_ARITHMETIC
        : c == '('                      ? BOUNDARY_COMMAND
        : c == '{'                      ? BOUNDARY_PARAMETER
        : c == '\'' &&
          kind != BOUNDARY_DOUBLE &&
          !frame->quoting &&
          !arithmetic_text
        ? BOUNDARY_DOLLAR_SINGLE
        : BOUNDARY_GROUP;
      if (next != BOUNDARY_GROUP) {
        advance(in);
        if (!boundary_push(probe, in, next, closing_delimiter(c))) return false;
      }
      continue;
    }
    if (
      c == '`' ||
      (kind != BOUNDARY_DOUBLE &&
        !arithmetic_text &&
        ((!frame->quoting && c == '\'') ||
          ((!frame->quoting || frame->quoting == SOURCE_PARAMETER_QUOTED) &&
            c == '"')))
    ) {
      frame->word = false;
      advance(in);
      if (!boundary_push(
            probe,
            in,
            c == '`'      ? BOUNDARY_BACKQUOTE
              : c == '\'' ? BOUNDARY_SINGLE
                          : BOUNDARY_DOUBLE,
            c
          ))
        return false;
      continue;
    }
    if (kind == BOUNDARY_DOUBLE) {
      advance(in);
      continue;
    }
    if (frame->key && c == ']' && kind == BOUNDARY_GROUP) return false;
    if (
      (command ||
        frame->condition ||
        (frame->key && (!probe->owner || process_start(probe->owner, in)))) &&
      (c == '<' ||
        c == '>' ||
        ((command ||
           kind == BOUNDARY_CONDITION ||
           kind == BOUNDARY_CONDITION_WORD) &&
          c == '=' &&
          frame->word)) &&
      logical_peek(in) == '('
    ) {
      frame->word = false;
      advance(in);
      advance(in);
      if (!boundary_push(probe, in, BOUNDARY_COMMAND, ')')) return false;
      continue;
    }
    bool closing_brace = c == '}' &&
      (frame->word ? closing_brace_start(in)
                   : word_boundary(in, frame->word_kind));
    if (
      kind == BOUNDARY_CASE &&
      (frame->case_part == BOUNDARY_CASE_PATTERN ||
        (frame->case_part == BOUNDARY_CASE_BODY && frame->brace_case)) &&
      closing_brace
    ) {
      advance(in);
      if (!boundary_pop(probe, in)) return false;
      continue;
    }
    if (command && frame->word) {
      if (
        kind == BOUNDARY_CASE &&
        (frame->case_part == BOUNDARY_CASE_PATTERN ||
          (frame->case_part == BOUNDARY_CASE_BODY && !frame->brace_case)) &&
        boundary_word(in, "esac")
      ) {
        if (!boundary_pop(probe, in)) return false;
        continue;
      }
      if (
        kind == BOUNDARY_CASE &&
        frame->case_part == BOUNDARY_CASE_HEADER &&
        (boundary_word(in, "in") || c == '{')
      ) {
        frame->brace_case = c == '{';
        if (frame->brace_case) advance(in);
        frame->case_part = BOUNDARY_CASE_PATTERN;
        continue;
      }
      if (
        frame->command &&
        (!frame->case_part || frame->case_part == BOUNDARY_CASE_BODY) &&
        boundary_word(in, "case")
      ) {
        frame->command = false;
        if (!boundary_push(probe, in, BOUNDARY_CASE, 0)) return false;
        continue;
      }
      if (frame->command) {
        struct LogicalPosition start = logical_position(in);
        enum Token token = read_keyword(in, frame->timed);
        if (token == TOKEN_COUNT && boundary_word(in, "!")) token = NEGATION;
        if (token == TOKEN_COUNT && boundary_word(in, "nocorrect"))
          token = PRECOMMAND_NOCORRECT_NAME;
        if (token != TOKEN_COUNT) {
          if (frame->body_pending && token == DO_KEYWORD) {
            frame->body_pending = false;
            frame->terminator = DONE_KEYWORD;
            continue;
          }
          frame->body_pending = false;
          if (
            kind == BOUNDARY_COMMAND_LIST &&
            frame->terminator == TOKEN_COUNT &&
            (token == FI_KEYWORD ||
              token == ELSE_KEYWORD ||
              token == ELIF_KEYWORD ||
              token == DONE_KEYWORD ||
              token == END_KEYWORD ||
              token == ESAC_KEYWORD ||
              (!frame->header_scope &&
                (token == THEN_KEYWORD || token == DO_KEYWORD)))
          ) {
            logical_restore_position(in, &start);
            if (!boundary_pop(probe, in)) return false;
            continue;
          }
          if (kind == BOUNDARY_COMMAND_LIST && token == frame->terminator) {
            frame->end_token = token;
            if (!boundary_pop(probe, in)) return false;
            continue;
          }
          bool elif_body =
            token == THEN_KEYWORD && frame->header == ELIF_KEYWORD;
          if ((token == THEN_KEYWORD && !elif_body) || token == DO_KEYWORD) {
            frame->header = TOKEN_COUNT;
            frame->timed = frame->inherited_timing;
            if (!boundary_push(probe, in, BOUNDARY_COMMAND_LIST, 0))
              return false;
            probe->frames[probe->count - 1].terminator =
              token == THEN_KEYWORD ? FI_KEYWORD : DONE_KEYWORD;
            continue;
          }
          if (boundary_compound_header(token)) {
            if (!boundary_push(probe, in, BOUNDARY_COMMAND_LIST, 0))
              return false;
            struct BoundaryFrame *header = &probe->frames[probe->count - 1];
            header->header_scope = true;
            header->header = token;
            header->command = !word_only_after(token, false);
            if (token == REPEAT_KEYWORD) header->word_kind = COUNT_WORD_BEGIN;
            continue;
          }
          if (token == TIME_KEYWORD) frame->timed = true;
          if (elif_body) frame->timed = frame->inherited_timing;
          frame->declaration = declaration_keyword(token);
          frame->command = !word_only_after(token, !frame->command);
          frame->function_arguments = false;
          if (token == ELIF_KEYWORD) frame->header = token;
          if (token == THEN_KEYWORD || token == FI_KEYWORD)
            frame->header = TOKEN_COUNT;
          continue;
        }
        if (condition_open_start(in)) {
          advance(in);
          advance(in);
          frame->word = false;
          if (!boundary_push(probe, in, BOUNDARY_CONDITION, ']')) return false;
          continue;
        }
        size_t end = 0;
        if (c == '(' && arithmetic_start(in, &end)) {
          if (!end) return false;
          frame->body_header = TOKEN_COUNT;
          while (in->result == SOURCE_CHARACTER && in->consumed < end)
            advance(in);
          frame->command = !word_only_after(ARITHMETIC_END, !frame->command);
          if (
            boundary_condition_header(frame->header) ||
            frame->header == FOR_KEYWORD
          )
            frame->body_ready = true;
          continue;
        }
      }
    }
    if (
      command &&
      (in_set(c, "<>&") ||
        (frame->word && digit(c) && has_descriptor(in)) ||
        (frame->word && c == '{' && has_variable_descriptor(in)))
    ) {
      struct LogicalPosition start = logical_position(in);
      if (frame->word && digit(c) && has_descriptor(in)) advance(in);
      if (frame->word && c == '{' && has_variable_descriptor(in)) {
        advance(in);
        skip_name(in);
        advance(in);
      }
      enum Token token = read_redirect(in);
      if (token != TOKEN_COUNT) {
        boundary_finish_word(frame);
        if (frame->header == FUNCTION_KEYWORD) {
          logical_restore_position(in, &start);
          frame->body_ready = true;
          continue;
        }
        if (token == DLESS || token == DLESSDASH) {
          probe->documents.strip_next = token == DLESSDASH;
          while (horizontal(current(in))) advance(in);
          if (!read_delimiter(&probe->documents, in)) return false;
          probe->documents.documents[probe->documents.document_count - 1]
            .depth = boundary_depth(probe);
        } else {
          frame->word_kind = REDIRECT_WORD_BEGIN;
          frame->word_command = frame->command;
        }
        continue;
      }
      logical_restore_position(in, &start);
    }
    if (command && frame->word && !horizontal(c) && !in_set(c, "\n;&|"))
      frame->body_pending = false;
    if (
      kind == BOUNDARY_COMMAND_LIST &&
      (c == ')' ||
        closing_brace ||
        (frame->body_pending &&
          in_set(c, "|&") &&
          !(c == '&' && logical_peek(in) == '>')) ||
        (frame->terminator == TOKEN_COUNT &&
          !frame->header_scope &&
          !frame->body_pending &&
          !frame->single_body &&
          (in_set(c, ";\n") ||
            (c == '&' && logical_peek(in) != '&' && logical_peek(in) != '>'))))
    ) {
      if (!boundary_pop(probe, in)) return false;
      continue;
    }
    if (
      (command || kind == BOUNDARY_CONDITION) &&
      (horizontal(c) || in_set(c, "\n;&|"))
    ) {
      if (!frame->word) {
        if (frame->case_part == BOUNDARY_CASE_SELECTOR)
          frame->case_part = BOUNDARY_CASE_HEADER;
        boundary_finish_word(frame);
      }
      frame->word = true;
      enum Token separator = read_control_operator(in);
      if (separator == TOKEN_COUNT) advance(in);
      if (
        (separator == SEMICOLON || separator == NEWLINE) &&
        (frame->header == FOR_KEYWORD ||
          frame->header == SELECT_KEYWORD ||
          frame->header == FOREACH_KEYWORD ||
          frame->header == FUNCTION_KEYWORD)
      )
        frame->body_ready = true;
      if (
        (separator == SEMICOLON ||
          separator == NEWLINE ||
          separator == AMPERSAND ||
          separator == ASYNC_DISOWN ||
          separator == AND_IF ||
          separator == OR_IF ||
          case_terminator(separator))
      )
        frame->timed = frame->inherited_timing;
      frame->command = !word_only_after(
        case_terminator(separator) ? SEMICOLON : separator,
        !frame->command
      );
      if (separator != TOKEN_COUNT) {
        if (boundary_condition_header(frame->header)) frame->body_ready = false;
        frame->declaration = false;
        if (!boundary_condition_header(frame->header) && !frame->body_ready)
          frame->header = TOKEN_COUNT;
        frame->function_arguments = false;
        frame->word_kind = WORD_BEGIN;
      }
      if (
        kind == BOUNDARY_CASE &&
        frame->case_part == BOUNDARY_CASE_BODY &&
        case_terminator(separator)
      ) {
        frame->case_part = BOUNDARY_CASE_PATTERN;
      }
      if (c == '\n' && !boundary_documents(probe, in)) return false;
      continue;
    }
    if (
      kind == BOUNDARY_CASE &&
      (frame->case_part == BOUNDARY_CASE_PATTERN ||
        frame->case_part == BOUNDARY_CASE_PATTERN_SOURCE)
    ) {
      if (c == ')') {
        advance(in);
        frame->case_part = BOUNDARY_CASE_BODY;
        frame->command = frame->word = true;
        continue;
      }
      if (c == '(' && frame->word && case_pattern_prefix(in, NULL)) {
        advance(in);
        frame->word = false;
        continue;
      }
    }
    if (
      kind == BOUNDARY_CONDITION && frame->word && condition_close_start(in)
    ) {
      advance(in);
      advance(in);
      if (!boundary_pop(probe, in)) return false;
      continue;
    }
    if (
      kind == BOUNDARY_ARITHMETIC &&
      (c == '[' || c == '(' || c == ')' || (c == ']' && frame->brackets))
    ) {
      if (c == '[') frame->brackets++;
      else if (c == ']') frame->brackets--;
      else if (c == '(') frame->parentheses++;
      else {
        if (!frame->parentheses) return false;
        frame->parentheses--;
      }
      advance(in);
      continue;
    }
    if (kind == BOUNDARY_ARITHMETIC && c == ']' && frame->parentheses)
      return false;
    if (
      arithmetic_text &&
      kind != BOUNDARY_ARITHMETIC &&
      ((c == ']' && frame->closer != ']') || (c == ')' && frame->closer != ')'))
    )
      return false;
    if (
      c == frame->closer &&
      kind != BOUNDARY_BACKQUOTE &&
      kind != BOUNDARY_CONDITION &&
      (kind != BOUNDARY_SHELL_GROUP || c != '}' || closing_brace)
    ) {
      advance(in);
      if (!boundary_pop(probe, in)) return false;
      continue;
    }
    if (
      c != '(' &&
      (probe->owner &&
            (frame->key || (probe->count == 1 && kind == BOUNDARY_SUBSCRIPT))
          ? enclosing_source_end(
              probe->owner,
              in,
              probe->owner->count,
              kind == BOUNDARY_GROUP
            )
          : frame->word_boundary && word_boundary(in, WORD_BEGIN))
    ) {
      if (c == '<' && numeric_range_start(in)) {
        skip_numeric_range(in);
        continue;
      }
      return false;
    }
    if (
      (c == '(' && kind != BOUNDARY_PARAMETER) ||
      (c == '[' && (kind == BOUNDARY_SUBSCRIPT || arithmetic_text)) ||
      (c == '{' &&
        ((
           kind == BOUNDARY_PARAMETER && !frame->arithmetic && !frame->quoting
         ) ||
          kind == BOUNDARY_SUBSCRIPT ||
          (command && frame->command && frame->word)))
    ) {
      bool loop_words = c == '(' &&
        (frame->header == FOR_KEYWORD ||
          frame->header == SELECT_KEYWORD ||
          frame->header == FOREACH_KEYWORD);
      enum Token header = frame->header;
      bool function_header = command && c == '(' && logical_peek(in) == ')';
      enum BoundaryKind next = loop_words          ? BOUNDARY_LOOP_WORDS
        : function_header                          ? BOUNDARY_FUNCTION_HEADER
        : command && frame->command && frame->word ? BOUNDARY_SHELL_GROUP
        : c == '['                                 ? BOUNDARY_SUBSCRIPT
        : c == '{'                                 ? BOUNDARY_PARAMETER
                                                   : BOUNDARY_GROUP;
      enum Token end_token = TOKEN_COUNT;
      if (
        next == BOUNDARY_SHELL_GROUP &&
        (frame->body_header == FUNCTION_OPEN ||
          (frame->body_header == FUNCTION_KEYWORD && c == '{'))
      ) {
        end_token = FUNCTION_ARGUMENTS_BEGIN;
        frame->body_header = TOKEN_COUNT;
      }
      if (loop_words || function_header) {
        if (
          function_header && !frame->word && frame->header == FUNCTION_KEYWORD
        )
          frame->named_function = true;
        bool anonymous = function_header &&
          (frame->header == FUNCTION_KEYWORD ? !frame->named_function
                                             : frame->command && frame->word);
        frame->body_header = anonymous
          ? (frame->header == FUNCTION_KEYWORD ? FUNCTION_KEYWORD
                                               : FUNCTION_OPEN)
          : TOKEN_COUNT;
        frame->function_arguments =
          anonymous && frame->header == FUNCTION_KEYWORD;
        frame->word_kind =
          frame->function_arguments ? FUNCTION_ARGUMENT_BEGIN : WORD_BEGIN;
        frame->header = TOKEN_COUNT;
      }
      frame->word = false;
      advance(in);
      if (!boundary_push(probe, in, next, closing_delimiter(c))) return false;
      probe->frames[probe->count - 1].end_token = end_token;
      if (loop_words || function_header)
        probe->frames[probe->count - 1].header = header;
      continue;
    }
    frame->word = false;
    advance(in);
  }
  return probe->count == 0;
}

static bool read_condition_word(struct LogicalLexer *in) {
  struct LogicalLexer ahead;
  if (!logical_fork(&ahead, in, in->consumed, in->cursor.stage_count, NULL, 0))
    return false;
  struct BoundaryProbe probe = {0};
  bool found =
    boundary_push(&probe, &ahead, BOUNDARY_CONDITION_WORD, SOURCE_END_BOUNDARY);
  if (found) {
    read_boundary(&probe, &ahead);
    found = probe.count == 1 &&
      ahead.result != SOURCE_FAILURE &&
      ahead.consumed > in->consumed &&
      word_boundary(&ahead, WORD_BEGIN);
  }
  size_t end = ahead.consumed;
  ts_free(probe.frames);
  clear(&probe.documents);
  logical_clear(&ahead);
  if (found)
    while (in->result == SOURCE_CHARACTER && in->consumed < end) advance(in);
  return found;
}

static bool read_subscript_boundary(
  struct BoundaryProbe *probe,
  struct LogicalLexer *in,
  bool element,
  bool word_boundary,
  enum SourceQuoting quoting
) {
  advance(in);
  if (!boundary_push(
        probe,
        in,
        element ? BOUNDARY_KEY : BOUNDARY_SUBSCRIPT,
        ']'
      ))
    return false;
  probe->frames[0].word_boundary = word_boundary;
  probe->frames[0].quoting = quoting;
  probe->frames[0].arithmetic = quoting == SOURCE_ARITHMETIC;
  return read_boundary(probe, in);
}

static bool read_nested_boundary(
  struct LogicalLexer *in,
  bool arithmetic_source,
  bool *incomplete
) {
  if (incomplete) *incomplete = true;
  if (in->native->lookahead_depth >= (SOURCE_STATE_CAPACITY - 2) / 2) {
    in->native->depth_exhausted = true;
    return false;
  }
  struct LogicalLexer ahead;
  if (!logical_fork(&ahead, in, in->consumed, in->cursor.stage_count, NULL, 0))
    return false;
  in->native->lookahead_depth++;
  bool expansion = current(&ahead) == '$';
  bool process = current(&ahead) == '<' || current(&ahead) == '>';
  if (expansion || process) advance(&ahead);
  int32_t c = current(&ahead);
  size_t end = 0;
  bool arithmetic = !process && c == '(' && arithmetic_start(&ahead, &end);
  struct BoundaryProbe probe = {0};
  bool found = end != 0;
  if (!arithmetic) {
    enum BoundaryKind kind = c == '`' ? BOUNDARY_BACKQUOTE
      : c == '"'                      ? BOUNDARY_DOUBLE
      : c == '{'                      ? BOUNDARY_PARAMETER
      : c == '\'' ? expansion ? BOUNDARY_DOLLAR_SINGLE : BOUNDARY_SINGLE
      : !process && c == '[' ? BOUNDARY_ARITHMETIC
                             : BOUNDARY_COMMAND;
    advance(&ahead);
    found = boundary_push(&probe, &ahead, kind, closing_delimiter(c));
    if (found) {
      probe.frames[0].arithmetic = probe.frames[0].arithmetic ||
        (arithmetic_source && kind == BOUNDARY_PARAMETER);
      if (arithmetic_source && kind == BOUNDARY_PARAMETER)
        probe.frames[0].quoting = SOURCE_PARAMETER_QUOTED;
      found = read_boundary(&probe, &ahead);
    }
    end = ahead.consumed;
  }
  ts_free(probe.frames);
  clear(&probe.documents);
  if (incomplete && !found && !arithmetic)
    *incomplete = ahead.result != SOURCE_CHARACTER;
  logical_clear(&ahead);
  in->native->lookahead_depth--;
  if (found)
    while (in->result == SOURCE_CHARACTER && in->consumed < end) advance(in);
  return found;
}

static size_t subscript_boundary(
  struct LogicalLexer *in,
  bool element,
  bool word_boundary,
  enum SourceQuoting quoting,
  const struct Scanner *owner
) {
  struct LogicalLexer ahead;
  if (!logical_fork(&ahead, in, in->consumed, in->cursor.stage_count, NULL, 0))
    return false;
  struct BoundaryProbe probe = {.owner = owner};
  bool result =
    read_subscript_boundary(&probe, &ahead, element, word_boundary, quoting);
  size_t end = result ? ahead.consumed : 0;
  clear(&probe.documents);
  ts_free(probe.frames);
  logical_clear(&ahead);
  return end;
}

static enum Token read_keyword(struct LogicalLexer *in, bool timed) {
  static const struct {
    const char *word;
    enum Token token;
  } words[] = {
    {"if", IF_KEYWORD},
    {"case", CASE_KEYWORD},
    {"esac", ESAC_KEYWORD},
    {"then", THEN_KEYWORD},
    {"elif", ELIF_KEYWORD},
    {"else", ELSE_KEYWORD},
    {"fi", FI_KEYWORD},
    {"for", FOR_KEYWORD},
    {"in", IN_KEYWORD},
    {"do", DO_KEYWORD},
    {"done", DONE_KEYWORD},
    {"while", WHILE_KEYWORD},
    {"until", UNTIL_KEYWORD},
    {"repeat", REPEAT_KEYWORD},
    {"select", SELECT_KEYWORD},
    {"foreach", FOREACH_KEYWORD},
    {"end", END_KEYWORD},
    {"function", FUNCTION_KEYWORD},
    {"always", ALWAYS_KEYWORD},
    {"time", TIME_KEYWORD},
    {"coproc", COPROC_KEYWORD},
    {"declare", DECLARE_KEYWORD},
    {"export", EXPORT_KEYWORD},
    {"float", FLOAT_KEYWORD},
    {"integer", INTEGER_KEYWORD},
    {"local", LOCAL_KEYWORD},
    {"readonly", READONLY_KEYWORD},
    {"typeset", TYPESET_KEYWORD},
  };
  struct LogicalPosition start = logical_position(in);
  char word[32];
  size_t length = 0;
  while (
    in->result == SOURCE_CHARACTER &&
    name_character(current(in)) &&
    length + 1 < sizeof(word)
  ) {
    word[length++] = (char)current(in);
    advance(in);
  }
  word[length] = '\0';
  if (command_word_end(in))
    for (size_t i = 0; i < sizeof(words) / sizeof(*words); ++i) {
      if (strcmp(word, words[i].word) != 0) continue;
      enum Token token = words[i].token;
      if (token == TIME_KEYWORD && timed) break;
      return token;
    }
  logical_restore_position(in, &start);
  return TOKEN_COUNT;
}

static bool
precommand_option(struct LogicalLexer *in, bool *end, bool *operand) {
  struct LogicalPosition saved = logical_position(in);
  int32_t quote = 0;
  size_t count = 0;
  bool option = false, letters = true, argument = false, terminator = false;
  while (in->result == SOURCE_CHARACTER) {
    int32_t c = current(in);
    if (!quote && boundary(c)) break;
    advance(in);
    if ((c == '\'' || c == '"') && (!quote || quote == c)) {
      quote = quote ? 0 : c;
      continue;
    }
    if (c == '\\' && quote != '\'' && in->result == SOURCE_CHARACTER) {
      c = current(in);
      advance(in);
    }
    if (count == 0) {
      option = c == '-';
      if (!option) break;
    } else {
      terminator = count == 1 && c == '-';
      argument = letters && c == 'a';
      letters = letters && (c == 'c' || c == 'l');
    }
    count++;
  }
  bool complete = command_word_end(in);
  logical_restore_position(in, &saved);
  *end = terminator && count == 2 && complete;
  *operand = argument && complete;
  return option && count > 1;
}

static enum Token
precommand_name(struct LogicalLexer *in, const bool *valid, bool word_only) {
  static const struct {
    const char *name;
    enum Token token;
  } names[] = {
    {"builtin", PRECOMMAND_PLAIN_NAME},
    {"noglob", PRECOMMAND_PLAIN_NAME},
    {"nocorrect", PRECOMMAND_NOCORRECT_NAME},
    {"-", PRECOMMAND_PLAIN_NAME},
    {"exec", PRECOMMAND_EXEC_NAME},
    {"command", PRECOMMAND_COMMAND_NAME},
  };
  struct LogicalPosition saved = logical_position(in);
  for (size_t i = 0; i < sizeof(names) / sizeof(*names); ++i) {
    if (
      valid[names[i].token] &&
      (!valid[NAME] || names[i].token == PRECOMMAND_NOCORRECT_NAME) &&
      !(word_only && names[i].token == PRECOMMAND_NOCORRECT_NAME) &&
      matches(in, names[i].name) &&
      command_word_end(in)
    )
      return names[i].token;
    logical_restore_position(in, &saved);
  }
  return TOKEN_COUNT;
}

struct Scan {
  struct Scanner *s;
  struct LogicalLexer *in;
  const bool *valid;
  int32_t c;
  struct Document *doc;
  struct Context *top;
  enum Token context;
  const struct Context *owner;
  enum SourceQuoting quoting;
  bool opens_condition;
  bool opens_negation;
  bool process;
  bool numeric_range;
  bool pattern_parenthesis;
  bool continues;
  bool in_body;
  bool in_word;
  bool quoted;
  bool grouped;
  bool subscript_prefix;
  bool subscript_start;
  bool special_parameter;
  bool rejected;
  bool raw_scanned;
};

static bool word_part_context(enum Token token) {
  return word_context(token) ||
    assignment_context(token) ||
    subscript_context(token) ||
    pattern_context(token) ||
    modifier_context(token) ||
    token == ARRAY_KEY_OPEN ||
    token == ARRAY_KEY_GROUP_OPEN ||
    token == SUBSCRIPT_PREFIX_OPEN ||
    token == PARAMETER_FLAGS_OPEN ||
    token == SUBSCRIPT_FLAGS_OPEN ||
    token == FLAG_ARGUMENT_OPEN ||
    token == PARAMETER_OPEN ||
    token == PARAMETER_REPLACEMENT_OPERATOR ||
    token == PARAMETER_SUBSTRING_OPERATOR ||
    token == REGEX_BEGIN ||
    token == CASE_PATTERN_BEGIN ||
    token == NUMERIC_RANGE_OPEN;
}

static bool quote_start(enum SourceQuoting quoting, int32_t c) {
  return (c == '\'' && !quoting) ||
    (c == '"' && (!quoting || quoting == SOURCE_PARAMETER_QUOTED));
}

static bool here_escape(const struct Document *doc, int32_t next) {
  return next == '$' ||
    next == '`' ||
    next == '\\' ||
    delimiter_starts(doc, next);
}

static bool flag_argument_boundary(
  const struct Scanner *s,
  struct LogicalLexer *in,
  const struct Context *top,
  enum SourceQuoting quoting
) {
  int32_t c = current(in);
  if (enclosing_source_end(s, in, s->count - 1, top->delimiter == ')'))
    return true;
  if (quoting == SOURCE_DOUBLE_QUOTED) return c == '"';
  if (quoting == SOURCE_HERE_DOCUMENT) return c == '\n';
  return top->delimiter != ')' && boundary(c);
}

static bool subscript_word_bounded(const struct Scan *scan) {
  enum Token context = scan->context;
  return !scan->quoting &&
    !scan->quoted &&
    context != PARAMETER_OPEN &&
    !subscript_context(context) &&
    context != FLAG_ARGUMENT_OPEN &&
    !arithmetic_context(context) &&
    context != PARAMETER_REPLACEMENT_OPERATOR &&
    context != PARAMETER_SUBSTRING_OPERATOR &&
    !modifier_context(context) &&
    context != PATTERN_GROUP_OPEN &&
    context != PATTERN_FLAGS_OPEN &&
    context != GLOB_QUALIFIER_OPEN &&
    context != ARRAY_KEY_GROUP_OPEN;
}

static enum Token reject(struct Scan *scan) {
  scan->rejected = true;
  return TOKEN_COUNT;
}

static enum Token control_keyword(struct LogicalLexer *in) {
  struct LogicalPosition start = logical_position(in);
  while (horizontal(current(in))) advance(in);
  enum Token token = read_keyword(in, false);
  logical_restore_position(in, &start);
  switch (token) {
    case THEN_KEYWORD:
    case DO_KEYWORD:
    case FI_KEYWORD:
    case ELSE_KEYWORD:
    case ELIF_KEYWORD:
    case DONE_KEYWORD:
    case ESAC_KEYWORD:
    case END_KEYWORD:
      return token;
    default:
      return TOKEN_COUNT;
  }
}

static enum Token scan_documents(struct Scan *scan) {
  struct Scanner *s = scan->s;
  struct LogicalLexer *in = scan->in;
  const bool *valid = scan->valid;
  int32_t c = scan->c;
  if (valid[LAYOUT_END]) return LAYOUT_END;
  if (valid[ARITHMETIC_BASE_END]) return ARITHMETIC_BASE_END;
  if (valid[FUNCTION_ARGUMENTS_BEGIN]) return FUNCTION_ARGUMENTS_BEGIN;
  if (valid[FUNCTION_ARGUMENTS_RESUME]) return FUNCTION_ARGUMENTS_RESUME;
  if (!s->word_only && (valid[CONTROL_END] || valid[FUNCTION_ARGUMENTS_END])) {
    enum Token control = control_keyword(in);
    if (control != TOKEN_COUNT && !valid[control]) {
      if (valid[CONTROL_END]) return CONTROL_END;
      if (valid[FUNCTION_ARGUMENTS_END]) return FUNCTION_ARGUMENTS_END;
    }
  }
  if (valid[DELIMITER_END]) {
    struct Document *d = declaring_document(s);
    if (d && d->delimiter_remaining == 0) return DELIMITER_END;
  }
  if (
    valid[DELIMITER_BEGIN] &&
    !horizontal(c) &&
    c != '\n' &&
    in->result == SOURCE_CHARACTER
  ) {
    if (read_delimiter(s, in)) {
      in->consumed = 0;
      return DELIMITER_BEGIN;
    }
    return reject(scan);
  }
  if (
    valid[HERE_SEQUENCE_BEGIN] && pending_document(s) && (c == '\n' || c == '#')
  )
    return HERE_SEQUENCE_BEGIN;
  if (valid[HERE_SEQUENCE_END] && !pending_document(s))
    return HERE_SEQUENCE_END;
  if (valid[DOCUMENT_BEGIN]) {
    struct Document *d = pending_document(s);
    if (d) {
      in->consumed = 0;
      d->active = true;
      return DOCUMENT_BEGIN;
    }
  }
  struct Document *doc = active_document(s);
  if (!doc) return TOKEN_COUNT;
  if (!doc->ending) {
    struct DocumentInput *documents = in->native->boundary_payload;
    for (size_t i = 0; i < documents->count; ++i) {
      const struct DocumentBoundary *bound = &documents->boundaries[i];
      if (
        bound->document == (size_t)(doc - s->documents) &&
        bound->found &&
        bound->end == 0
      )
        doc->found = true;
    }
    if (
      !doc->found &&
      in->result == SOURCE_CHARACTER &&
      !logical_backquote_end(in)
    )
      return TOKEN_COUNT;
  }
  if (valid[HERE_END_BEGIN] && doc->found && !doc->ending)
    return HERE_END_BEGIN;
  if (valid[DOCUMENT_FINISH] && !doc->found) return DOCUMENT_FINISH;
  if (!doc->ending) return TOKEN_COUNT;
  if (
    valid[HERE_END_FINISH] &&
    (doc->end_line ||
      in->result != SOURCE_CHARACTER ||
      logical_backquote_end(in) ||
      (doc->length == 0 && c != '\n'))
  )
    return HERE_END_FINISH;
  if (
    valid[HERE_DOCUMENT_END_TEXT] &&
    c != '\n' &&
    in->result == SOURCE_CHARACTER &&
    !logical_backquote_end(in)
  ) {
    skip_line(in);
    return HERE_DOCUMENT_END_TEXT;
  }
  if (valid[NEWLINE] && c == '\n') {
    advance(in);
    return NEWLINE;
  }
  if (valid[HERE_END_FINISH]) return HERE_END_FINISH;
  return TOKEN_COUNT;
}

static void scan_prepare(struct Scan *scan) {
  struct Scanner *s = scan->s;
  struct LogicalLexer *in = scan->in;
  const bool *valid = scan->valid;
  int32_t c = scan->c;
  scan->doc = active_document(s);
  scan->opens_condition = condition_open_start(in);
  scan->opens_negation = c == '!' && opens_command_word(in, 1);
  scan->process = process_start(s, in);
  scan->owner = word_source_owner(s);
  scan->numeric_range = c == '<' && numeric_range_start(in);
  scan->pattern_parenthesis = c == '(' && logical_peek(in) != ')';
  scan->continues = scan->process ||
    scan->numeric_range ||
    scan->pattern_parenthesis ||
    (c == ')' && group_source_owner(s, PATTERN_GROUP_OPEN));
  scan->top = s->count ? &s->contexts[s->count - 1] : NULL;
  scan->context = scan->top ? scan->top->opener : TOKEN_COUNT;
  scan->in_body =
    scan->doc && !scan->doc->ending && scan->context == DOCUMENT_BEGIN;
  scan->in_word = word_part_context(scan->context);
  scan->quoted = scan->context == SQ_OPEN ||
    scan->context == DQ_OPEN ||
    scan->context == DOLLAR_SQ_OPEN;
  scan->quoting = source_quoting(s);
  scan->grouped = word_source_grouped(s);
  scan->subscript_prefix = valid[SUBSCRIPT_PREFIX_OPEN] &&
    c == '[' &&
    (scan->context == ARRAY_KEY_OPEN ||
      scan->context == PATTERN_BRACKET_OPEN ||
      scan->context == SUBSCRIPT_PREFIX_OPEN ||
      !subscript_boundary(
        in,
        false,
        subscript_word_bounded(scan),
        scan->quoting,
        s
      ));
  scan->subscript_start =
    (valid[SUBSCRIPT_OPEN] || valid[UNBRACED_SUBSCRIPT_OPEN]) &&
    c == '[' &&
    !key_context(scan->context) &&
    !scan->subscript_prefix &&
    ((valid[SUBSCRIPT_OPEN] && !arithmetic_context(scan->context)) ||
      subscript_boundary(
        in,
        false,
        subscript_word_bounded(scan),
        scan->quoting,
        s
      ));
  scan->special_parameter = valid[SPECIAL_PARAMETER] && in_set(c, "?!#$*-@");
}

static bool glob_source_start(const struct Scan *scan) {
  struct LogicalLexer *in = scan->in;
  int32_t c = current(in);
  return quoted_part_start(c) ||
    c == '(' ||
    brace_expansion_start(in, scan->owner, scan->grouped) ||
    expansion_start(in);
}

static bool source_part_start(const struct Scan *scan) {
  return glob_source_start(scan) || process_start(scan->s, scan->in);
}

static enum Token brace_separator_token(const struct Scan *scan) {
  int32_t c = current(scan->in);
  if (c != ',' && (c != '.' || logical_peek(scan->in) != '.'))
    return TOKEN_COUNT;
  if (scan->context == BRACE_EXPANSION_OPEN) {
    enum Token token = c == ',' ? BRACE_COMMA : BRACE_SEQUENCE_SEPARATOR;
    if (scan->valid[token]) return token;
  }
  return scan->valid[BRACE_SEPARATOR] ? BRACE_SEPARATOR : TOKEN_COUNT;
}

static enum Token brace_source_token(struct Scan *scan) {
  if (scan->quoting) return TOKEN_COUNT;
  int32_t c = current(scan->in);
  enum Token token = c == '}' && scan->valid[BRACE_SOURCE_CLOSE]
    ? BRACE_SOURCE_CLOSE
    : brace_separator_token(scan);
  return token != TOKEN_COUNT &&
      group_source_owner(scan->s, BRACE_EXPANSION_OPEN)
    ? token
    : TOKEN_COUNT;
}

static enum Token scan_brace_source(struct Scan *scan) {
  enum Token token = brace_source_token(scan);
  if (token != TOKEN_COUNT) {
    advance(scan->in);
    if (scan->c == '.') advance(scan->in);
  }
  return token;
}

static enum Token scan_structure(struct Scan *scan) {
  struct Scanner *s = scan->s;
  struct LogicalLexer *in = scan->in;
  const bool *valid = scan->valid;
  int32_t c = scan->c;
  if (
    (valid[ASSIGNMENT_BEGIN] || valid[DECLARATION_ASSIGNMENT_BEGIN]) &&
    assignment_start(in, false, NULL)
  )
    return valid[DECLARATION_ASSIGNMENT_BEGIN] ? DECLARATION_ASSIGNMENT_BEGIN
                                               : ASSIGNMENT_BEGIN;
  if (valid[ARRAY_ELEMENT_BEGIN] && assignment_start(in, true, NULL))
    return ARRAY_ELEMENT_BEGIN;
  if (valid[ARITHMETIC_EXPRESSION_BEGIN] && arithmetic_start(in, NULL))
    return ARITHMETIC_EXPRESSION_BEGIN;
  if (
    (valid[ARITHMETIC_FOR_BEGIN] ||
      (valid[ARITHMETIC_BEGIN] && !s->word_only)) &&
    arithmetic_start(in, NULL)
  )
    return valid[ARITHMETIC_FOR_BEGIN] ? ARITHMETIC_FOR_BEGIN
                                       : ARITHMETIC_BEGIN;
  if (valid[ARITHMETIC_END]) return ARITHMETIC_END;
  if (valid[FOR_WORDS_OPEN] && c == '(' && !arithmetic_start(in, NULL)) {
    advance(in);
    return FOR_WORDS_OPEN;
  }
  if (valid[CONDITION_BEGIN] && !s->word_only && scan->opens_condition)
    return CONDITION_BEGIN;
  if (
    valid[REGEX_BEGIN] &&
    c != '#' &&
    in->result == SOURCE_CHARACTER &&
    !regex_boundary(s, in, NULL) &&
    !condition_close_start(in)
  )
    return REGEX_BEGIN;
  return TOKEN_COUNT;
}

static enum Token scan_word_end(struct Scan *scan) {
  struct LogicalLexer *in = scan->in;
  const bool *valid = scan->valid;
  int32_t c = scan->c;
  bool ends =
    word_source_end(in, scan->owner, scan->grouped) && !scan->continues;
  if (
    (valid[ASSIGNMENT_END] || valid[ARRAY_ELEMENT_END]) &&
    (in->result != SOURCE_CHARACTER ||
      (ends && !(c == '(' && valid[ARRAY_OPEN])))
  )
    return valid[ARRAY_ELEMENT_END] ? ARRAY_ELEMENT_END : ASSIGNMENT_END;
  if (
    valid[WORD_END] &&
    (in->result != SOURCE_CHARACTER || ends || logical_backquote_end(in))
  )
    return WORD_END;
  return TOKEN_COUNT;
}

static enum Token scan_here_body(struct Scan *scan) {
  struct LogicalLexer *in = scan->in;
  const bool *valid = scan->valid;
  if (
    valid[DELIMITER_PARAMETER_REFERENCE] &&
    declaring_document(scan->s) &&
    in->result == SOURCE_CHARACTER &&
    scan->c != '"'
  )
    return DELIMITER_PARAMETER_REFERENCE;
  if (scan->in_body && scan->doc->quoted && valid[QUOTED_HERE_DOCUMENT_TEXT]) {
    while (in->result == SOURCE_CHARACTER) advance(in);
    if (in->consumed) return QUOTED_HERE_DOCUMENT_TEXT;
    return reject(scan);
  }
  if (
    declaring_document(scan->s) &&
    scan->c == '`' &&
    valid[HERE_DOCUMENT_DELIMITER_QUOTED]
  ) {
    advance(in);
    while (in->result == SOURCE_CHARACTER && current(in) != '`') {
      bool escaped = current(in) == '\\';
      advance(in);
      if (escaped && in->result == SOURCE_CHARACTER) advance(in);
    }
    if (in->result != SOURCE_CHARACTER) return reject(scan);
    advance(in);
    return HERE_DOCUMENT_DELIMITER_QUOTED;
  }
  return TOKEN_COUNT;
}

static enum Token scan_source_end(struct Scan *scan) {
  struct Scanner *s = scan->s;
  struct LogicalLexer *in = scan->in;
  const bool *valid = scan->valid;
  int32_t c = scan->c;
  if (
    valid[SUBSCRIPT_PREFIX_END] &&
    (c == ']' || enclosing_source_end(s, in, s->count - 1, false))
  )
    return SUBSCRIPT_PREFIX_END;
  if (
    valid[PATTERN_GROUP_END] &&
    c != ')' &&
    !scan->continues &&
    enclosing_source_end(s, in, s->count, scan->grouped)
  )
    return PATTERN_GROUP_END;
  if (
    valid[BRACE_EXPANSION_END] &&
    c != '}' &&
    !scan->continues &&
    enclosing_source_end(s, in, s->count, scan->grouped)
  )
    return BRACE_EXPANSION_END;
  if (
    scan->context == REGEX_BEGIN &&
    valid[REGEX_END] &&
    scan->top->arguments == 0 &&
    (in->result != SOURCE_CHARACTER || regex_boundary(s, in, scan->top))
  )
    return REGEX_END;
  return TOKEN_COUNT;
}

static enum Token scan_glob_argument(struct Scan *scan) {
  if (scan->context != GLOB_ARGUMENT_BEGIN) return TOKEN_COUNT;
  struct Scanner *s = scan->s;
  struct LogicalLexer *in = scan->in;
  const bool *valid = scan->valid;
  struct Context *top = scan->top;
  int32_t c = scan->c;
  if (top->initial && top->delimiter && valid[GLOB_ARGUMENT_OPEN]) {
    advance(in);
    return GLOB_ARGUMENT_OPEN;
  }
  bool at_end =
    !scan->continues && enclosing_source_end(s, in, s->count - 1, true);
  if (
    !at_end &&
    top->delimiter &&
    c == top->delimiter &&
    valid[GLOB_ARGUMENT_CLOSE]
  ) {
    advance(in);
    return GLOB_ARGUMENT_CLOSE;
  }
  if (
    valid[GLOB_ARGUMENT_END] &&
    (at_end ||
      (top->arguments == GLOB_SOURCE && !top->initial) ||
      (!top->delimiter &&
        !glob_source_start(scan) &&
        !glob_argument_character(
          (enum GlobArgument)top->arguments,
          c,
          top->initial
        )))
  )
    return GLOB_ARGUMENT_END;
  return TOKEN_COUNT;
}

static enum Token scan_glob_qualifier(struct Scan *scan) {
  if (
    scan->context != PATTERN_FLAGS_OPEN && scan->context != GLOB_QUALIFIER_OPEN
  )
    return TOKEN_COUNT;
  struct Scanner *s = scan->s;
  struct LogicalLexer *in = scan->in;
  const bool *valid = scan->valid;
  struct Context *top = scan->top;
  int32_t c = scan->c;
  if (
    valid[PATTERN_FLAGS_PREFIX] && top->initial && c == '#' && extended_glob(s)
  ) {
    top->delimiter = '#';
    advance(in);
    return PATTERN_FLAGS_PREFIX;
  }
  if (valid[GLOB_ARGUMENT_BEGIN] && top->delimiter == 'q' && c == '[')
    top->arguments = GLOB_DELIMITED;
  if (
    valid[GLOB_ARGUMENT_BEGIN] &&
    top->arguments &&
    (glob_source_start(scan) ||
      scan->process ||
      !enclosing_source_end(s, in, s->count, true))
  ) {
    enum GlobArgument kind = (enum GlobArgument)top->arguments;
    bool source = source_part_start(scan);
    if (
      kind == GLOB_DELIMITED || source || glob_argument_character(kind, c, true)
    ) {
      if (kind == GLOB_DELIMITED && source) top->arguments = GLOB_SOURCE;
      s->argument_delimiter = c;
      return GLOB_ARGUMENT_BEGIN;
    }
    top->arguments = 0;
  }
  if (valid[GLOB_QUALIFIER_SEPARATOR] && top->delimiter == 'q' && c == ',') {
    advance(in);
    return GLOB_QUALIFIER_SEPARATOR;
  }
  bool qualifier = top->delimiter == 'q';
  enum Token name =
    top->delimiter == '#' && c == 'q' && valid[GLOB_QUALIFIER_FLAG_NAME]
    ? GLOB_QUALIFIER_FLAG_NAME
    : GLOB_FLAG_NAME;
  if (
    !valid[name] ||
    !(top->delimiter == '#' ? in_set(c, "ilIbBmMacsequU")
                            : qualifier &&
          in_set(c, "/F.@=p*%rwxAIERWXSstfe+dlUGugamcL^-MTNDnYoOP"))
  )
    return TOKEN_COUNT;
  advance(in);
  int32_t next = current(in);
  enum GlobArgument kind = GLOB_NO_ARGUMENT;
  if (!qualifier) {
    if (c == 'q') top->delimiter = 'q';
    else if (c == 'a') kind = GLOB_INTEGER;
    else if (c == 'c') kind = GLOB_RANGE;
  } else if (c == '%' && (next == 'b' || next == 'c')) {
    advance(in);
  } else if (c == 'o' || c == 'O') {
    if (next == 'e' || next == '+') {
      kind = next == 'e' ? GLOB_DELIMITED : GLOB_NAME;
      advance(in);
    } else kind = GLOB_ORDER;
  } else if (c == '+') kind = GLOB_NAME;
  else if (c == 'a' || c == 'm' || c == 'c') kind = GLOB_TIME;
  else if (c == 'L') kind = GLOB_SIZE;
  else if (c == 'd' || c == 'l' || c == 'Y') kind = GLOB_INTEGER;
  else if (c == 'u' || c == 'g')
    kind = digit(next) ? GLOB_INTEGER : GLOB_DELIMITED;
  else if (c == 'f')
    kind =
      digit(next) || next == '+' || next == '-' || next == '=' || next == '?'
      ? GLOB_MODE
      : GLOB_DELIMITED;
  else if (c == 'e' || c == 'P') kind = GLOB_DELIMITED;
  top->arguments = kind;
  return name;
}

static size_t pending_width(const struct LogicalLexer *in) {
  return in->base + (size_t)in->character.origin.end - in->consumed;
}

static bool parameter_source_character(
  struct Scanner *s,
  struct LogicalLexer *in,
  enum Token token
) {
  int32_t c = current(in);
  if (!s->parameter_count) return false;
  struct ParameterSourceFrame *top =
    &s->parameter_frames[s->parameter_count - 1];
  enum Token opener = top->opener;
  if (top->remaining) {
    size_t consumed = pending_width(in);
    if (consumed > top->remaining) return false;
    top->remaining -= consumed;
    if (!top->remaining) s->parameter_count--;
    return true;
  }
  if (opener == SQ_OPEN) {
    if (c == '\'') s->parameter_count--;
    return true;
  }
  if (top->escaped) {
    top->escaped = false;
    if (opener != DQ_OPEN || double_quote_escape(c)) return true;
  }
  if (c == '\\') {
    top->dollar = false;
    top->escaped = true;
    return true;
  }
  if (opener == DOLLAR_SQ_OPEN || opener == BACKQUOTE_OPEN) {
    if (c == (opener == DOLLAR_SQ_OPEN ? '\'' : '`')) s->parameter_count--;
    return true;
  }
  bool dollar = top->dollar;
  top->dollar = c == '$';
  if (dollar) {
    if (c == '{') return parameter_source_push(s, PARAMETER_OPEN, top->quoting);
    if (c == '[' || c == '(') {
      size_t remaining = 0;
      if (c == '[' || token == TOKEN_COUNT) {
        struct LogicalPosition saved = logical_position(in);
        bool found = read_nested_boundary(in, false, NULL);
        if (found)
          remaining =
            in->consumed - in->base - (size_t)saved.character.origin.end;
        logical_restore_position(in, &saved);
        if (!found) return false;
      }
      if (!parameter_source_push(
            s,
            c == '[' ? ARITHMETIC_SQUARE_OPEN : COMMAND_OPEN,
            SOURCE_UNQUOTED
          ))
        return false;
      s->parameter_frames[s->parameter_count - 1].remaining = remaining;
      return true;
    }
    if (c == '\'' && !top->quoting)
      return parameter_source_push(s, DOLLAR_SQ_OPEN, SOURCE_UNQUOTED);
  }
  if (opener == DQ_OPEN) {
    if (c == '"') s->parameter_count--;
    else if (c == '`')
      return parameter_source_push(s, BACKQUOTE_OPEN, SOURCE_UNQUOTED);
    return true;
  }
  if (c == '"') return parameter_source_push(s, DQ_OPEN, SOURCE_DOUBLE_QUOTED);
  if (c == '\'' && !top->quoting)
    return parameter_source_push(s, SQ_OPEN, SOURCE_UNQUOTED);
  if (c == '`')
    return parameter_source_push(s, BACKQUOTE_OPEN, SOURCE_UNQUOTED);
  if (opener == COMMAND_OPEN) {
    if (token == COMMAND_CLOSE && c == ')') s->parameter_count--;
    return true;
  }
  if (c == '{' && !top->quoting)
    return parameter_source_push(s, PARAMETER_OPEN, SOURCE_UNQUOTED);
  if (c == '}') {
    if (s->parameter_count == 1 && token != PARAMETER_CLOSE) return false;
    s->parameter_count--;
  }
  return true;
}

static enum ParameterCharacter parameter_character_kind(
  const struct Scanner *s,
  const struct LogicalLexer *in
) {
  int32_t c = current(in);
  if (!s->parameter_count) return PARAMETER_LITERAL;
  const struct ParameterSourceFrame *top =
    &s->parameter_frames[s->parameter_count - 1];
  enum Token opener = top->opener;
  if (top->remaining)
    return top->remaining == pending_width(in) ? PARAMETER_SPECIAL
                                               : PARAMETER_LITERAL;
  if (top->escaped) return PARAMETER_LITERAL;
  if (opener == SQ_OPEN || opener == DOLLAR_SQ_OPEN)
    return c == '\'' ? PARAMETER_SPECIAL : PARAMETER_LITERAL;
  if (opener == BACKQUOTE_OPEN)
    return c == '`' ? PARAMETER_SPECIAL : PARAMETER_LITERAL;
  if (c == '$')
    return top->quoting ? PARAMETER_QUOTED_DOLLAR : PARAMETER_SPECIAL;
  if (c == '"' || c == '`' || c == '\\' || (c == '\'' && !top->quoting))
    return PARAMETER_SPECIAL;
  if (
    !top->quoting &&
    (in_set(c, "*?[]^~#(){}=|-") || (c == ',' && s->parameter_count > 1))
  )
    return PARAMETER_SPECIAL;
  return PARAMETER_LITERAL;
}

static bool parameter_delimiter(const struct Scan *scan) {
  return current(scan->in) == scan->top->delimiter &&
    parameter_character_kind(scan->s, scan->in) == scan->top->delimiter_kind;
}

static bool advance_parameter_source(struct Scan *scan) {
  scan->raw_scanned = true;
  if (!parameter_source_character(scan->s, scan->in, TOKEN_COUNT)) {
    scan->rejected = true;
    return false;
  }
  advance(scan->in);
  return true;
}

static enum Token scan_parameter_source(struct Scan *scan) {
  struct Context *top = scan->top;
  if (
    scan->context != PARAMETER_OPEN ||
    !top->source_depth ||
    !scan->valid[PARAMETER_CLOSING_TEXT]
  )
    return TOKEN_COUNT;
  struct Scanner *s = scan->s;
  struct LogicalLexer *in = scan->in;
  if (
    !top->source_tail &&
    (scan->c != '}' || s->parameter_count == top->source_depth)
  )
    return TOKEN_COUNT;
  size_t start = in->consumed;
  bool literal = parameter_source_literal(s);
  while (in->result == SOURCE_CHARACTER) {
    if (current(in) == '}' && s->parameter_count == top->source_depth) break;
    top->source_tail = true;
    if (!advance_parameter_source(scan)) return TOKEN_COUNT;
    if (literal != parameter_source_literal(s)) break;
  }
  return in->consumed > start ? PARAMETER_CLOSING_TEXT : TOKEN_COUNT;
}

static enum Token scan_parameter_flags(struct Scan *scan) {
  enum Token context = scan->context;
  if (context != PARAMETER_FLAGS_OPEN && context != SUBSCRIPT_FLAGS_OPEN)
    return TOKEN_COUNT;
  struct LogicalLexer *in = scan->in;
  const bool *valid = scan->valid;
  struct Context *top = scan->top;
  int32_t c = scan->c;
  bool parameter = context == PARAMETER_FLAGS_OPEN;
  if (
    valid[FLAG_ARGUMENT_OPEN] &&
    top->arguments &&
    (top->initial ||
      (parameter ? parameter_delimiter(scan) : c == top->delimiter)) &&
    in->result == SOURCE_CHARACTER
  ) {
    scan->s->argument_delimiter = c;
    top->delimiter = c;
    top->initial = false;
    top->arguments--;
    if (context == PARAMETER_FLAGS_OPEN) {
      top->delimiter_kind = parameter_character_kind(scan->s, in);
      if (!advance_parameter_source(scan)) return TOKEN_COUNT;
    } else {
      advance(in);
    }
    return FLAG_ARGUMENT_OPEN;
  }
  enum Token name = parameter ? PARAMETER_FLAG_NAME : SUBSCRIPT_FLAG_NAME;
  if (
    parameter &&
    !(c == ')' && (!top->arguments || !top->initial)) &&
    !in_set(c, "#%@AabcCDefFgikLn-oOPqQtuUvVwWXz0p~jlmrsZ_SI*BEMNR")
  )
    return reject(scan);
  if (valid[name] && in->result == SOURCE_CHARACTER && c != ')' && c != '}') {
    if (parameter) {
      top->flag_name = c;
      if (c == '*' && scan->s->count > 1)
        scan->s->contexts[scan->s->count - 2].extended_glob = true;
    } else if (scan->s->count > 1) {
      struct Context *owner = &scan->s->contexts[scan->s->count - 2];
      if (in_set(c, "rRiIkK")) owner->subscript_flags |= SUBSCRIPT_MATCH;
      if (c == 'e') owner->subscript_flags |= SUBSCRIPT_LITERAL_MATCH;
    }
    bool with_argument = in_set(c, parameter ? "gjlsrZ_I" : "snb");
    top->arguments = !with_argument         ? 0
      : parameter && (c == 'l' || c == 'r') ? 3
                                            : 1;
    top->initial = true;
    if (parameter) {
      if (!advance_parameter_source(scan)) return TOKEN_COUNT;
    } else {
      advance(in);
    }
    if (c == 'q' && (current(in) == '-' || current(in) == '+')) {
      if (parameter) {
        if (!advance_parameter_source(scan)) return TOKEN_COUNT;
      } else {
        advance(in);
      }
    }
    return name;
  }
  return TOKEN_COUNT;
}

static enum Token scan_flag_argument(struct Scan *scan) {
  struct Scanner *s = scan->s;
  struct LogicalLexer *in = scan->in;
  const bool *valid = scan->valid;
  struct Context *top = scan->top;
  enum Token context = scan->context;
  int32_t c = scan->c;
  bool argument = context == FLAG_ARGUMENT_OPEN;
  if (
    argument &&
    s->count > 1 &&
    s->contexts[s->count - 2].opener == PARAMETER_FLAGS_OPEN
  ) {
    if (parameter_delimiter(scan) && valid[FLAG_ARGUMENT_CLOSE])
      return advance_parameter_source(scan) ? FLAG_ARGUMENT_CLOSE : TOKEN_COUNT;
    if (!valid[FLAG_ARGUMENT_TEXT]) return TOKEN_COUNT;
    size_t start = in->consumed;
    bool literal = parameter_source_literal(s);
    int32_t flag = s->contexts[s->count - 2].flag_name;
    const char *options = within_here_delimiter(s) ? NULL
      : flag == '_'                                ? ""
      : flag == 'g'                                ? "oce"
      : flag == 'Z'                                ? "cCn"
                                                   : NULL;
    while (in->result == SOURCE_CHARACTER && !parameter_delimiter(scan)) {
      if (options && !in_set(current(in), options)) return reject(scan);
      if (!advance_parameter_source(scan)) return TOKEN_COUNT;
      if (literal != parameter_source_literal(s)) break;
    }
    return in->consumed > start ? FLAG_ARGUMENT_TEXT : TOKEN_COUNT;
  }
  bool replacement = context == PARAMETER_REPLACEMENT_OPERATOR;
  bool substring = context == PARAMETER_SUBSTRING_OPERATOR;
  if (
    argument &&
    valid[FLAG_ARGUMENT_CLOSE] &&
    c == top->delimiter &&
    !top->braces
  ) {
    advance(in);
    return FLAG_ARGUMENT_CLOSE;
  }
  if (
    argument &&
    valid[FLAG_ARGUMENT_END] &&
    (in->result != SOURCE_CHARACTER ||
      flag_argument_boundary(s, in, top, scan->quoting))
  )
    return FLAG_ARGUMENT_END;
  if (replacement && valid[PARAMETER_REPLACEMENT_END] && c == '}')
    return PARAMETER_REPLACEMENT_END;
  if (
    substring &&
    valid[PARAMETER_SUBSTRING_END] &&
    (c == '}' ||
      (c == ':' && (top->arguments || modifier_initial(logical_peek(in)))))
  )
    return PARAMETER_SUBSTRING_END;
  if (replacement && valid[PARAMETER_REPLACEMENT_SEPARATOR] && c == '/') {
    top->arguments = 1;
    advance(in);
    return PARAMETER_REPLACEMENT_SEPARATOR;
  }
  if (substring && valid[PARAMETER_SUBSTRING_SEPARATOR] && c == ':') {
    top->arguments = 1;
    advance(in);
    return PARAMETER_SUBSTRING_SEPARATOR;
  }
  return TOKEN_COUNT;
}

static enum Token scan_modifier(struct Scan *scan) {
  enum Token context = scan->context;
  if (!modifier_context(context)) return TOKEN_COUNT;
  struct Scanner *s = scan->s;
  struct LogicalLexer *in = scan->in;
  const bool *valid = scan->valid;
  struct Context *top = scan->top;
  int32_t c = scan->c;
  bool count_allowed = top->initial || context == GLOB_MODIFIER_BEGIN;
  bool at_end = in->result != SOURCE_CHARACTER ||
    (top->initial ? c == '}'
                  : (enclosing_source_end(s, in, s->count - 1, scan->grouped) &&
                      !scan->continues) ||
          logical_backquote_end(in));
  if (!top->initial && at_end && valid[MODIFIER_END]) return MODIFIER_END;
  if (
    valid[MODIFIER_CONTROL_NAME] &&
    (c == 'f' || c == 'F' || c == 'w' || c == 'W')
  ) {
    top->arguments = c == 'F' || c == 'W' ? 5 : 0;
    advance(in);
    return MODIFIER_CONTROL_NAME;
  }
  if (
    valid[FLAG_ARGUMENT_OPEN] &&
    top->arguments == 5 &&
    !at_end &&
    in->result == SOURCE_CHARACTER
  ) {
    s->argument_delimiter = c;
    top->arguments = 0;
    advance(in);
    return FLAG_ARGUMENT_OPEN;
  }
  if (
    valid[MODIFIER_END] &&
    (top->arguments == 3 ||
      (top->arguments == 4 && !(top->delimiter && count_allowed && digit(c))) ||
      (top->arguments == 2 && at_end))
  )
    return MODIFIER_END;
  enum Token separator = TOKEN_COUNT;
  if (
    valid[MODIFIER_SUBSTITUTION_OPEN] &&
    !at_end &&
    in->result == SOURCE_CHARACTER
  ) {
    top->delimiter = c;
    top->arguments = 1;
    separator = MODIFIER_SUBSTITUTION_OPEN;
  } else if (c == top->delimiter) {
    separator = top->arguments == 1 ? MODIFIER_SUBSTITUTION_SEPARATOR
                                    : MODIFIER_SUBSTITUTION_CLOSE;
    if (valid[separator]) top->arguments++;
    else separator = TOKEN_COUNT;
  }
  if (separator != TOKEN_COUNT) {
    if (!scan->quoting && c == '(') top->parentheses++;
    else if (!scan->quoting && c == ')') {
      struct Context *owner = group_source_owner(s, PATTERN_GROUP_OPEN);
      if (owner) owner->parentheses--;
    }
    advance(in);
    return separator;
  }
  if (
    (valid[MODIFIER_NAME] ||
      valid[MODIFIER_GLOBAL_NAME] ||
      valid[MODIFIER_SUBSTITUTION_NAME]) &&
    modifier_initial(c)
  ) {
    int32_t letter = c;
    if (c == 'g' && (logical_peek(in) == 's' || logical_peek(in) == '&')) {
      advance(in);
      letter = current(in);
    }
    bool global = letter == 'G' && valid[MODIFIER_GLOBAL_NAME];
    if (
      context == MODIFIER_BEGIN &&
      !in_set(letter, "aAcehlPqQrstu&") &&
      !(letter == 'G' && (global || within_here_delimiter(s)))
    )
      return reject(scan);
    enum Token name = global ? MODIFIER_GLOBAL_NAME
      : letter == 's'        ? MODIFIER_SUBSTITUTION_NAME
                             : MODIFIER_NAME;
    if (valid[name]) {
      top->arguments = letter == 's' ? 0 : 4;
      top->delimiter = letter == 'h' || letter == 't';
      advance(in);
      return name;
    }
  }
  if (valid[MODIFIER_COUNT] && top->delimiter && count_allowed && digit(c)) {
    do {
      advance(in);
    } while (digit(current(in)));
    top->delimiter = 0;
    return MODIFIER_COUNT;
  }
  return TOKEN_COUNT;
}

static enum Token scan_parenthesis_source(struct Scan *scan) {
  if (scan->quoting || scan->c != ')' || !scan->valid[LITERAL])
    return TOKEN_COUNT;
  struct Context *owner = group_source_owner(scan->s, PATTERN_GROUP_OPEN);
  if (!owner) return TOKEN_COUNT;
  owner->parentheses--;
  advance(scan->in);
  if (word_context(scan->context) || assignment_context(scan->context))
    scan->top->delimiter = ')';
  return LITERAL;
}

static enum Token scan_layout(struct Scan *scan) {
  struct LogicalLexer *in = scan->in;
  const bool *valid = scan->valid;
  int32_t c = scan->c;
  bool subscript_math = subscript_context(scan->context) &&
    !(subscript_flags(scan->s) & SUBSCRIPT_MATCH);
  bool key_math = arithmetic_key_context(scan->s);
  if ((scan->in_word && !subscript_math && !key_math) || scan->quoted)
    return TOKEN_COUNT;
  bool vertical = arithmetic_context(scan->context) ||
    subscript_math ||
    key_math ||
    scan->context == CONDITION_BEGIN ||
    scan->context == CONDITION_GROUP_OPEN;
  if (
    !scan->in_body &&
    valid[LAYOUT] &&
    (horizontal(c) || (vertical && c == '\n'))
  ) {
    do {
      advance(in);
    } while (horizontal(current(in)) || (vertical && current(in) == '\n'));
    return LAYOUT;
  }
  if (valid[NEWLINE] && c == '\n') {
    advance(in);
    return NEWLINE;
  }
  return TOKEN_COUNT;
}

static enum Token scan_redirect(struct Scan *scan) {
  struct LogicalLexer *in = scan->in;
  const bool *valid = scan->valid;
  int32_t c = scan->c;
  if (
    valid[IO_VARIABLE_OPEN] &&
    scan->s->word_only &&
    !valid[FUNCTION_BODY_BEGIN] &&
    !valid[FUNCTION_ARGUMENTS_END] &&
    !valid[NAME] &&
    c == '{' &&
    has_variable_descriptor(in)
  ) {
    advance(in);
    return IO_VARIABLE_OPEN;
  }
  if (valid[IO_VARIABLE_CLOSE] && c == '}') {
    advance(in);
    return IO_VARIABLE_CLOSE;
  }
  if (
    (valid[IO_NUMBER] || valid[FUNCTION_BODY_BEGIN]) &&
    digit(c) &&
    has_descriptor(in)
  ) {
    if (valid[FUNCTION_BODY_BEGIN]) return FUNCTION_BODY_BEGIN;
    advance(in);
    return IO_NUMBER;
  }
  if (
    !scan->quoted &&
    !scan->in_body &&
    !scan->numeric_range &&
    (c == '<' || c == '>' || c == '&')
  ) {
    struct LogicalPosition start = logical_position(in);
    enum Token token = read_redirect(in);
    if (token != TOKEN_COUNT) {
      if (valid[FUNCTION_BODY_BEGIN]) {
        logical_restore_position(in, &start);
        return FUNCTION_BODY_BEGIN;
      }
      if (valid[token]) return token;
    }
    logical_restore_position(in, &start);
  }
  return TOKEN_COUNT;
}

static enum Token scan_precommand(struct Scan *scan) {
  enum Token context = scan->context;
  if (!precommand_context(context)) return TOKEN_COUNT;
  struct LogicalLexer *in = scan->in;
  const bool *valid = scan->valid;
  struct Context *top = scan->top;
  if (
    top->arguments &&
    valid[PRECOMMAND_OPERAND_BEGIN] &&
    in->result == SOURCE_CHARACTER &&
    (!word_boundary(in, WORD_BEGIN) || scan->continues) &&
    scan->c != '#'
  ) {
    top->arguments = 0;
    return PRECOMMAND_OPERAND_BEGIN;
  }
  bool ended, operand;
  if (
    context != PRECOMMAND_PLAIN_NAME &&
    top->initial &&
    valid[PRECOMMAND_OPTION_BEGIN] &&
    precommand_option(in, &ended, &operand)
  ) {
    top->initial = !ended;
    top->arguments = context == PRECOMMAND_EXEC_NAME && operand;
    return PRECOMMAND_OPTION_BEGIN;
  }
  if (valid[PRECOMMAND_END]) return PRECOMMAND_END;
  return TOKEN_COUNT;
}

static enum Token scan_command_word(struct Scan *scan) {
  struct Scanner *s = scan->s;
  struct LogicalLexer *in = scan->in;
  const bool *valid = scan->valid;
  struct Context *top = scan->top;
  enum Token context = scan->context;
  int32_t c = scan->c;
  if (context == CASE_PATTERN_BEGIN && !top->delimiter && horizontal(c)) {
    struct LogicalPosition saved = logical_position(in);
    do {
      advance(in);
    } while (horizontal(current(in)));
    if (
      (top->initial || current(in) == '|' || current(in) == ')') &&
      valid[LAYOUT]
    )
      return LAYOUT;
    logical_restore_position(in, &saved);
  }
  bool arithmetic = arithmetic_context(context);
  bool condition =
    context == CONDITION_BEGIN || context == CONDITION_GROUP_OPEN;
  if (
    !scan->in_word &&
    !scan->quoted &&
    !scan->in_body &&
    !arithmetic &&
    !condition &&
    context != ARRAY_OPEN &&
    !valid[REDIRECT_WORD_BEGIN] &&
    !valid[COUNT_WORD_BEGIN]
  ) {
    enum Token modifier_name = precommand_name(in, valid, s->word_only);
    if (modifier_name < TOKEN_COUNT) return modifier_name;
    if (valid[COMMAND_PREFIX_END]) return TOKEN_COUNT;
    if (
      !s->word_only &&
      !valid[CASE_PATTERN_BEGIN] &&
      ((scan->opens_negation && !valid[NEGATION]) ||
        (scan->opens_condition && !valid[CONDITION_BEGIN]) ||
        (c == '{' && !valid[LEFT_BRACE] && !valid[HEADER_BRACE_OPEN]) ||
        (c == '(' &&
          !valid[LEFT_PAREN] &&
          !(valid[FUNCTION_OPEN] && logical_peek(in) == ')')))
    )
      return reject(scan);
    struct LogicalPosition start = logical_position(in);
    enum Token token = read_keyword(in, timing_context(s));
    if (token != TOKEN_COUNT) {
      bool word_only = s->word_only || valid[CASE_PATTERN_BEGIN];
      bool contextual = token == IN_KEYWORD || token == ALWAYS_KEYWORD;
      bool header = token == DO_KEYWORD || token == ESAC_KEYWORD;
      if (valid[token] && (!word_only || contextual || header)) return token;
      logical_restore_position(in, &start);
      if (!word_only && !contextual) return reject(scan);
    }
  }
  if (
    valid[CASE_PATTERN_BEGIN] &&
    in->result == SOURCE_CHARACTER &&
    !horizontal(c) &&
    c != '\n' &&
    c != ';' &&
    c != ')' &&
    !closing_brace_start(in) &&
    (c != '#' || !(valid[COMMENT_TEXT] || valid[TRAILING_COMMENT_TEXT]))
  )
    return CASE_PATTERN_BEGIN;
  if (
    !scan->in_word &&
    !scan->quoted &&
    !arithmetic &&
    !subscript_context(context) &&
    !condition &&
    !scan->in_body &&
    c == ';'
  ) {
    struct LogicalPosition start = logical_position(in);
    enum Token token = read_control_operator(in);
    if (case_terminator(token)) {
      if (!valid[token]) return reject(scan);
      return token;
    }
    logical_restore_position(in, &start);
  }
  return TOKEN_COUNT;
}

static enum Token scan_arithmetic(struct Scan *scan) {
  struct LogicalLexer *in = scan->in;
  const bool *valid = scan->valid;
  enum Token context = scan->context;
  if (
    valid[SUBSCRIPT_PATTERN_BEGIN] &&
    subscript_pattern(scan->s) &&
    scan->c != ',' &&
    !enclosing_source_end(scan->s, in, scan->s->count, false)
  )
    return SUBSCRIPT_PATTERN_BEGIN;
  if (
    valid[SUBSCRIPT_LITERAL_BEGIN] &&
    subscript_flags(scan->s) == (SUBSCRIPT_MATCH | SUBSCRIPT_LITERAL_MATCH) &&
    scan->c != ',' &&
    !enclosing_source_end(scan->s, in, scan->s->count, false)
  )
    return SUBSCRIPT_LITERAL_BEGIN;
  if (arithmetic_context(context)) {
    if (
      valid[ARITHMETIC_SOURCE_FRAGMENT] &&
      scan->c == '\\' &&
      arithmetic_opening(logical_peek(in))
    ) {
      struct Context *owner = arithmetic_owner(scan->s);
      if (owner && owner->opener == ARITHMETIC_BEGIN) {
        advance(in);
        return ARITHMETIC_SOURCE_FRAGMENT;
      }
    }
    return arithmetic_token(in, valid, scan->top->arguments != 0);
  }
  if (arithmetic_key_context(scan->s) && !scan->process) {
    struct LogicalPosition saved = logical_position(in);
    enum Token token = arithmetic_token(in, valid, true);
    if (token == TOKEN_COUNT) logical_restore_position(in, &saved);
    return token;
  }
  if (
    subscript_context(context) && (context != SUBSCRIPT_OPEN || scan->c != ',')
  ) {
    if (subscript_flags(scan->s) & SUBSCRIPT_MATCH) return TOKEN_COUNT;
    if (
      valid[SUBSCRIPT_ALL_ELEMENTS] &&
      context == SUBSCRIPT_OPEN &&
      scan->top->word_start &&
      !(subscript_flags(scan->s) & SUBSCRIPT_LITERAL_MATCH) &&
      (scan->c == '*' || scan->c == '@') &&
      logical_peek(in) == ']'
    ) {
      advance(in);
      return SUBSCRIPT_ALL_ELEMENTS;
    }
    if (valid[ARITHMETIC_OPERATOR] && scan->c == '@') {
      advance(in);
      return ARITHMETIC_OPERATOR;
    }
    return arithmetic_token(in, valid, scan->top->arguments != 0);
  }
  return TOKEN_COUNT;
}

static bool
regex_shell_start(const struct Scanner *s, struct LogicalLexer *in) {
  if (
    current(in) == '>' &&
    s->count &&
    s->contexts[s->count - 1].opener == REGEX_BEGIN &&
    s->contexts[s->count - 1].delimiter == '>'
  )
    return false;
  return quoted_part_start(current(in)) ||
    expansion_start(in) ||
    process_start(s, in);
}

static void regex_advance(struct LogicalLexer *in, struct Context *context) {
  int32_t c = current(in);
  if (c == '(') context->arguments++;
  else if (c == ')' && context->arguments) context->arguments--;
  else if (c == '{') context->braces++;
  else if (c == '}' && context->braces) context->braces--;
  if (c == '>' && context->delimiter == '>') context->delimiter = 0;
  advance(in);
}

static bool regex_skip_shell(const struct Scanner *s, struct LogicalLexer *in) {
  if (current(in) == '\\') {
    advance(in);
    if (in->result != SOURCE_CHARACTER) return false;
    advance(in);
    return true;
  }
  if (nested_source_start(in) || process_start(s, in))
    return read_nested_boundary(in, false, NULL);
  if (current(in) != '$' || !expansion_start(in)) return false;
  advance(in);
  while (in_set(current(in), "^=~")) advance(in);
  if (current(in) == '#') advance(in);
  if (name_character(current(in))) skip_name(in);
  else if (in->result == SOURCE_CHARACTER) advance(in);
  if (current(in) == '[') {
    struct BoundaryProbe probe = {0};
    bool found =
      read_subscript_boundary(&probe, in, false, true, SOURCE_UNQUOTED);
    ts_free(probe.frames);
    clear(&probe.documents);
    if (!found) return false;
  }
  return true;
}

static bool regex_delimited(const struct Scan *scan, int32_t kind) {
  struct LogicalLexer *in = scan->in;
  struct LogicalPosition saved = logical_position(in);
  struct Context context = *scan->top;
  bool first = kind == '[', content = false, minimum = false, comma = false,
       found = false;
  regex_advance(in, &context);
  if (kind == '[' && current(in) == '^') advance(in);
  if (kind != '[' && kind != '{') advance(in);
  int32_t marker = 0;
  while (in->result == SOURCE_CHARACTER && !logical_backquote_end(in)) {
    int32_t c = current(in);
    if (regex_shell_start(scan->s, in)) {
      if (!regex_skip_shell(scan->s, in)) break;
      content = true;
      first = false;
      if (!comma) minimum = true;
      continue;
    }
    if (regex_boundary(scan->s, in, &context)) break;
    if (numeric_range_start(in)) {
      skip_numeric_range(in);
      content = true;
      first = false;
      if (kind == '{') break;
      continue;
    }
    if (kind == '{') {
      if (c == '}') {
        found = minimum;
        break;
      }
      if (digit(c)) {
        if (!comma) minimum = true;
      } else if (c == ',' && minimum && !comma) comma = true;
      else break;
    } else if (kind == '[') {
      if (marker) {
        if (c == marker && logical_peek(in) == ']') {
          advance(in);
          advance(in);
          marker = 0;
          continue;
        }
      } else {
        if (c == ']' && !first) {
          found = content;
          break;
        }
        if (c == '[' && in_set(logical_peek(in), ":.=")) {
          advance(in);
          marker = current(in);
        }
      }
    } else if (c == kind && logical_peek(in) == ']') {
      found = content;
      break;
    }
    regex_advance(in, &context);
    first = false;
    content = true;
  }
  logical_restore_position(in, &saved);
  return found;
}

static enum Token regex_character(struct Scan *scan, enum Token token) {
  regex_advance(scan->in, scan->top);
  return token;
}

static bool regex_empty_parentheses(struct LogicalLexer *in) {
  if (current(in) != '(' || logical_peek(in) != ')') return false;
  struct SourceStage stage = in->cursor.stages[in->cursor.stage_count - 1];
  stage.disabled = true;
  struct LogicalLexer source;
  if (!logical_fork(
        &source,
        in,
        logical_raw_position(in),
        in->cursor.stage_count - 1,
        &stage,
        1
      ))
    return false;
  advance(&source);
  bool adjacent = current(&source) == ')';
  logical_clear(&source);
  return adjacent;
}

static enum Token scan_regex(struct Scan *scan) {
  if (scan->context != REGEX_BEGIN) return TOKEN_COUNT;
  struct LogicalLexer *in = scan->in;
  const bool *valid = scan->valid;
  struct Context *top = scan->top;
  int32_t c = current(in);
  if (
    valid[REGEX_SOURCE_GROUP_END] &&
    !top->arguments &&
    (in->result != SOURCE_CHARACTER || regex_boundary(scan->s, in, top))
  )
    return REGEX_SOURCE_GROUP_END;
  if (
    in->result != SOURCE_CHARACTER ||
    logical_backquote_end(in) ||
    regex_boundary(scan->s, in, top)
  )
    return TOKEN_COUNT;
  if (regex_shell_start(scan->s, in)) return TOKEN_COUNT;
  if (regex_empty_parentheses(in)) return reject(scan);
  if (c == '<' && numeric_range_start(in)) top->delimiter = '>';
  bool payload = valid[ERE_COMPOUND_CHARACTER_BEGIN] ||
    valid[ERE_COMPOUND_MULTI_BEGIN] ||
    valid[ERE_EQUIVALENCE_CHARACTER_BEGIN] ||
    valid[ERE_EQUIVALENCE_MULTI_BEGIN] ||
    valid[ERE_CLASS_NAME_BEGIN];
  static const struct {
    int32_t character;
    enum Token token;
  } markers[] = {
    {':', ERE_COLON},
    {'.', ERE_DOT},
    {'=', ERE_EQUAL},
    {']', ERE_COMPOUND_CLOSE},
    {']', ERE_BRACKET_CLOSE},
    {'}', ERE_INTERVAL_CLOSE},
    {',', ERE_COMMA},
    {'^', ERE_NEGATION},
  };
  for (size_t i = 0; i < sizeof(markers) / sizeof(*markers); ++i) {
    if (
      valid[markers[i].token] &&
      c == markers[i].character &&
      (!in_set(c, ":.=") || !payload || logical_peek(in) == ']')
    )
      return regex_character(scan, markers[i].token);
  }
  bool compound_fragment = false;
  if (c == '[') {
    int32_t next = logical_peek(in);
    enum Token compound = next == ':' ? ERE_CLASS_OPEN
      : next == '.'                   ? ERE_COLLATING_OPEN
                                      : ERE_EQUIVALENCE_OPEN;
    if (in_set(next, ":.=") && valid[compound]) {
      if (regex_delimited(scan, next)) return regex_character(scan, compound);
      compound_fragment = true;
    }
    if (valid[ERE_BRACKET_OPEN] && regex_delimited(scan, '['))
      return regex_character(scan, ERE_BRACKET_OPEN);
  }
  if (c == ']' && valid[ERE_INITIAL_CLOSE_BEGIN])
    return regex_character(scan, ERE_INITIAL_CLOSE_BEGIN);
  if (c == '-') {
    if (valid[ERE_INITIAL_HYPHEN])
      return regex_character(scan, ERE_INITIAL_HYPHEN);
    if (valid[ERE_RANGE_END_HYPHEN])
      return regex_character(scan, ERE_RANGE_END_HYPHEN);
    if (valid[ERE_LITERAL_HYPHEN] && logical_peek(in) == ']')
      return regex_character(scan, ERE_LITERAL_HYPHEN);
    if (valid[ERE_HYPHEN] && logical_peek(in) != ']') {
      struct LogicalPosition saved = logical_position(in);
      advance(in);
      bool endpoint = !regex_shell_start(scan->s, in);
      if (current(in) == '[' && in_set(logical_peek(in), ":.="))
        endpoint = logical_peek(in) == '.' && regex_delimited(scan, '.');
      logical_restore_position(in, &saved);
      if (endpoint) return regex_character(scan, ERE_HYPHEN);
    }
  }
  if (
    valid[ERE_COMPOUND_CHARACTER_BEGIN] ||
    valid[ERE_COMPOUND_MULTI_BEGIN] ||
    valid[ERE_EQUIVALENCE_CHARACTER_BEGIN] ||
    valid[ERE_EQUIVALENCE_MULTI_BEGIN]
  ) {
    bool equivalence = valid[ERE_EQUIVALENCE_CHARACTER_BEGIN] ||
      valid[ERE_EQUIVALENCE_MULTI_BEGIN];
    int32_t marker = equivalence ? '=' : '.';
    size_t count = 0;
    while (
      in->result == SOURCE_CHARACTER &&
      !logical_backquote_end(in) &&
      !regex_boundary(scan->s, in, top) &&
      !regex_shell_start(scan->s, in) &&
      !regex_empty_parentheses(in)
    ) {
      if (current(in) == marker && logical_peek(in) == ']') break;
      regex_advance(in, top);
      if (count < 2) count++;
    }
    if (!count) return TOKEN_COUNT;
    enum Token token = equivalence ? count == 1
        ? ERE_EQUIVALENCE_CHARACTER_BEGIN
        : ERE_EQUIVALENCE_MULTI_BEGIN
      : count == 1                 ? ERE_COMPOUND_CHARACTER_BEGIN
                                   : ERE_COMPOUND_MULTI_BEGIN;
    if (
      count == 1 &&
      in_set(c, "-]") &&
      current(in) == marker &&
      logical_peek(in) == ']'
    )
      token = equivalence ? ERE_FRAGMENT_BEGIN : ERE_META_CHARACTER_BEGIN;
    return valid[token] ? token : TOKEN_COUNT;
  }
  if (c == '(' || c == ')') {
    enum Token member =
      c == '(' ? ERE_MEMBER_OPEN_BEGIN : ERE_MEMBER_CLOSE_BEGIN;
    if (valid[member]) return regex_character(scan, member);
    enum Token group = c == '(' ? REGEX_OPEN : REGEX_CLOSE;
    if (valid[group]) return regex_character(scan, group);
    if (c == ')' && valid[ERE_ORDINARY_CLOSE])
      return regex_character(scan, ERE_ORDINARY_CLOSE);
  }
  if (valid[ERE_CLASS_NAME_BEGIN] && name_start(c) && c != '_') {
    do {
      advance(in);
    } while (name_character(current(in)) && current(in) != '_');
    return ERE_CLASS_NAME_BEGIN;
  }
  if (valid[ERE_COUNT_BEGIN] && digit(c)) {
    do {
      advance(in);
    } while (digit(current(in)));
    return ERE_COUNT_BEGIN;
  }
  if (
    valid[ERE_COLLATING_CHARACTER_BEGIN] &&
    !compound_fragment &&
    !in_set(c, "-]")
  )
    return regex_character(scan, ERE_COLLATING_CHARACTER_BEGIN);
  if (valid[ERE_MODIFIER_BEGIN] && c == '?')
    return regex_character(scan, ERE_MODIFIER_BEGIN);
  if (valid[ERE_INTERVAL_OPEN] && c == '{' && regex_delimited(scan, '{'))
    return regex_character(scan, ERE_INTERVAL_OPEN);
  static const struct {
    int32_t character;
    enum Token token;
  } operators[] = {
    {'*', ERE_STAR},
    {'+', ERE_PLUS},
    {'?', ERE_QUESTION},
    {'.', ERE_WILDCARD_BEGIN},
    {'^', ERE_LEFT_ANCHOR_BEGIN},
    {'$', ERE_RIGHT_ANCHOR_BEGIN},
  };
  for (size_t i = 0; i < sizeof(operators) / sizeof(*operators); ++i)
    if (valid[operators[i].token] && c == operators[i].character)
      return regex_character(scan, operators[i].token);
  if (c == '|') {
    struct LogicalPosition saved = logical_position(in);
    advance(in);
    bool empty = regex_boundary(scan->s, in, top) || in_set(current(in), ")|");
    logical_restore_position(in, &saved);
    enum Token token = valid[ERE_BAR] && !empty ? ERE_BAR : ERE_SOURCE_BAR;
    if (valid[token]) return regex_character(scan, token);
  }
  if (c == '}' && valid[ERE_ORDINARY_BRACE])
    return regex_character(scan, ERE_ORDINARY_BRACE);
  if (valid[ERE_CHARACTER_BEGIN] && !in_set(c, "([{*+?|.^$"))
    return regex_character(scan, ERE_CHARACTER_BEGIN);
  if (!valid[ERE_FRAGMENT_BEGIN]) return TOKEN_COUNT;
  int32_t closing = c == '[' ? ']' : c == '{' ? '}' : 0;
  do {
    int32_t consumed = current(in);
    regex_advance(in, top);
    if (!closing || consumed == closing) break;
  } while (
    in->result == SOURCE_CHARACTER &&
    !logical_backquote_end(in) &&
    !regex_boundary(scan->s, in, top) &&
    !in_set(current(in), "()") &&
    !regex_shell_start(scan->s, in)
  );
  return ERE_FRAGMENT_BEGIN;
}

static enum Token scan_condition(struct Scan *scan) {
  enum Token context = scan->context;
  if (context != CONDITION_BEGIN && context != CONDITION_GROUP_OPEN)
    return TOKEN_COUNT;
  struct LogicalLexer *in = scan->in;
  const bool *valid = scan->valid;
  if (valid[CONDITION_NOT] && scan->c == '!' && boundary(logical_peek(in))) {
    advance(in);
    return CONDITION_NOT;
  }
  struct LogicalPosition saved = logical_position(in);
  size_t length = 0;
  enum Token token =
    condition_operator(in, valid[CONDITION_UNARY_OPERATOR], &length);
  if (token != TOKEN_COUNT && valid[token]) {
    if (token != CONDITION_UNARY_OPERATOR) return token;
    struct LogicalPosition end = logical_position(in);
    bool operand = condition_operand(in);
    bool binary = condition_infix(in);
    if (!binary && length == 1) return reject(scan);
    if (!binary && (length == 2 || operand)) {
      logical_restore_position(in, &end);
      return token;
    }
  }
  logical_restore_position(in, &saved);
  return TOKEN_COUNT;
}

static bool unbraced_modifier_start(struct Scan *scan) {
  struct LogicalLexer *in = scan->in;
  struct LogicalPosition saved = logical_position(in);
  advance(in);
  while (in->result == SOURCE_CHARACTER && in_set(current(in), "fFwW")) {
    int32_t control = current(in);
    advance(in);
    if (control == 'F' || control == 'W') {
      if (in->result != SOURCE_CHARACTER) break;
      int32_t opening = current(in);
      int32_t delimiter = closing_delimiter(opening);
      advance(in);
      while (
        in->result == SOURCE_CHARACTER &&
        current(in) != delimiter &&
        !enclosing_source_end(
          scan->s,
          in,
          scan->s->count,
          scan->grouped || opening != delimiter
        ) &&
        !logical_backquote_end(in)
      )
        advance(in);
      if (in->result != SOURCE_CHARACTER || current(in) != delimiter) break;
      advance(in);
    }
  }
  if (current(in) == 'g' && in_set(logical_peek(in), "s&")) advance(in);
  bool matches =
    in->result == SOURCE_CHARACTER && in_set(current(in), "aAcehlPqQrstu&");
  logical_restore_position(in, &saved);
  return matches;
}

static enum Token scan_parameter_operator(struct Scan *scan) {
  struct LogicalLexer *in = scan->in;
  const bool *valid = scan->valid;
  struct Context *top = scan->top;
  enum Token context = scan->context;
  int32_t c = scan->c;
  if (
    valid[ASSIGNMENT_OPERATOR] &&
    (c == '=' || (c == '+' && logical_peek(in) == '='))
  ) {
    advance(in);
    if (c == '+') advance(in);
    return ASSIGNMENT_OPERATOR;
  }
  if (valid[PARAMETER_LENGTH_OPERATOR] && c == '#') {
    struct LogicalPosition start = logical_position(in);
    advance(in);
    int32_t next = current(in);
    if (
      name_character(next) ||
      in_set(next, "?$*-@") ||
      (context == PARAMETER_OPEN &&
        ((next == '#' && logical_peek(in) == '}') ||
          (next == ':' && logical_peek(in) == '-')))
    )
      return PARAMETER_LENGTH_OPERATOR;
    logical_restore_position(in, &start);
  }
  if (valid[PARAMETER_PREFIX_OPERATOR] && in_set(c, "^=~+")) {
    advance(in);
    if (c != '+' && current(in) == c) advance(in);
    return PARAMETER_PREFIX_OPERATOR;
  }
  if (
    valid[PARAMETER_REPLACEMENT_OPERATOR] &&
    (c == '/' || (c == ':' && logical_peek(in) == '/'))
  ) {
    advance(in);
    if (current(in) == '/') advance(in);
    return PARAMETER_REPLACEMENT_OPERATOR;
  }
  bool modifier_follows = c == ':' && modifier_initial(logical_peek(in));
  if (modifier_follows && valid[UNBRACED_MODIFIER_BEGIN])
    modifier_follows = unbraced_modifier_start(scan);
  if (valid[MODIFIER_GLOBAL_BEGIN] && c == ':' && logical_peek(in) == 'G') {
    advance(in);
    return MODIFIER_GLOBAL_BEGIN;
  }
  if (
    valid[GLOB_MODIFIER_BEGIN] &&
    !valid[UNBRACED_MODIFIER_BEGIN] &&
    !valid[MODIFIER_BEGIN] &&
    (context == PATTERN_FLAGS_OPEN || context == GLOB_QUALIFIER_OPEN) &&
    (top->delimiter == 'q' || top->delimiter == ':') &&
    modifier_follows
  ) {
    top->delimiter = ':';
    advance(in);
    return GLOB_MODIFIER_BEGIN;
  }
  if (
    (valid[MODIFIER_BEGIN] || valid[UNBRACED_MODIFIER_BEGIN]) &&
    modifier_follows
  ) {
    advance(in);
    return valid[UNBRACED_MODIFIER_BEGIN] ? UNBRACED_MODIFIER_BEGIN
                                          : MODIFIER_BEGIN;
  }
  bool special = scan->special_parameter;
  if (
    valid[PARAMETER_PATTERN_OPERATOR] &&
    !special &&
    (c == '#' || c == '%' || (c == ':' && logical_peek(in) == '#'))
  ) {
    advance(in);
    if (current(in) == c || (c == ':' && current(in) == '#')) advance(in);
    return PARAMETER_PATTERN_OPERATOR;
  }
  if (valid[PARAMETER_VALUE_OPERATOR] && !special && matches(in, "::="))
    return PARAMETER_VALUE_OPERATOR;
  if (
    valid[PARAMETER_VALUE_OPERATOR] &&
    !special &&
    (c == '-' ||
      c == '+' ||
      c == '=' ||
      c == '?' ||
      (c == ':' && in_set(logical_peek(in), "-+=?|*^")))
  ) {
    advance(in);
    if (c == ':' && in_set(current(in), "-+=?|*^")) {
      int32_t second = current(in);
      advance(in);
      if (second == '^' && current(in) == '^') advance(in);
    }
    return PARAMETER_VALUE_OPERATOR;
  }
  if (valid[PARAMETER_SUBSTRING_OPERATOR] && c == ':') {
    advance(in);
    return PARAMETER_SUBSTRING_OPERATOR;
  }
  return TOKEN_COUNT;
}

static enum Token scan_word_start(struct Scan *scan) {
  struct Scanner *s = scan->s;
  struct LogicalLexer *in = scan->in;
  const bool *valid = scan->valid;
  int32_t c = scan->c;
  if (valid[NAME] && name_start(c)) {
    struct LogicalPosition start = logical_position(in);
    do {
      advance(in);
    } while (name_character(current(in)));
    if (command_word_end(in)) return NAME;
    logical_restore_position(in, &start);
  }
  if ((valid[FUNCTION_OPTION] || valid[FUNCTION_OPTIONS_END]) && c == '-') {
    struct LogicalPosition saved = logical_position(in);
    if (valid[FUNCTION_OPTION] && matches(in, "-T") && command_word_end(in))
      return FUNCTION_OPTION;
    logical_restore_position(in, &saved);
    if (
      valid[FUNCTION_OPTIONS_END] && matches(in, "--") && command_word_end(in)
    )
      return FUNCTION_OPTIONS_END;
    logical_restore_position(in, &saved);
  }
  if (valid[NEGATION] && !s->word_only && scan->opens_negation) {
    advance(in);
    return NEGATION;
  }
  if (valid[COMMAND_PREFIX_END]) return COMMAND_PREFIX_END;
  enum Token word_begin = valid[REDIRECT_WORD_BEGIN] ? REDIRECT_WORD_BEGIN
    : valid[FUNCTION_ARGUMENT_BEGIN]                 ? FUNCTION_ARGUMENT_BEGIN
    : valid[COUNT_WORD_BEGIN]                        ? COUNT_WORD_BEGIN
                                                     : WORD_BEGIN;
  bool condition =
    scan->context == CONDITION_BEGIN || scan->context == CONDITION_GROUP_OPEN;
  if (
    valid[word_begin] &&
    !valid[NAME] &&
    (!(c == '}' ? closing_brace_start(in) : word_boundary(in, WORD_BEGIN)) ||
      scan->process ||
      scan->numeric_range ||
      (scan->pattern_parenthesis &&
        (!valid[LEFT_PAREN] || s->word_only) &&
        !valid[CONDITION_GROUP_OPEN])) &&
    !(valid[IO_NUMBER] && digit(c) && has_descriptor(in)) &&
    !(c == '{' &&
      ((valid[HEADER_BRACE_OPEN] && boundary(logical_peek(in))) ||
        (valid[LEFT_BRACE] && !s->word_only))) &&
    c != '#' &&
    !(condition && condition_close_start(in)) &&
    c != SOURCE_BACKQUOTE_BOUNDARY
  )
    return word_begin;
  if (valid[FUNCTION_OPEN] && c == '(' && logical_peek(in) == ')') {
    advance(in);
    return FUNCTION_OPEN;
  }
  return TOKEN_COUNT;
}

static bool pattern_range_character(const struct Scan *scan) {
  return scan->in->result == SOURCE_CHARACTER &&
    current(scan->in) != ']' &&
    !class_start(scan->in) &&
    !source_part_start(scan) &&
    !logical_backquote_end(scan->in);
}

static bool pattern_range_start(const struct Scan *scan) {
  struct LogicalLexer *in = scan->in;
  if (
    !pattern_range_character(scan) &&
    !(current(in) == ']' && scan->top->initial)
  )
    return false;
  struct LogicalPosition saved = logical_position(in);
  advance(in);
  bool result = current(in) == '-';
  if (result) {
    advance(in);
    result = pattern_range_character(scan);
  }
  logical_restore_position(in, &saved);
  return result;
}

static enum Token scan_bracket(struct Scan *scan) {
  struct LogicalLexer *in = scan->in;
  const bool *valid = scan->valid;
  struct Context *top = scan->top;
  int32_t c = scan->c;
  if (scan->context == PATTERN_BRACKET_OPEN) {
    if (valid[PATTERN_NEGATION] && top->initial && (c == '!' || c == '^')) {
      advance(in);
      return PATTERN_NEGATION;
    }
    if (valid[PATTERN_BRACKET_CLOSE] && !top->initial && c == ']') {
      advance(in);
      return PATTERN_BRACKET_CLOSE;
    }
    if (valid[PATTERN_RANGE_END] && pattern_range_character(scan)) {
      advance(in);
      return PATTERN_RANGE_END;
    }
    if (valid[PATTERN_RANGE_START] && pattern_range_start(scan)) {
      advance(in);
      return PATTERN_RANGE_START;
    }
    if (
      valid[PATTERN_RANGE_OPERATOR] &&
      !top->initial &&
      c == '-' &&
      logical_peek(in) != ']'
    ) {
      advance(in);
      return PATTERN_RANGE_OPERATOR;
    }
    if (valid[PATTERN_CLASS_OPEN] && class_start(in)) {
      advance(in);
      scan->s->argument_delimiter = current(in);
      advance(in);
      return PATTERN_CLASS_OPEN;
    }
  }
  if (
    scan->context == PATTERN_CLASS_OPEN &&
    valid[PATTERN_CLASS_CLOSE] &&
    c == top->delimiter &&
    logical_peek(in) == ']'
  ) {
    advance(in);
    advance(in);
    return PATTERN_CLASS_CLOSE;
  }
  return TOKEN_COUNT;
}

static enum Token scan_tilde(struct Scan *scan) {
  struct Scanner *s = scan->s;
  struct LogicalLexer *in = scan->in;
  const bool *valid = scan->valid;
  struct Context *top = scan->top;
  enum Token context = scan->context;
  int32_t c = scan->c;
  if (scan->quoting || !top) return TOKEN_COUNT;
  bool colon = assignment_context(context) && top->delimiter == ':';
  if (!top->word_start && !colon) return TOKEN_COUNT;
  bool tilde = (valid[TILDE_SOURCE] || valid[DYNAMIC_TILDE_SOURCE]) && c == '~';
  bool equals = valid[EQUALS_SOURCE] && c == '=' && !scan->process;
  if (!tilde && !equals) return TOKEN_COUNT;
  advance(in);
  if (tilde && current(in) == '[') {
    if (
      valid[DYNAMIC_TILDE_SOURCE] &&
      subscript_boundary(in, true, true, SOURCE_UNQUOTED, s)
    )
      return DYNAMIC_TILDE_SOURCE;
    return TILDE_SOURCE;
  }
  bool alternation =
    context == PATTERN_GROUP_OPEN || context == CASE_PATTERN_BEGIN;
  bool brace = context == BRACE_EXPANSION_OPEN;
  while (in->result == SOURCE_CHARACTER) {
    int32_t d = current(in);
    if (
      word_source_end(in, scan->owner, scan->grouped) ||
      (tilde && d == '/') ||
      in_set(d, "*?^#~{[") ||
      (alternation && d == '|') ||
      d == '(' ||
      (d == '<' && valid[NUMERIC_RANGE_OPEN] && numeric_range_start(in)) ||
      (brace &&
        (d == '}' || d == ',' || (d == '.' && logical_peek(in) == '.'))) ||
      brace_source_token(scan) != TOKEN_COUNT ||
      (d == ':' && (tilde || assignment_context(context))) ||
      quoted_part_start(d) ||
      expansion_start(in)
    )
      break;
    advance(in);
  }
  return tilde ? TILDE_SOURCE : EQUALS_SOURCE;
}

static enum Token scan_pattern(struct Scan *scan) {
  if (!pattern_syntax(scan->s)) return TOKEN_COUNT;
  struct Scanner *s = scan->s;
  struct LogicalLexer *in = scan->in;
  const bool *valid = scan->valid;
  enum Token context = scan->context;
  int32_t c = scan->c;
  if (
    valid[CASE_PATTERN_OPEN] && c == '(' && case_pattern_prefix(in, scan->owner)
  ) {
    advance(in);
    return CASE_PATTERN_OPEN;
  }
  if (valid[CASE_PATTERN_CLOSE] && c == ')') {
    advance(in);
    return CASE_PATTERN_CLOSE;
  }
  if (valid[PATTERN_STAR] && c == '*') {
    advance(in);
    return PATTERN_STAR;
  }
  if (valid[PATTERN_QUESTION] && c == '?') {
    advance(in);
    return PATTERN_QUESTION;
  }
  if (
    valid[PATTERN_BRACKET_OPEN] &&
    !scan->subscript_start &&
    c == '[' &&
    pattern_bracket_start(in, scan->owner, scan->grouped)
  ) {
    advance(in);
    return PATTERN_BRACKET_OPEN;
  }
  if (valid[NUMERIC_RANGE_OPEN] && scan->numeric_range) {
    advance(in);
    return NUMERIC_RANGE_OPEN;
  }
  if (context == NUMERIC_RANGE_OPEN) {
    if (valid[PATTERN_NUMBER] && digit(c)) {
      do {
        advance(in);
      } while (digit(current(in)));
      return PATTERN_NUMBER;
    }
    if (valid[PATTERN_RANGE_OPERATOR] && c == '-') {
      advance(in);
      return PATTERN_RANGE_OPERATOR;
    }
  }
  bool extended = extended_glob(s);
  if (extended) {
    enum Token pattern_token = c == '^' ? PATTERN_NEGATION_OPERATOR
      : c == '~'                        ? PATTERN_EXCLUSION_OPERATOR
      : c == '#'                        ? PATTERN_REPETITION
                                        : TOKEN_COUNT;
    if (pattern_token != TOKEN_COUNT && !valid[pattern_token])
      pattern_token = PATTERN_OPERATOR_SOURCE;
    if (pattern_token != TOKEN_COUNT && valid[pattern_token]) {
      advance(in);
      if (c == '#' && current(in) == '#') advance(in);
      if (c == '^') scan->top->pattern_negated = true;
      if (c == '~') scan->top->pattern_excluded = true;
      return pattern_token;
    }
    if (
      valid[PATTERN_PATH_SEPARATOR] &&
      c == '/' &&
      scan->top->pattern_negated &&
      pattern_path_context(s)
    ) {
      advance(in);
      scan->top->pattern_negated = false;
      return PATTERN_PATH_SEPARATOR;
    }
    if (
      valid[PATTERN_REPEAT_CHARACTER] &&
      logical_peek(in) == '#' &&
      !word_source_end(in, scan->owner, scan->grouped) &&
      !source_part_start(scan) &&
      !in_set(c, "*?^~#()[]") &&
      (c != '/' || !pattern_path_context(s))
    ) {
      advance(in);
      return PATTERN_REPEAT_CHARACTER;
    }
  }
  if (c == '(' && !valid[ARRAY_OPEN]) {
    bool bracket =
      context == PATTERN_BRACKET_OPEN || context == PATTERN_CLASS_OPEN;
    bool nested = context == PATTERN_FLAGS_OPEN ||
      context == GLOB_QUALIFIER_OPEN ||
      context == GLOB_ARGUMENT_BEGIN;
    bool flags = extended &&
      logical_peek(in) == '#' &&
      !(scan->owner &&
        modifier_context(scan->owner->opener) &&
        scan->owner->delimiter == '#');
    bool qualifier = false;
    if (flags) {
      struct LogicalPosition saved = logical_position(in);
      advance(in);
      advance(in);
      qualifier = current(in) == 'q';
      logical_restore_position(in, &saved);
    }
    enum Token opener = bracket ? PATTERN_GROUP_OPEN
      : flags  ? (qualifier ? GLOB_QUALIFIER_OPEN : PATTERN_FLAGS_OPEN)
      : nested ? PATTERN_FLAGS_OPEN
      : filename_pattern(s) &&
        context != PATTERN_GROUP_OPEN &&
        bare_qualifier_start(in, scan->owner, extended)
      ? GLOB_QUALIFIER_OPEN
      : PATTERN_GROUP_OPEN;
    if (valid[opener]) {
      advance(in);
      return opener;
    }
  }
  if (valid[PATTERN_ALTERNATION] && c == '|') {
    advance(in);
    return PATTERN_ALTERNATION;
  }
  if (
    valid[BRACE_EXPANSION_OPEN] &&
    !scan->quoting &&
    brace_expansion_start(in, scan->owner, scan->grouped)
  ) {
    advance(in);
    return BRACE_EXPANSION_OPEN;
  }
  enum Token separator = brace_separator_token(scan);
  if (context == BRACE_EXPANSION_OPEN && separator != TOKEN_COUNT) {
    advance(in);
    if (c == '.') advance(in);
    return separator;
  }
  return TOKEN_COUNT;
}

static const struct {
  enum Token token;
  int32_t value;
} punctuation[] = {
  {PATTERN_GROUP_CLOSE, ')'},
  {PATTERN_FLAGS_CLOSE, ')'},
  {GLOB_QUALIFIER_CLOSE, ')'},
  {NUMERIC_RANGE_CLOSE, '>'},
  {BRACE_EXPANSION_CLOSE, '}'},
  {CONDITION_OPEN, '['},
  {CONDITION_CLOSE_FIRST, ']'},
  {CONDITION_CLOSE, ']'},
  {CONDITION_GROUP_OPEN, '('},
  {CONDITION_GROUP_CLOSE, ')'},
  {ARITHMETIC_OPEN, '('},
  {ARITHMETIC_CLOSE_FIRST, ')'},
  {ARITHMETIC_CLOSE, ')'},
  {ARITHMETIC_SQUARE_OPEN, '['},
  {ARITHMETIC_SQUARE_CLOSE, ']'},
  {ARITHMETIC_GROUP_OPEN, '('},
  {ARITHMETIC_GROUP_CLOSE, ')'},
  {ARITHMETIC_FUNCTION_OPEN, '('},
  {ARITHMETIC_FUNCTION_CLOSE, ')'},
  {PARAMETER_FLAGS_OPEN, '('},
  {PARAMETER_FLAGS_CLOSE, ')'},
  {SUBSCRIPT_FLAGS_OPEN, '('},
  {ARRAY_KEY_GROUP_OPEN, '('},
  {ARRAY_KEY_GROUP_CLOSE, ')'},
  {ARRAY_KEY_OPEN, '['},
  {ARRAY_KEY_CLOSE, ']'},
  {SUBSCRIPT_FLAGS_CLOSE, ')'},
  {SUBSCRIPT_PAREN_OPEN, '('},
  {SUBSCRIPT_PAREN_CLOSE, ')'},
  {SUBSCRIPT_BRACKET_OPEN, '['},
  {SUBSCRIPT_BRACKET_CLOSE, ']'},
  {SUBSCRIPT_BRACE_OPEN, '{'},
  {SUBSCRIPT_BRACE_CLOSE, '}'},
  {PARAMETER_OPEN, '{'},
  {PARAMETER_CLOSE, '}'},
  {ARRAY_OPEN, '('},
  {ARRAY_CLOSE, ')'},
  {SUBSCRIPT_OPEN, '['},
  {UNBRACED_SUBSCRIPT_OPEN, '['},
  {SUBSCRIPT_PREFIX_OPEN, '['},
  {SUBSCRIPT_CLOSE, ']'},
  {DOLLAR_SQ_QUOTE, '\''},
  {SQ_CLOSE, '\''},
  {DQ_CLOSE, '"'},
  {DOLLAR_SQ_CLOSE, '\''},
  {COMMAND_CLOSE, ')'},
  {SQ_OPEN, '\''},
  {DQ_OPEN, '"'},
  {BACKQUOTE_OPEN, '`'},
  {COMMAND_OPEN, '('},
  {LEFT_PAREN, '('},
  {RIGHT_PAREN, ')'},
  {HEADER_BRACE_OPEN, '{'},
  {LEFT_BRACE, '{'},
  {RIGHT_BRACE, '}'},
  {SEMICOLON, ';'},
};

static bool subscript_flags_start(struct LogicalLexer *in) {
  struct LogicalPosition saved = logical_position(in);
  advance(in);
  bool found = false;
  while (in->result == SOURCE_CHARACTER) {
    int32_t c = current(in);
    if (c == ')') {
      found = true;
      break;
    }
    if (in_set(c, "(}]")) break;
    advance(in);
    if (!in_set(c, "snb")) continue;
    int32_t delimiter = current(in);
    int32_t closer = closing_delimiter(delimiter);
    advance(in);
    while (in->result == SOURCE_CHARACTER && current(in) != closer) advance(in);
    advance(in);
  }
  logical_restore_position(in, &saved);
  return found;
}

static bool punctuation_allowed(const struct Scan *scan, enum Token token) {
  struct LogicalLexer *in = scan->in;
  enum SourceQuoting quoting = scan->quoting;
  switch (token) {
    case PARAMETER_CLOSE:
      return !group_source_owner(scan->s, BRACE_EXPANSION_OPEN);
    case RIGHT_BRACE:
      return closing_brace_start(in);
    case SUBSCRIPT_OPEN:
    case UNBRACED_SUBSCRIPT_OPEN:
      return scan->subscript_start;
    case SUBSCRIPT_PREFIX_OPEN:
      return scan->subscript_prefix;
    case SUBSCRIPT_BRACKET_OPEN:
      return subscript_context(scan->context) && !scan->subscript_start;
    case SUBSCRIPT_BRACE_OPEN:
    case SUBSCRIPT_PAREN_OPEN:
      return subscript_context(scan->context);
    case SUBSCRIPT_PAREN_CLOSE:
      return scan->context == SUBSCRIPT_PAREN_OPEN;
    case ARRAY_KEY_GROUP_OPEN:
      return !subscript_context(scan->context) &&
        !arithmetic_context(scan->context);
    case ARRAY_KEY_GROUP_CLOSE:
      return scan->context == ARRAY_KEY_GROUP_OPEN;
    case ARITHMETIC_GROUP_OPEN:
    case ARITHMETIC_FUNCTION_OPEN:
      return arithmetic_context(scan->context);
    case ARITHMETIC_GROUP_CLOSE:
      return scan->context == ARITHMETIC_GROUP_OPEN;
    case ARITHMETIC_FUNCTION_CLOSE:
      return scan->context == ARITHMETIC_FUNCTION_OPEN;
    case SQ_OPEN:
      return !quoting || scan->context == DQ_OPEN;
    case DQ_OPEN:
      return !quoting ||
        scan->context == DQ_OPEN ||
        quoting == SOURCE_PARAMETER_QUOTED;
    case LEFT_BRACE:
    case LEFT_PAREN:
      return !scan->s->word_only;
    case ARITHMETIC_CLOSE_FIRST:
      return logical_peek(in) == ')';
    case ARITHMETIC_SQUARE_CLOSE:
      return !scan->top->brackets;
    case CONDITION_CLOSE_FIRST:
      return condition_close_start(in);
    case CONDITION_CLOSE:
      return scan->top && scan->top->delimiter == ']';
    case SUBSCRIPT_FLAGS_OPEN:
      return scan->context == SUBSCRIPT_OPEN &&
        scan->top->initial &&
        subscript_flags_start(in);
    default:
      return true;
  }
}

static enum Token scan_punctuation(struct Scan *scan) {
  struct LogicalLexer *in = scan->in;
  const bool *valid = scan->valid;
  int32_t c = scan->c;
  if (valid[BACKQUOTE_CLOSE] && logical_backquote_end(in)) {
    advance(in);
    return BACKQUOTE_CLOSE;
  }
  for (size_t i = 0; i < sizeof(punctuation) / sizeof(*punctuation); ++i) {
    enum Token token = punctuation[i].token;
    if (
      valid[token] &&
      c == punctuation[i].value &&
      punctuation_allowed(scan, token)
    ) {
      advance(in);
      return token;
    }
  }
  if (valid[SUBSCRIPT_COMMA] && c == ',') {
    advance(in);
    return SUBSCRIPT_COMMA;
  }
  if (
    !scan->in_word &&
    !scan->quoted &&
    !scan->in_body &&
    !arithmetic_context(scan->context) &&
    (c == '&' || c == '|')
  ) {
    enum Token token = read_control_operator(in);
    if (token != TOKEN_COUNT && valid[token]) return token;
    return reject(scan);
  }
  return TOKEN_COUNT;
}

static enum Token scan_expansion(struct Scan *scan) {
  struct LogicalLexer *in = scan->in;
  const bool *valid = scan->valid;
  int32_t c = scan->c;
  int32_t next = logical_peek(in);
  if (
    expansion_start(in) &&
    (!scan->special_parameter || next == '{' || next == '(') &&
    (!scan->quoting || next != '\'')
  ) {
    struct LogicalPosition saved = logical_position(in);
    advance(in);
    bool arithmetic_expansion = next == '[' || arithmetic_start(in, NULL);
    logical_restore_position(in, &saved);
    enum Token token = next == '\'' ? DOLLAR_SQ_OPEN
      : arithmetic_expansion        ? ARITHMETIC_DOLLAR
      : next == '('                 ? DOLLAR
                                    : PARAMETER_DOLLAR;
    if (valid[token]) {
      advance(in);
      return token;
    }
  }
  if (scan->process) {
    enum Token token = c == '<' ? PROCESS_IN
      : c == '>'                ? PROCESS_OUT
                                : PROCESS_FILE;
    if (valid[token]) {
      advance(in);
      return token;
    }
  }
  if (valid[VARIABLE_NAME] && name_start(c)) {
    do {
      advance(in);
    } while (name_character(current(in)));
    return VARIABLE_NAME;
  }
  if (valid[POSITIONAL_PARAMETER] && digit(c)) {
    do {
      advance(in);
    } while (digit(current(in)));
    return POSITIONAL_PARAMETER;
  }
  if (scan->special_parameter) {
    advance(in);
    return SPECIAL_PARAMETER;
  }
  if (c == '\\' && (!valid[DOUBLE_QUOTE_TEXT] || double_quote_escape(next))) {
    enum Token token = valid[DOUBLE_QUOTE_ESCAPE] ? DOUBLE_QUOTE_ESCAPE
      : valid[DOLLAR_SINGLE_QUOTE_ESCAPE]         ? DOLLAR_SINGLE_QUOTE_ESCAPE
                                                  : ESCAPED_CHARACTER;
    if (valid[token]) {
      if (token == DOLLAR_SINGLE_QUOTE_ESCAPE) {
        struct DollarEscape escape;
        if (dollar_escape(in, &escape)) return token;
        return reject(scan);
      }
      advance(in);
      if (
        token == ESCAPED_CHARACTER &&
        (in->result == SOURCE_END || logical_backquote_end(in))
      )
        return token;
      if (in->result != SOURCE_CHARACTER) return reject(scan);
      advance(in);
      return token;
    }
  }
  if (
    !scan->quoted &&
    !scan->in_word &&
    (valid[COMMENT_TEXT] || valid[TRAILING_COMMENT_TEXT]) &&
    c == '#'
  ) {
    enum Token token = comment_kind(in);
    if (token == TOKEN_COUNT) return reject(scan);
    if (!valid[token]) return TOKEN_COUNT;
    return read_comment(in) ? token : reject(scan);
  }
  if (
    valid[HERE_DOCUMENT_ESCAPE] && c == '\\' && here_escape(scan->doc, next)
  ) {
    advance(in);
    advance(in);
    return HERE_DOCUMENT_ESCAPE;
  }
  return TOKEN_COUNT;
}

static enum Token text_kind(const struct Scan *scan) {
  const bool *valid = scan->valid;
  if (key_context(scan->context) && valid[ARRAY_KEY_TEXT])
    return ARRAY_KEY_TEXT;
  if (subscript_context(scan->context) && valid[SUBSCRIPT_TEXT])
    return subscript_pattern(scan->s) && valid[LITERAL] ? LITERAL
                                                        : SUBSCRIPT_TEXT;
  bool quoted_body = scan->in_body && scan->doc->quoted;
  return valid[PATTERN_BRACKET_TEXT]               ? PATTERN_BRACKET_TEXT
    : valid[GLOB_ARGUMENT_TEXT]                    ? GLOB_ARGUMENT_TEXT
    : valid[PATTERN_CLASS_TEXT]                    ? PATTERN_CLASS_TEXT
    : valid[GLOB_TEXT]                             ? GLOB_TEXT
    : valid[FLAG_ARGUMENT_TEXT]                    ? FLAG_ARGUMENT_TEXT
    : valid[ERE_FRAGMENT_BEGIN]                    ? ERE_FRAGMENT_BEGIN
    : valid[ARITHMETIC_SOURCE_FRAGMENT]            ? ARITHMETIC_SOURCE_FRAGMENT
    : subscript_pattern(scan->s) && valid[LITERAL] ? LITERAL
    : valid[SUBSCRIPT_TEXT]                        ? SUBSCRIPT_TEXT
    : valid[ARRAY_KEY_TEXT]                        ? ARRAY_KEY_TEXT
    : quoted_body && valid[QUOTED_HERE_DOCUMENT_TEXT]
    ? QUOTED_HERE_DOCUMENT_TEXT
    : scan->in_body && valid[HERE_DOCUMENT_TEXT] ? HERE_DOCUMENT_TEXT
    : valid[SINGLE_QUOTE_CONTENT]                ? SINGLE_QUOTE_CONTENT
    : valid[DOUBLE_QUOTE_TEXT]                   ? DOUBLE_QUOTE_TEXT
    : valid[DOLLAR_SINGLE_QUOTE_TEXT]            ? DOLLAR_SINGLE_QUOTE_TEXT
                                                 : LITERAL;
}

static bool literal_end(const struct Scan *scan, size_t start) {
  const struct Scanner *s = scan->s;
  struct LogicalLexer *in = scan->in;
  const bool *valid = scan->valid;
  const struct Context *top = scan->top;
  enum Token context = scan->context;
  enum SourceQuoting quoting = scan->quoting;
  int32_t c = current(in);
  if (c == ')' && !quoting && group_source_owner(scan->s, PATTERN_GROUP_OPEN))
    return true;
  bool pattern = pattern_context(context) || context == CASE_PATTERN_BEGIN;
  bool alternation =
    context == PATTERN_GROUP_OPEN || context == CASE_PATTERN_BEGIN;
  bool brace = context == BRACE_EXPANSION_OPEN;
  bool braced = context == PARAMETER_OPEN ||
    context == PARAMETER_REPLACEMENT_OPERATOR ||
    context == PARAMETER_SUBSTRING_OPERATOR ||
    (modifier_context(context) && top->initial);
  bool subscript = scan->owner && subscript_context(scan->owner->opener);
  bool end = subscript ? in_set(c, "[](){") ||
      (c == '}' && enclosing_source_end(s, in, s->count, false)) ||
      (subscript_context(context) && c == ',') ||
      (alternation && c == '|')
    : braced                          ? c == '}'
    : quoting == SOURCE_DOUBLE_QUOTED ? c == '"'
    : quoting == SOURCE_HERE_DOCUMENT ? c == '\n'
    : context == UNBRACED_MODIFIER_BEGIN || context == GLOB_MODIFIER_BEGIN
    ? enclosing_source_end(s, in, s->count - 1, scan->grouped)
    : pattern ? (c == '(' ||
                  c == ')' ||
                  (alternation && c == '|') ||
                  (brace && c == '}') ||
                  enclosing_source_end(s, in, s->count, scan->grouped))
              : word_source_end(in, scan->owner, scan->grouped);
  if (end) return true;
  if (
    pattern_syntax(s) &&
    (c == '*' ||
      (c == '(' &&
        (valid[PATTERN_GROUP_OPEN] ||
          valid[PATTERN_FLAGS_OPEN] ||
          valid[GLOB_QUALIFIER_OPEN])) ||
      (c == '<' && valid[NUMERIC_RANGE_OPEN] && numeric_range_start(in)) ||
      c == '?' ||
      (extended_glob(s) &&
        (c == '^' ||
          c == '~' ||
          c == '#' ||
          (c == '/' && top->pattern_negated && pattern_path_context(s)) ||
          (logical_peek(in) == '#' && in->consumed > start))) ||
      (!quoting && brace_expansion_start(in, scan->owner, scan->grouped)) ||
      (c == '[' && pattern_bracket_start(in, scan->owner, scan->grouped)) ||
      (brace && (c == ',' || (c == '.' && logical_peek(in) == '.'))))
  )
    return true;
  if (
    (context == PARAMETER_REPLACEMENT_OPERATOR &&
      top->arguments == 0 &&
      c == '/') ||
    (context == PARAMETER_SUBSTRING_OPERATOR && c == ':') ||
    (modifier_context(context) && c == top->delimiter) ||
    quote_start(quoting, c) ||
    c == '\\' ||
    c == '`' ||
    quoted_expansion_start(in, quoting)
  )
    return true;
  return in->consumed > start &&
    assignment_context(context) &&
    top->delimiter == ':' &&
    c == '=';
}

static enum Token scan_text(struct Scan *scan) {
  struct Scanner *s = scan->s;
  struct LogicalLexer *in = scan->in;
  const bool *valid = scan->valid;
  struct Context *top = scan->top;
  enum Token context = scan->context;
  enum SourceQuoting quoting = scan->quoting;
  enum Token text = text_kind(scan);
  if (!valid[text]) return reject(scan);
  struct Context *square =
    text == ARITHMETIC_SOURCE_FRAGMENT ? arithmetic_owner(s) : NULL;
  if (square && square->opener != ARITHMETIC_SQUARE_OPEN) square = NULL;
  if (text == GLOB_TEXT) {
    top->delimiter = 0;
    top->arguments = 0;
  }
  size_t start = in->consumed;
  bool glob = context == GLOB_ARGUMENT_BEGIN;
  enum GlobArgument glob_kind =
    glob ? (enum GlobArgument)top->arguments : GLOB_NO_ARGUMENT;
  bool glob_initial = glob && top->initial;
  bool ranged = text == ARRAY_KEY_TEXT ||
    text == GLOB_TEXT ||
    text == GLOB_ARGUMENT_TEXT ||
    text == ERE_FRAGMENT_BEGIN;
  while (in->result == SOURCE_CHARACTER && !logical_backquote_end(in)) {
    int32_t c = current(in);
    if (brace_source_token(scan) != TOKEN_COUNT) break;
    if (ranged && c == '<' && numeric_range_start(in)) {
      skip_numeric_range(in);
      continue;
    }
    bool end = false;
    switch (text) {
      case GLOB_ARGUMENT_TEXT:
        end = source_part_start(scan) ||
          enclosing_source_end(s, in, s->count, true) ||
          (!top->delimiter &&
            !glob_argument_character(glob_kind, c, glob_initial));
        if (!end && !top->delimiter) {
          if (digit(c) || c == '+' || c == '-' || c == '=')
            glob_initial = false;
          else if (glob_kind == GLOB_TIME || glob_kind == GLOB_SIZE)
            glob_kind = GLOB_INTEGER;
          else glob_initial = false;
        }
        break;
      case PATTERN_BRACKET_TEXT:
        end = (c == ']' && (!top->initial || in->consumed > start)) ||
          (c == '-' &&
            (!top->initial || in->consumed > start) &&
            logical_peek(in) != ']') ||
          class_start(in) ||
          source_part_start(scan) ||
          (valid[PATTERN_RANGE_START] && pattern_range_start(scan));
        break;
      case GLOB_TEXT:
        end = c == ')' ||
          source_part_start(scan) ||
          (enclosing_source_end(s, in, s->count, true) && c != '(' && c != ')');
        break;
      case PATTERN_CLASS_TEXT:
        end = (c == top->delimiter && logical_peek(in) == ']') ||
          source_part_start(scan);
        break;
      case ERE_FRAGMENT_BEGIN:
        end = expansion_start(in) ||
          quoted_part_start(c) ||
          ((c != '=' || in->consumed == start) && process_start(s, in)) ||
          regex_boundary(s, in, top) ||
          regex_empty_parentheses(in);
        if (!end) {
          if (c == '(') top->arguments++;
          else if (c == ')' && top->arguments) top->arguments--;
          else if (c == '{') top->braces++;
          else if (c == '}' && top->braces) top->braces--;
        }
        break;
      case ARITHMETIC_SOURCE_FRAGMENT:
        end = horizontal(c) ||
          c == '\n' ||
          name_character(c) ||
          (expansion_start(in) && !dollar_quote_start(in)) ||
          c == '(' ||
          c == ')' ||
          (c == '[' && (scan->subscript_start || in->consumed > start)) ||
          (c == ']' &&
            (square ? !square->brackets : valid[ARITHMETIC_SQUARE_CLOSE])) ||
          (c == ';' && valid[SEMICOLON]) ||
          c == '\\' ||
          c == '`' ||
          in_set(c, "+-!~&^|*/%<>?:=,#");
        if (!end && square) {
          if (c == '[') square->brackets++;
          else if (c == ']' && square->brackets) square->brackets--;
        }
        break;
      case FLAG_ARGUMENT_TEXT:
        end = c == top->delimiter ||
          ((quoting == SOURCE_UNQUOTED || quoting == SOURCE_PARAMETER_QUOTED) &&
            c == '}' &&
            !top->braces) ||
          (context == FLAG_ARGUMENT_OPEN &&
            valid[FLAG_ARGUMENT_END] &&
            flag_argument_boundary(s, in, top, quoting)) ||
          quoted_expansion_start(in, quoting) ||
          c == '\\' ||
          quote_start(quoting, c) ||
          c == '`';
        if (!end && !quoting) {
          if (c == '{') top->braces++;
          else if (c == '}' && top->braces) top->braces--;
        }
        break;
      case ARRAY_KEY_TEXT:
        end = c == '(' ||
          c == ')' ||
          enclosing_source_end(s, in, s->count, false) ||
          expansion_start(in) ||
          quoted_part_start(c);
        if (arithmetic_key_context(s))
          end = end ||
            name_character(c) ||
            (c == '.' && digit(logical_peek(in))) ||
            in_set(c, "+-!~&^|*/%<>?:=,#");
        break;
      case SUBSCRIPT_TEXT:
        end = (!(subscript_flags(s) & SUBSCRIPT_MATCH) &&
                (name_character(c) ||
                  (c == '.' && digit(logical_peek(in))) ||
                  in_set(c, "+-!~&^|*/%<>?:=,#@"))) ||
          c == '[' ||
          c == ']' ||
          c == '(' ||
          c == ')' ||
          c == '{' ||
          (c == '}' && enclosing_source_end(s, in, s->count, false)) ||
          c == ',' ||
          quoted_expansion_start(in, quoting) ||
          c == '\\' ||
          quote_start(quoting, c) ||
          c == '`';
        break;
      case HERE_DOCUMENT_TEXT:
        end = (expansion_start(in) && !dollar_quote_start(in)) ||
          c == '`' ||
          (c == '\\' && here_escape(scan->doc, logical_peek(in)));
        break;
      case SINGLE_QUOTE_CONTENT:
        end = c == '\'';
        break;
      case DOUBLE_QUOTE_TEXT:
        end = c == '"' ||
          (c == '\\' && double_quote_escape(logical_peek(in))) ||
          (expansion_start(in) && !dollar_quote_start(in)) ||
          c == '`';
        break;
      case DOLLAR_SINGLE_QUOTE_TEXT:
        end = c == '\'' || c == '\\';
        break;
      case LITERAL:
        end = literal_end(scan, start);
        if (
          !end &&
          top &&
          (word_context(context) ||
            assignment_context(context) ||
            context == PARAMETER_OPEN)
        )
          top->delimiter = c;
        break;
      default:
        break;
    }
    if (end) break;
    advance(in);
  }
  return in->consumed > start ? text : TOKEN_COUNT;
}

static enum Token
classify(struct Scanner *s, struct LogicalLexer *in, const bool *valid) {
  static enum Token (*const families[])(struct Scan *) = {
    scan_brace_source,
    scan_structure,
    scan_word_end,
    scan_here_body,
    scan_source_end,
    scan_parameter_source,
    scan_glob_argument,
    scan_glob_qualifier,
    scan_parameter_flags,
    scan_flag_argument,
    scan_modifier,
    scan_parenthesis_source,
    scan_layout,
    scan_redirect,
    scan_precommand,
    scan_command_word,
    scan_parameter_operator,
    scan_arithmetic,
    scan_regex,
    scan_condition,
    scan_word_start,
    scan_bracket,
    scan_tilde,
    scan_pattern,
    scan_punctuation,
    scan_expansion,
  };
  struct Scan scan = {.s = s, .in = in, .valid = valid, .c = current(in)};
  struct LogicalPosition start = logical_position(in);
  enum Token token = scan_documents(&scan);
  if (token != TOKEN_COUNT || scan.rejected) return token;
  scan_prepare(&scan);
  for (size_t i = 0; i < sizeof(families) / sizeof(*families); ++i) {
    token = families[i](&scan);
    if (token != TOKEN_COUNT || scan.rejected) break;
  }
  if (token == TOKEN_COUNT && !scan.rejected) token = scan_text(&scan);
  if (token == TOKEN_COUNT && valid[LOGICAL_LAYOUT_END]) {
    logical_restore_position(in, &start);
    token = LOGICAL_LAYOUT_END;
  }
  if (token == TOKEN_COUNT && valid[HEADER_SEPARATOR_END]) {
    logical_restore_position(in, &start);
    token = HEADER_SEPARATOR_END;
  }
  if (token == TOKEN_COUNT && valid[TIME_END] && scan.context == TIME_KEYWORD) {
    logical_restore_position(in, &start);
    token = TIME_END;
  }
  if (token == TOKEN_COUNT && valid[FUNCTION_ARGUMENTS_END]) {
    logical_restore_position(in, &start);
    if (
      scan.c == '#' ||
      (!s->word_only && scan.c == '{') ||
      (!horizontal(scan.c) && word_boundary(in, WORD_BEGIN) && !scan.continues)
    )
      token = FUNCTION_ARGUMENTS_END;
  }
  if (token == TOKEN_COUNT && valid[CLOSED_BODY_END]) {
    logical_restore_position(in, &start);
    token = CLOSED_BODY_END;
  }
  if (token == TOKEN_COUNT && valid[SHORT_IF_END]) {
    logical_restore_position(in, &start);
    if (s->word_only || control_keyword(in) != ELSE_KEYWORD)
      token = SHORT_IF_END;
  }
  if (token == TOKEN_COUNT && valid[FUNCTION_BODY_END]) {
    logical_restore_position(in, &start);
    token = FUNCTION_BODY_END;
  }
  if (token == TOKEN_COUNT && valid[SHORT_CONDITION_END]) {
    logical_restore_position(in, &start);
    if (!s->word_only || scan.c != '{' || !boundary(logical_peek(in)))
      token = SHORT_CONDITION_END;
  }
  if (token != TOKEN_COUNT && s->parameter_count && !scan.raw_scanned) {
    size_t end = in->consumed;
    logical_restore_position(in, &start);
    while (in->result == SOURCE_CHARACTER && in->consumed < end) {
      if (!parameter_source_character(s, in, token)) return TOKEN_COUNT;
      advance(in);
    }
  }
  return token;
}

static void *zsh_scanner_create(void) {
  return ts_calloc(1, sizeof(struct Scanner));
}
static void zsh_scanner_destroy(void *payload) {
  if (payload) {
    clear(payload);
    ts_free(payload);
  }
}
static unsigned zsh_scanner_serialize(void *payload, char *buffer) {
  size_t length;
  return payload && encode(payload, (uint8_t *)buffer, &length)
    ? (unsigned)length
    : 0;
}
static void
zsh_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
  struct Scanner *s = payload;
  if (!s) return;
  clear(s);
  if (length && !decode(s, (const uint8_t *)buffer, length)) {
    clear(s);
    s->failed = true;
  }
}

static void select_recovery_symbols(const struct Scanner *s, bool *valid) {
  static const bool source_symbols[TOKEN_COUNT] = {
    [CHARACTER_STAR] = true,
    [CHARACTER_PLUS] = true,
    [CHARACTER_QUESTION] = true,
    [CHARACTER_CARET] = true,
    [CHARACTER_COMMA] = true,
    [CHARACTER_DOT] = true,
    [CHARACTER_COLON] = true,
    [CHARACTER_HYPHEN] = true,
    [PIECE] = true,
    [CHARACTER_SINGLE_QUOTE] = true,
    [CHARACTER_DOUBLE_QUOTE] = true,
    [CHARACTER_DOLLAR] = true,
    [CHARACTER_LEFT_PAREN] = true,
    [CHARACTER_RIGHT_PAREN] = true,
    [CHARACTER_BACKQUOTE] = true,
    [CHARACTER_LESS] = true,
    [CHARACTER_GREATER] = true,
    [CHARACTER_EQUALS] = true,
    [CHARACTER_SEMICOLON] = true,
    [CHARACTER_AMPERSAND] = true,
    [CHARACTER_PIPE] = true,
    [CHARACTER_BANG] = true,
    [CHARACTER_LEFT_BRACE] = true,
    [CHARACTER_RIGHT_BRACE] = true,
    [CHARACTER_LEFT_BRACKET] = true,
    [CHARACTER_RIGHT_BRACKET] = true,
    [PREFIX] = true,
    [LINE_CONTINUATION] = true,
    [REMOVED_NEWLINE] = true,
    [REMOVED_SOURCE] = true,
  };
  static const enum Token command_symbols[] = {
    NEWLINE,
    SEMICOLON,
    AMPERSAND,
    PIPE,
    AND_IF,
    OR_IF,
    RIGHT_PAREN,
    RIGHT_BRACE,
    THEN_KEYWORD,
    ELIF_KEYWORD,
    ELSE_KEYWORD,
    FI_KEYWORD,
    DO_KEYWORD,
    DONE_KEYWORD,
    ESAC_KEYWORD,
    END_KEYWORD,
    ALWAYS_KEYWORD,
  };
  memcpy(valid, source_symbols, sizeof(source_symbols));
  for (size_t i = 0; i < s->document_count; ++i)
    if (s->documents[i].declaring) return;
  enum Token context =
    s->count ? s->contexts[s->count - 1].opener : TOKEN_COUNT;
  const struct Document *doc = active_document(s);
  valid[HERE_END_BEGIN] = doc != NULL;
  valid[HERE_END_FINISH] = doc && doc->ending;
  valid[DOCUMENT_FINISH] = doc != NULL;
  valid[HERE_SEQUENCE_END] = context == HERE_SEQUENCE_BEGIN;
  bool quoted =
    context == SQ_OPEN || context == DQ_OPEN || context == DOLLAR_SQ_OPEN;
  if (context == DOCUMENT_BEGIN) {
    valid[HERE_DOCUMENT_TEXT] = true;
    valid[QUOTED_HERE_DOCUMENT_TEXT] = true;
    valid[HERE_DOCUMENT_ESCAPE] = true;
    valid[HERE_DOCUMENT_END_TEXT] = true;
    valid[NEWLINE] = doc && doc->ending;
  }
  if (!word_part_context(context) && !quoted && context != DOCUMENT_BEGIN) {
    for (
      size_t i = 0; i < sizeof(command_symbols) / sizeof(*command_symbols); ++i
    )
      valid[command_symbols[i]] = true;
  }
  valid[WORD_END] = word_context(context);
  valid[ASSIGNMENT_END] = scalar_assignment_context(context);
  valid[ARRAY_ELEMENT_END] = context == ARRAY_ELEMENT_BEGIN;
  valid[COMMAND_CLOSE] = context == COMMAND_OPEN;
  valid[BACKQUOTE_CLOSE] = context == BACKQUOTE_OPEN;
  valid[SQ_CLOSE] = context == SQ_OPEN;
  valid[SINGLE_QUOTE_CONTENT] = context == SQ_OPEN;
  valid[DQ_CLOSE] = context == DQ_OPEN;
  valid[DOUBLE_QUOTE_TEXT] = context == DQ_OPEN;
  valid[DOUBLE_QUOTE_ESCAPE] = context == DQ_OPEN;
  valid[DOLLAR_SQ_CLOSE] = context == DOLLAR_SQ_OPEN;
  valid[DOLLAR_SINGLE_QUOTE_TEXT] = context == DOLLAR_SQ_OPEN;
  valid[DOLLAR_SINGLE_QUOTE_ESCAPE] = context == DOLLAR_SQ_OPEN;
  valid[PARAMETER_CLOSE] = context == PARAMETER_OPEN;
  valid[SUBSCRIPT_TEXT] = doc && subscript_context(context);
  valid[REGEX_OPEN] = context == REGEX_BEGIN;
  valid[REGEX_CLOSE] = context == REGEX_BEGIN;
  valid[REGEX_END] = context == REGEX_BEGIN;
  valid[CONDITION_CLOSE_FIRST] =
    context == CONDITION_BEGIN || context == CONDITION_GROUP_OPEN;
  valid[CONDITION_CLOSE] = valid[CONDITION_CLOSE_FIRST];
  valid[CONDITION_GROUP_CLOSE] = context == CONDITION_GROUP_OPEN;
}

static bool zsh_scanner_scan(void *payload, TSLexer *lexer, const bool *valid) {
  struct Scanner *s = payload;
  if (!s || s->failed) return false;
  bool recovery_symbols[TOKEN_COUNT];
  if (valid[RECOVERY]) {
    select_recovery_symbols(s, recovery_symbols);
    valid = recovery_symbols;
  }
  uint8_t saved[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
  size_t saved_length;
  if (!encode(s, saved, &saved_length)) return false;
  bool result = false;
  if (!init_source(s)) return false;
  if (s->remaining) result = emit(s, lexer, valid);
  else {
    lexer->mark_end(lexer);
    struct NativeInput native = {.lexer = lexer};
    struct DocumentInput documents;
    struct LogicalLexer input;
    if (document_input_init(&documents, &native, s)) {
      native.boundary = document_boundary;
      native.boundary_payload = &documents;
      if (logical_init(&input, &native, &s->source)) {
        size_t prefix = logical_raw_position(&input);
        size_t character = input.result == SOURCE_CHARACTER &&
            input.character.origin.character > 0
          ? (size_t)input.character.origin.character
          : 0;
        enum Token token;
        if (prefix && valid[REMOVED_SOURCE]) {
          input.consumed = prefix;
          token = REMOVED_SOURCE;
        } else token = classify(s, &input, valid);
        if (token < TOKEN_COUNT && valid[token]) {
          extend_lookahead(&input);
          lexer->result_symbol = token;
          if (token == TRAILING_COMMENT_TEXT) token = COMMENT_TEXT;
          s->emission = token;
          s->remaining = input.consumed;
          s->physical = physical(token);
          s->character = s->physical ? character : 0;
          result = token == COMMENT_TEXT ? push(s, token)
            : s->remaining               ? true
                                         : commit(s, token);
        }
        logical_clear(&input);
      }
    }
    document_input_clear(&documents);
    native_input_clear(&native);
  }
  uint8_t next[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
  size_t next_length;
  if (!result || !encode(s, next, &next_length)) {
    clear(s);
    if (!decode(s, saved, saved_length)) {
      clear(s);
      s->failed = true;
    }
    return false;
  }
  return true;
}
