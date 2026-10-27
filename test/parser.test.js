import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceNodes } from "./support/cst.js";
import { language } from "./support/language.js";
import { parse, valid } from "./support/parser.js";

test("exec operands retain word source and keep the following command name", () => {
  for (const { source, expected } of [
    { source: "exec -a <(:) print x\n", expected: /process_substitution/ },
    { source: "exec -a (a) print x\n", expected: /glob_qualifier/ },
    {
      source: "exec -a <1-2> print x\n",
      expected: /pattern_numeric_range_source/,
    },
    {
      source: "exec -a {fd}>/dev/null name print x\n",
      expected: /io_variable/,
    },
    {
      source: "exec <<E -a name print x\nbody\nE\n",
      expected: /here_document/,
    },
  ]) {
    const output = valid(source);
    assert.match(output, /operand: word/);
    assert.match(output, /name: word\n[^\n]+literal `print`/);
    assert.match(output, expected);
  }
});

test("descriptor spellings before patterns and process substitutions stay in words", () => {
  for (const { source, expected } of [
    { source: "print 12<1-2>\n", expected: /pattern_numeric_range_source/ },
    { source: "print 2<->\n", expected: /pattern_numeric_range_source/ },
    { source: "print {fd}<1-2>\n", expected: /pattern_numeric_range_source/ },
    { source: "print 2<(print x)\n", expected: /process_substitution/ },
    { source: "print 2>(:)\n", expected: /process_substitution/ },
    { source: "print {fd}<(print x)\n", expected: /process_substitution/ },
    { source: "print {fd}>(:)\n", expected: /process_substitution/ },
    { source: "function f 2<(:) { :; }\n", expected: /process_substitution/ },
  ]) {
    const output = valid(source);
    assert.match(output, expected);
    assert.doesNotMatch(output, /io_number|io_variable|io_file/);
  }
});

test("only a single leading digit is a redirection descriptor", () => {
  const output = valid("print 12<file 2>file\n");
  assert.match(output, /argument: word\n[^\n]+literal `12`/);
  assert.match(output, /io_number `2`/);
  assert.equal((output.match(/io_number/g) ?? []).length, 1);
});

test("a numeric redirect target ends before the next redirect operator", () => {
  const output = valid("exec -a x<12>print x\n");
  assert.match(output, /filename: word\n[^\n]+literal `12`/);
  assert.equal((output.match(/io_file/g) ?? []).length, 2);
});

test("case delimiters inside substitutions do not close surrounding arithmetic", () => {
  for (const { source, expected } of [
    {
      source: "(($(case x in x) print 1;; esac)))\n",
      expected: /arithmetic_command/,
    },
    {
      source: "print $(($(case x in x) print 1;; esac)))\n",
      expected: /arithmetic_expansion/,
    },
    {
      source: "for (($(case x in (x)) print 1;; esac);0;)) do :; done\n",
      expected: /arithmetic_for_clause/,
    },
  ]) {
    const output = valid(source);
    assert.match(output, expected);
    assert.equal((output.match(/command_substitution/g) ?? []).length, 1);
    assert.equal((output.match(/case_clause/g) ?? []).length, 1);
  }
});

for (const source of [
  "a[']']=x\n",
  'a["]"]=x\n',
  "a[\\]]=x\n",
  "a[$(print -r -- ']')]=x\n",
  "a[\"$(print -r -- ']')\"]=x\n",
  "a[$(print x # comment\\\n)]=y\n",
  "a[`print x # comment`]=y\n",
  `a[\${:-"]"}]=x\n`,
  "a[$((1+1))]=x\n",
  "a[$[1 + 0]]=x\n",
  "a[$((case + 1))]=x\n",
  'a[$(case x in x) print -r -- "]";; esac)]=x\n',
  'a[$(case x in (x)) print -r -- "]";; esac)]=x\n',
  'a[$(case x { x) print "]" })]=x\n',
  'a[$(case x in x) case y in y) print "]";; esac;; esac)]=x\n',
  'a[$(f() { case x in x) print "]";; esac; }; f)]=x\n',
  'a[$(cat <(case x in x) print "]";; esac))]=x\n',
  "a[$(cat <<E\n)]\nE\n)]=x\n",
  "a[$(case x in x) cat <<E\n)]\nE\n;; esac)]=x\n",
  "a[$(case x in x) cat <<E;; esac\n)]\nE\n)]=x\n",
  "a[$(cat <<A <<B\n)]\nA\n)]\nB\n)]=x\n",
  "a[$(cat <<-E\n\t)]\n\tE\n)]=x\n",
  "a[$(cat <<'E'\n)]\\\nE\n)]=x\n",
  'a[`print "]"`]=x\n',
  "a[\"`print ']'`\"]=x\n",
  "a[$'\\x5d']=x\n",
]) {
  test(`assignment owns a protected closing bracket in ${JSON.stringify(source)}`, () => {
    const output = valid(source);
    assert.equal((output.match(/assignment_word/g) ?? []).length, 1);
    assert.match(output, /subscript: array_subscript/);
    assert.match(output, /value: assignment_value/);
  });
}

for (const source of [
  "a=([a[b]=x)\n",
  'a=(["a]b"]=x)\n',
  "a=([$(print -r -- ']')]=x)\n",
  "a=([(r)x]=y)\n",
  "a=([(a b)]=x)\n",
  "a=([a\\ b]=x)\n",
  "a=([a\\]=b]=x)\n",
]) {
  test(`array key remains simple source in ${JSON.stringify(source)}`, () => {
    const output = valid(source);
    assert.equal((output.match(/array_element_assignment/g) ?? []).length, 1);
    assert.match(output, /key: array_element_key/);
    assert.doesNotMatch(output, /array_subscript|subscript_flags/);
  });
}

for (const source of [
  "a=([a]b]=x)\n",
  "a=([a[1]]=x)\n",
  "a=([a b]=x)\n",
  "a=([(a]b)]=x)\n",
]) {
  test(`ordinary array word is not an element assignment in ${JSON.stringify(source)}`, () => {
    assert.doesNotMatch(valid(source), /array_element_assignment/);
  });
}

test("positional assignment preserves its target without accepting digit-prefixed variable names", () => {
  assert.match(valid("12=twelve\n"), /name: positional_parameter/);
  assert.doesNotMatch(valid("1abc=x\n"), /assignment_word/);
  assert.doesNotMatch(valid("print $2[3,5]\n"), /parameter_suffix_source/);
  const modified = valid("print $1:h\n");
  assert.match(modified, /parameter_suffix_source/);
  assert.match(modified, /modifier_name `h`/);
  assert.doesNotMatch(valid("print $1[2,3]:h\n"), /parameter_suffix_source/);
});

test("quoted heredoc inside a command substitution retains its own continuation policy", () => {
  const output = valid("print $(cat <<'E'\nbody\\\nE\n)\nprint after\n");
  assert.match(output, /1:0 +- +2:0 +quoted_here_document_text/);
  assert.match(output, /2:0 +- +3:0 +here_document_end/);
  assert.doesNotMatch(output, /line_continuation/);
});

test("heredoc text does not activate dollar single quoting", () => {
  const output = valid("cat <<E\n$'\\n' $value\nE\n");
  assert.doesNotMatch(output, /dollar_single_quoted/);
  assert.match(output, /1:0 +- +1:6 +here_document_text/);
  assert.match(output, /parameter_expansion/);
});

test("unbraced subscripts preserve shell word and pipeline boundaries", () => {
  const unquoted = valid("print $a[1 + 0]\n");
  assert.match(unquoted, /array_subscript/);
  assert.equal((unquoted.match(/argument: word/g) ?? []).length, 3);
  const pipeline = valid("print $a[1|print next]\n");
  assert.match(pipeline, /array_subscript/);
  assert.equal((pipeline.match(/simple_command/g) ?? []).length, 2);
  assert.match(valid('print "$a[1 + 0]"\n'), /array_subscript/);
  assert.match(valid(`print \${a[1 + 0]}\n`), /array_subscript/);
  assert.doesNotMatch(valid("a[1 + 0]=x\n"), /assignment_word/);
  assert.match(valid("a[(1 + 0)]=x\n"), /assignment_word/);
});

test("an unfinished subscript cannot join two separately quoted words", () => {
  const output = valid('print "$a[1" "]"\n');
  assert.match(output, /array_subscript/);
  assert.equal((output.match(/argument: word/g) ?? []).length, 2);
});

for (const source of [
  'print "$x:s/a/b"\n',
  'print "$x:s/a/b c"\n',
  'print "$x:s/a/(b"\n',
  "print \"$x:s/a/'$i'\"\n",
  "print $x:F(1 + 0)h\n",
  `print \${x:ffh} \${x:fF:2:h}\n`,
]) {
  test(`modifier source preserves its surrounding boundary in ${JSON.stringify(source)}`, () => {
    assert.match(valid(source), /parameter_modifier/);
  });
}

test("unrecognized modifier prefixes preserve surrounding words and commands", () => {
  const words = valid("print $x:f a b\n");
  assert.equal((words.match(/argument: word/g) ?? []).length, 3);
  assert.doesNotMatch(words, /parameter_modifier/);
  assert.equal(
    (valid("print $x:F:2|print marker\n").match(/simple_command/g) ?? [])
      .length,
    2,
  );
  for (const source of ["print $x:s a b\n", "print $x:s/abc|print marker\n"])
    assert.equal(parse(source).hasError, true);
});

test("heredoc suffixes preserve implicit quoting without adding quote nodes", () => {
  const output = valid("cat <<E\n$a[1 + 0]\n$x:s/a b/c/\n$a['$i']\nE\n");
  assert.match(output, /arithmetic_candidate_number/);
  assert.match(output, /parameter_modifier_text `a b`/);
  assert.match(output, /parameter: variable_name `i`/);
  assert.doesNotMatch(output, /single_quoted/);
});

test("an unclosed word parenthesis preserves newlines until EOF", () => {
  const output = valid("print [(]\nprint after\n");
  assert.equal((output.match(/simple_command/g) ?? []).length, 1);
  assert.match(output, /0:7 +- +2:0 +pattern_group_source/);
  assert.doesNotMatch(output, /pattern_bracket_source|"\)"/);
});

test("backquote EOF ends incomplete patterns and filename prefixes at their physical boundary", () => {
  for (const { source, expected } of [
    {
      source: "print `print (a` (.)\n",
      expected: /0:13 +- +0:15 +pattern_group_source/,
    },
    {
      source: "print `print {a,b`\n",
      expected: /0:13 +- +0:17 +brace_expansion/,
    },
    {
      source: "print `print =cat`\n",
      expected: /0:13 +- +0:17 +equals_expansion/,
    },
    {
      source: "print `print ~`\n",
      expected: /0:13 +- +0:14 +tilde_expansion/,
    },
    {
      source: "print `print *(.)`\n",
      expected: /0:14 +- +0:17 +glob_qualifier/,
    },
  ]) {
    assert.match(valid(source), expected);
  }
});

for (const source of [
  "print [(a b)]\n",
  "print [a$(print -r -- ']')b]\n",
  "print [a$(print x # comment\\\n)b]\n",
  'print [a"$(print -r -- "]")"b]\n',
  `print [a\${:-"]"}b]\n`,
  "print [a$'\\x5d'b]\n",
  "print [a$[1+0]b]\n",
  "print [a`print ']'`b]\n",
  `print \${x#[a|b]}\n`,
  "case a in ([a|b]) print yes;; esac\n",
]) {
  test(`pattern brackets preserve protected source in ${JSON.stringify(source)}`, () => {
    assert.match(valid(source), /pattern_bracket_source/);
  });
}

test("the first unquoted bracket cannot close across a word parenthesis", () => {
  const output = valid("print [(a]b)]\n");
  assert.doesNotMatch(output, /pattern_bracket_source/);
  assert.match(output, /0:7 +- +0:12 +pattern_group_source/);
  assert.match(output, /literal `a\]b`/);
});

test("only a closing brace at a word ending acts as a command delimiter", () => {
  const output = valid("print }a a}}b\n{ print a}\n");
  assert.match(output, /literal `}a`/);
  assert.match(output, /literal `a}}b`/);
  assert.match(output, /brace_group/);
});

test("parameter delimiters end incomplete pattern source without adding a close", () => {
  const output = valid(`print \${x#(a;b} \${x/(a/b)/c}\n`);
  assert.equal((output.match(/parameter_expansion/g) ?? []).length, 2);
  assert.match(output, /literal `a;b`/);
  assert.doesNotMatch(output, /"\)"/);
});

for (const source of [
  "print ~[$name]/file\n",
  'print ~["a]b"]/file\n',
  "print ~[a[b]/file\n",
  "print ~[(a b)]/file\n",
  "print ~[a$(print key)]\n",
  "print ~[a$(print x # comment\\\n)b]\n",
  "print ~[]\n",
]) {
  test(`dynamic directory source retains its lexical name in ${JSON.stringify(source)}`, () => {
    const output = valid(source);
    assert.match(output, /dynamic_directory_name/);
    assert.doesNotMatch(
      output,
      /pattern_bracket_source|array_subscript|subscript_flags/,
    );
  });
}

test("a dynamic directory candidate does not join shell words or crossing groups", () => {
  const words = valid("print ~[a b]/file\n");
  assert.equal((words.match(/argument: word/g) ?? []).length, 2);
  assert.doesNotMatch(words, /dynamic_directory_name/);
  const crossing = valid("print ~[(a]b)]/file\n");
  assert.match(crossing, /pattern_group_source/);
  assert.doesNotMatch(crossing, /dynamic_directory_name/);
  valid("print ~[unclosed\n");
});

test("dynamic directory names inherit the enclosing parameter operand boundary", () => {
  for (const source of [
    `print \${x:-~[a b]}\n`,
    `print \${x:-~[a|b]}\n`,
    `print \${x:s/a/~[a b]/}\n`,
  ]) {
    const output = valid(source);
    assert.match(output, /dynamic_directory_name/);
    assert.match(output, /directory_name_text `a[ |]b`/);
  }
  const ended = valid(`print \${x:-~[a} b]\n`);
  assert.doesNotMatch(ended, /dynamic_directory_name/);
  assert.equal((ended.match(/argument: word/g) ?? []).length, 2);
});

test("filename prefix source respects parameter and modifier delimiters", () => {
  const output = valid(`print \${x:-=cat} \${x:s/a/=cat/} =cat:s/cat/x/\n`);
  assert.equal((output.match(/equals_expansion/g) ?? []).length, 3);
  assert.match(output, /literal `=cat:s\/cat\/x\/`/);
  assert.match(output, /modifier_separator `\/`/);
});

test("filename prefix spelling does not hide wildcard or brace source", () => {
  const output = valid("print ~+* =ca?t {~,=cat} {~,/x}\n");
  assert.match(output, /pattern_star_source/);
  assert.match(output, /pattern_question_source/);
  assert.equal((output.match(/brace_separator/g) ?? []).length, 2);
});

test("filename eligibility that depends on preceding values stays unresolved", () => {
  for (const source of ['x=a":"~+\n', "x=$prefix~+\n", "x=a\\:~+\n"]) {
    const output = valid(source);
    assert.doesNotMatch(output, /tilde_expansion/);
    if (language.name === "zsh_extended_glob")
      assert.match(output, /operator: pattern_operator `~`/);
    else assert.doesNotMatch(output, /extended_pattern/);
  }
});

for (const source of [
  "print ~[$name:s/a/b]\n",
  "a=([$name:s/a/b]=x)\n",
  "print [$name:s/a/b]\n",
  "print ($name:s/a/b c)\n",
  "print $name:s/a/(b\n",
  "print $name:s/a/{b\n",
]) {
  test(`a suffix candidate preserves its containing delimiter in ${JSON.stringify(source)}`, () => {
    assert.match(valid(source), /parameter_suffix_source/);
  });
}

test("an unbraced modifier inside another parameter does not become a braced modifier", () => {
  const output = valid(`print \${x:-$y:h3}\n`);
  assert.doesNotMatch(output, /modifier_count/);
  assert.match(output, /literal `3`/);
});

test("the first source bracket retains a partial subscript candidate without sharing a closer", () => {
  const output = valid("print ~[$a[1]]\n");
  assert.match(output, /0:7 +- +0:13 +dynamic_directory_name/);
  assert.match(output, /0:10 +- +0:12 +array_subscript/);
  assert.match(output, /0:13 +- +0:14 +literal `\]`/);
  assert.equal((output.match(/"\]"/g) ?? []).length, 1);
  for (const source of [
    "print ~[$a[1]\n",
    "a=([$x[1]=y)\n",
    "print ~[$a[$b[1]]\n",
  ])
    assert.match(valid(source), /parameter_suffix_source/);
});

test("explicit braced parameter subscripts keep their own complete brackets in names", () => {
  const output = valid(`print ~[\${a[1]}]\n`);
  assert.doesNotMatch(output, /parameter_suffix_source/);
  assert.match(output, /0:11 +- +0:14 +subscript: array_subscript/);
  assert.equal((output.match(/"\]"/g) ?? []).length, 2);
});

test("pattern brackets retain brace expansion before filename generation", () => {
  const output = valid("print [a{b,c}d]\n");
  assert.match(output, /pattern_bracket_source/);
  assert.match(output, /0:8 +- +0:13 +brace_expansion/);
  assert.match(output, /brace_separator `,`/);
  const crossing = valid("print [a{b],c}d]\n");
  assert.match(crossing, /brace_expansion/);
  assert.doesNotMatch(crossing, /pattern_bracket_source/);
});

test("pattern character classes preserve explicit expansions and quoting", () => {
  for (const source of [
    "print [[:$class:]]\n",
    `print \${x#[[:\${class}:]]}\n`,
    "print [[:$(print digit):]]\n",
    'print [[:"$(print digit)":]]\n',
    "print [[:{digit,alpha}:]]\n",
    "print [[=a=][.b.]]\n",
  ]) {
    const output = valid(source);
    assert.match(output, /pattern_character_class/);
    assert.match(output, /pattern_class_delimiter/);
  }
  const output = valid("print [[:$class:]]\n");
  assert.match(output, /0:9 +- +0:15 +parameter_expansion/);
  assert.doesNotMatch(output, /pattern_class_text/);
});

test("file process substitution starts only at an original command argument boundary", () => {
  for (const source of ["print =(:)\n", "x==(:)\n", "a=(=(:))\n"])
    assert.match(valid(source), /process_substitution/);
  for (const source of [
    "print pre=(if)\n",
    "x=pre=(if)\n",
    "x=a:=(if)\n",
    "print {=(if),x}\n",
    "print (x|=(if))\n",
    `print \${x:-<(if)}\n`,
    `print \${x:s/a/=(if)/}\n`,
  ])
    assert.doesNotMatch(valid(source), /process_substitution/);
});

test("process substitution remains structural inside original bracket arguments", () => {
  for (const source of [
    "print [a<(:)]\n",
    "print ~[a<(:)]\n",
    "a=([a<(:)]=x)\n",
    "print ~[a<(case x in x) :;; esac)]\n",
  ]) {
    const output = valid(source);
    assert.match(output, /process_substitution/);
    assert.match(
      output,
      /pattern_bracket_source|dynamic_directory_name|array_element_key/,
    );
  }
  const parameter = valid(`print \${x:-~[a<(:)]}\n`);
  assert.match(parameter, /dynamic_directory_name/);
  assert.doesNotMatch(parameter, /process_substitution/);
  const source = "a=([a<1-3>]=x)\n";
  const numeric = valid(source);
  assert.doesNotMatch(
    numeric,
    /pattern_numeric_range_source|process_substitution/,
  );
  assert.equal(
    sourceNodes(numeric, source).find(({ type }) => type === "array_key_source")
      ?.text,
    "a<1-3>",
  );
});

test("glob flags follow the language while bare qualifiers keep their arguments", () => {
  const output = valid(
    "print (#ia2)foo (#c2,4)bar *(Lk-50am+5om[1,3]u0g[root]f70?+check)\n",
  );
  assert.equal(
    (output.match(/pattern_flags_prefix/g) ?? []).length,
    language.name === "zsh_extended_glob" ? 2 : 0,
  );
  for (const argument of [
    ...(language.name === "zsh_extended_glob" ? ["2", "2,4"] : []),
    "k-50",
    "m+5",
    "m",
    "1,3",
    "0",
    "root",
    "70?",
    "check",
  ])
    assert.ok(output.includes(`glob_argument_text \`${argument}\``), argument);
  assert.doesNotMatch(output, /arithmetic_source|parameter_flags/);
  assert.match(valid("print *(W,X)\n"), /glob_qualifier_separator `,`/);
});

test("glob code arguments preserve shell quoting without parsing evaluated code", () => {
  const quoted = valid("print *(e:'[[ -n $REPLY ]]':P:-f:)\n");
  assert.match(quoted, /single_quote_content `\[\[ -n \$REPLY \]\]`/);
  assert.doesNotMatch(quoted, /conditional_command|parameter_expansion/);
  const expanded = valid('print *(P:"$tag":)\n');
  assert.match(expanded, /glob_argument_source/);
  assert.match(expanded, /parameter: variable_name `tag`/);
  assert.match(valid("print *(P:$(print tag):)\n"), /glob_qualifier/);
});

test("glob modifiers own control arguments and counts", () => {
  const prefix = language.name === "zsh_extended_glob" ? "#q" : "";
  const output = valid(`print *.c(${prefix}:s/c/$suffix/:h2) *(:F:2:s/a/b/)\n`);
  assert.equal((output.match(/glob_modifier/g) ?? []).length, 3);
  assert.match(output, /argument: modifier_count `2`/);
  assert.match(output, /modifier_control/);
  assert.match(output, /parameter: variable_name `suffix`/);
});

test("glob argument delimiters cannot replace enclosing shell boundaries", () => {
  const grouped = valid("print *(#qP:(a:b):)\n");
  assert.match(
    grouped,
    language.name === "zsh_extended_glob"
      ? /glob_group/
      : /pattern_group_source/,
  );
  assert.equal(
    (grouped.match(/glob_argument_delimiter/g) ?? []).length,
    language.name === "zsh_extended_glob" ? 2 : 0,
  );
  const incomplete = valid("print *(e:unclosed)\n");
  assert.equal((incomplete.match(/glob_argument_delimiter/g) ?? []).length, 1);
  assert.doesNotMatch(incomplete, /MISSING|•/);
  const commands = valid("print *(#qP:one; print yes\n");
  assert.equal((commands.match(/simple_command/g) ?? []).length, 2);
  assert.doesNotMatch(commands, /"\)"/);
  assert.match(valid("print *(#qP:<(:))\n"), /process_substitution/);
  assert.match(valid("print *(e{'true'})\n"), /brace_expansion/);
});

test("escaped and quoted heredoc delimiter source preserves matching ranges", () => {
  for (const source of [
    "cat <<E\\ E\nbody\nE E\nprint after\n",
    'cat <<"E\\$X"\n$value\nE$X\nprint after\n',
  ]) {
    const output = valid(source);
    assert.match(output, /quoted_here_document_text/);
    assert.match(output, /2:0 +- +3:0 +here_document_end/);
    assert.equal((output.match(/simple_command/g) ?? []).length, 2);
  }
});

for (const [source, owner] of [
  ["time { cat <<E\nbody\nE\n}\nprint after\n", "time_command"],
  [
    'nocorrect builtin print "$(if ((1)) { cat <<E\ninside\nE\n};)"\nprint after\n',
    "command_substitution",
  ],
  ["coproc : <<E\nbody\nE\nprint after\n", "coproc_keyword"],
  [
    "function show { if ((1)) cat <<E\nbody\nE\n}\nshow\n",
    "function_definition",
  ],
  [
    "cat <<E | while read -r line; do print -r -- $line; done\nbody\nE\nprint after\n",
    "while_clause",
  ],
]) {
  test(`heredoc source stays inside its ${owner} context`, () => {
    const output = valid(source);
    assert.ok(output.includes(owner));
    assert.match(output, /2:0 +- +3:0 +here_document_end/);
  });
}

test("arithmetic character values retain complete control and numeric escape source", () => {
  const values = [
    "##\\M-\\C-x",
    "##\\MA",
    "##\\CA",
    "##^A",
    "##\\n",
    "##\\x41",
    "##\\101",
    "##\\u0041",
    "#\\a",
  ];
  for (const value of values) {
    const output = valid(`print $((${value}))\n`);
    assert.equal((output.match(/arithmetic_number/g) ?? []).length, 1);
    assert.doesNotMatch(output, /arithmetic_variable|arithmetic_operator/);
    assert.ok(output.includes(`0:9  - 0:${9 + value.length}`));
  }
  const parameter = valid("print $((##$a))\n");
  assert.match(parameter, /arithmetic_operator `##`/);
  assert.match(parameter, /parameter_expansion/);
  valid("print $((##)) $((##\\)))\n");
});

test("paired parameter flag arguments retain three separately delimited source operands", () => {
  const output = valid(`print \${(l[8][0][x])x}\n`);
  assert.equal((output.match(/argument: flag_argument/g) ?? []).length, 3);
  assert.equal((output.match(/flag_argument_delimiter/g) ?? []).length, 6);
  for (const [start, end, value] of [
    [11, 12, "8"],
    [14, 15, "0"],
    [17, 18, "x"],
  ])
    assert.match(
      output,
      new RegExp(`0:${start} +- +0:${end} +flag_argument_text \`${value}\``),
    );
  assert.match(output, /0:20 +- +0:21 +parameter: variable_name/);
  assert.doesNotMatch(output, /arithmetic_source|subscript/);
});

for (const prefix of ["##", "##^", "##\\M-", "##\\C-", "##\\M-\\C-"]) {
  test(`arithmetic character prefix ${JSON.stringify(prefix)} preserves substitutions and literal quotes`, () => {
    for (const [source, node] of [
      ["$a", "parameter_expansion"],
      ["$(print A)", "command_substitution"],
      ["`print A`", "backquote_substitution"],
      ["(1)", "parenthesized_arithmetic"],
    ]) {
      const output = valid(`print $((${prefix}${source}))\n`);
      assert.ok(output.includes(node), `${prefix}${source}`);
      assert.match(
        output,
        new RegExp(
          `0:${9 + prefix.length} +- +0:${9 + prefix.length + source.length} +${node}`,
        ),
      );
    }
    for (const quote of ["'", '"']) {
      const output = valid(`print $((${prefix}${quote}))\n`);
      assert.match(output, /arithmetic_number/);
      assert.doesNotMatch(
        output,
        /single_quoted|double_quoted|arithmetic_operator/,
      );
      assert.ok(output.includes(`0:9  - 0:${10 + prefix.length}`));
    }
  });
}

for (const prefix of ["\\", "##\\", "#\\", "##^\\"]) {
  test(`arithmetic prefix ${JSON.stringify(prefix)} leaves an opening parenthesis structural`, () => {
    const output = valid(`print $((${prefix}(1)))\n`);
    assert.match(output, /parenthesized_arithmetic/);
    assert.match(valid(`a[$((${prefix}(1)))]=x\n`), /assignment_word/);
  });
}

for (const [spelling, delimiter] of [
  ["\\E", "\u001b"],
  ["\\xC3\\xA9", "é"],
  ["\\xE2\\x82\\xAC", "€"],
  ["\\xF0\\x9F\\x98\\x80", "😀"],
  ["\\303\\251", "é"],
  ["\\400", "\0"],
  ["\\C-A", "\u0001"],
  ["\\CA", "\u0001"],
  ["\\M-C\\M-)", "é"],
  ["\\C-\\C-?", "\u007f"],
  ["\\x", "\0"],
  ["\\u", "\0"],
  ["\\c", "c"],
  ["\\q", "q"],
  ["\\u03A3", "Σ"],
  ["\\U0001F600", "😀"],
  ["é\\0\\u03A3", "é\0Σ"],
  ["\\C-", ""],
]) {
  test(`heredoc delimiter ${JSON.stringify(spelling)} matches decoded bytes and preserves the next command`, () => {
    const output = valid(
      `cat <<$'${spelling}'\nbody\n${delimiter}\nprint after\n`,
    );
    assert.match(output, /1:0 +- +2:0 +quoted_here_document_text/);
    assert.match(output, /2:0 +- +3:0 +here_document_end/);
    assert.match(output, /3:0 +- +3:5 +literal `print`/);
    assert.match(
      valid(`a[$(cat <<$'${spelling}'\nbody\n${delimiter}\n)]=x\n`),
      /assignment_word/,
    );
  });
}

test("undecodable heredoc delimiter source is rejected in each quoting context", () => {
  for (const bytes of [
    [0xff],
    [0xc3],
    [0xc0, 0xaf],
    [0xc0, 0x80],
    [0xed, 0xa0, 0x80],
    [0xf4, 0x90, 0x80, 0x80],
  ]) {
    for (const [open, close] of [
      ["", ""],
      ["'", "'"],
      ["$'", "'"],
    ]) {
      const source = Buffer.concat([
        Buffer.from(`cat <<${open}`),
        Buffer.from(bytes),
        Buffer.from(`${close}\nbody\n`),
      ]);
      const result = parse(source);
      assert.equal(result.status, 1, result.output);
      assert.equal(result.hasError, true, result.output);
      assert.equal(sourceNodes(result.output, source)[0].end, source.length);
    }
  }
});

test("dollar quote escape c cannot consume the closing quote", () => {
  const output = valid("print $'\\c' after\n");
  assert.match(output, /0:8 +- +0:10 +dollar_single_quote_escape/);
  assert.match(output, /0:12 +- +0:17 +literal `after`/);
});

test("an unquoted Unicode heredoc delimiter preserves escaped terminator text", () => {
  const output = valid("cat <<é\n\\é\né\nprint after\n");
  assert.match(output, /1:0 +- +1:3 +here_document_escape/);
  assert.match(output, /2:0 +- +3:0 +here_document_end/);
  assert.match(output, /3:0 +- +3:5 +literal `print`/);
});

test("case pattern edits preserve matching heredoc delimiters and the following command", () => {
  for (const [before, after] of [
    ["a(x)", "a()"],
    ["{a,b}", "{a|b}"],
    ["a|esacx", "a|esac"],
  ]) {
    const delimiter = (pattern) => `$(case x in ${pattern}) :;; esac)`;
    const document = (pattern) =>
      `cat <<${delimiter(pattern)}\nBODY\n${delimiter(pattern)}\nprint AFTER\n`;
    const source = document(before);
    const changed = document(after);
    const edits = [source.lastIndexOf(before), source.indexOf(before)].map(
      (byte) => ({ byte, deleteBytes: before.length, insert: after }),
    );
    const output = valid(changed);
    assert.match(output, /here_document_end_text/);
    assert.match(output, /literal `AFTER`/);
    assert.equal(valid(source, edits), output);
  }
});

test("timing separator edits preserve pipeline scope and repair ordinary command boundaries", () => {
  for (const separator of ["|", "|&", "&&", "||", ";", "\n", "&"]) {
    const source = "time :; time true\n";
    const changed = `time :${separator} time true\n`;
    assert.equal(
      valid(source, [{ byte: 6, deleteBytes: 1, insert: separator }]),
      valid(changed),
    );
    assert.equal(
      valid(changed, [{ byte: 6, deleteBytes: separator.length, insert: ";" }]),
      valid(source),
    );
  }
  for (const [prefix, suffix] of [
    ["", "\n"],
    ["x=$(", ")\n"],
    ["{ ", "; }\n"],
  ]) {
    const source = `${prefix}time { :; }${suffix}`;
    const changed = `${prefix}time time { :; }${suffix}`;
    const edit = { byte: prefix.length, deleteBytes: 0, insert: "time " };
    const repair = { byte: prefix.length, deleteBytes: 5, insert: "" };
    assert.equal(parse(source, [edit]).hasError, true, changed);
    assert.equal(valid(changed, [repair]), valid(source));
    assert.equal(valid(source, [edit, repair]), valid(source));
  }
  for (const [prefix, suffix] of [
    ["", "\n"],
    ["cat <<$(", ")\nBODY\n"],
  ]) {
    const source = `${prefix}if time :; time case x in x) :;; esac; then :; fi${suffix}`;
    const changed = `${prefix}if :; time case x in x) :;; esac; then :; fi${suffix}`;
    const byte = prefix.length + 3;
    assert.equal(
      valid(source, [{ byte, deleteBytes: 5, insert: "" }]),
      valid(changed),
    );
    assert.equal(
      valid(changed, [{ byte, deleteBytes: 0, insert: "time " }]),
      valid(source),
    );
  }
});

for (const operator of ["&&", "||", "|", "|&"]) {
  test(`${operator} layout edits preserve the following operand across nested command sources`, () => {
    for (const [prefix, suffix] of [
      ["", "\n"],
      ["(", ")\n"],
      ["f() { ", "; }\n"],
      ["x=$(", ")\n"],
      ["cat <<$(", ")\nBODY\n"],
    ]) {
      const head = `${prefix}: ${operator}`;
      const tail = ` false; print AFTER${suffix}`;
      const source = head + tail;
      for (const insert of [
        " ;",
        " ; ;",
        " # comment\n;",
        "\n; # comment\n;",
      ]) {
        const changed = head + insert + tail;
        assert.equal(
          valid(source, [{ byte: head.length, deleteBytes: 0, insert }]),
          valid(changed),
          changed,
        );
        assert.equal(
          valid(changed, [
            { byte: head.length, deleteBytes: insert.length, insert: "" },
          ]),
          valid(source),
          source,
        );
      }
    }
  });

  test(`${operator} operand removal and repair preserve the distinction between final logical and pipe operators`, () => {
    const logical = operator === "&&" || operator === "||";
    for (const [prefix, suffix] of [
      ["", ""],
      ["(", ")\n"],
      ["f() { ", " }\n"],
      ["x=$(", ")\n"],
      ["if ", " then :; fi\n"],
      ["if :; then ", " fi\n"],
      ["for x in a; do ", " done\n"],
      ["foreach x (a)\n", " end\n"],
      ["case x in x) ", ";; esac\n"],
      ["", " &\n"],
    ]) {
      const head = `${prefix}: ${operator} ; `;
      const operand = suffix.trimStart().startsWith("&") ? "false" : "false; ";
      const source = head + operand + suffix;
      const omitted = head + suffix;
      const remove = {
        byte: head.length,
        deleteBytes: operand.length,
        insert: "",
      };
      const repair = { byte: head.length, deleteBytes: 0, insert: operand };
      const fresh = valid(source);
      if (logical) {
        assert.equal(valid(source, [remove]), valid(omitted));
      } else {
        assert.equal(parse(source, [remove]).hasError, true, omitted);
        assert.equal(parse(omitted).hasError, true, omitted);
      }
      assert.equal(valid(omitted, [repair]), fresh);
      assert.equal(valid(source, [remove, repair]), fresh);
    }
  });
}

for (const modifier of ["!", "coproc"]) {
  test(`${modifier} command edits preserve fresh and incremental trees in shared pipeline contexts`, () => {
    for (const [prefix, suffix] of [
      ["", ""],
      ["if ", "; then :; fi\n"],
      ["if :; then ", "; fi\n"],
      ["while ", "; do break; done\n"],
      ["for x in a; do ", "; done\n"],
      ["foreach x (a)\n", "; end\n"],
      ["case x in x) ", ";; esac\n"],
      ["f() { ", "; }; f\n"],
      ["(", ")\n"],
      ["x=$(", ")\n"],
      ["x=`", "`\n"],
      ["cat <<$(", ")\nBODY\n"],
      ["time ", "\n"],
      [": && ", " || :\n"],
      ["", " &\n"],
      [": && ", " &!\n"],
      ["false || ", " &|\n"],
    ]) {
      for (const tail of [" false", " false | :", " x=1", " >/dev/null"]) {
        const source = `${prefix}${modifier}${suffix}`;
        const changed = `${prefix}${modifier}${tail}${suffix}`;
        const byte = prefix.length + modifier.length;
        assert.equal(
          valid(source, [{ byte, deleteBytes: 0, insert: tail }]),
          valid(changed),
          changed,
        );
        assert.equal(
          valid(changed, [{ byte, deleteBytes: tail.length, insert: "" }]),
          valid(source),
          source,
        );
      }
      const replacement = modifier === "!" ? "coproc" : "!";
      assert.equal(
        valid(`${prefix}${modifier}${suffix}`, [
          {
            byte: prefix.length,
            deleteBytes: modifier.length,
            insert: replacement,
          },
        ]),
        valid(`${prefix}${replacement}${suffix}`),
      );
    }
  });

  test(`${modifier} boundary edits distinguish continuations from terminating newlines and repair repeated prefixes`, () => {
    for (const [prefix, suffix] of [
      ["", "\n"],
      ["if ", "; then :; fi\n"],
      ["f() { ", "; }\n"],
      ["x=$(", ")\n"],
    ]) {
      for (const [from, to] of [
        ["\n", " \\\n"],
        [" # comment\n", " "],
      ]) {
        const source = `${prefix}${modifier}${from}false${suffix}`;
        const changed = `${prefix}${modifier}${to}false${suffix}`;
        const byte = prefix.length + modifier.length;
        assert.equal(
          valid(source, [{ byte, deleteBytes: from.length, insert: to }]),
          valid(changed),
        );
        assert.equal(
          valid(changed, [{ byte, deleteBytes: to.length, insert: from }]),
          valid(source),
        );
      }
      const source = `${prefix}${modifier}${suffix}`;
      const byte = prefix.length + modifier.length;
      const repeated = ` ${modifier}`;
      const invalid = `${prefix}${modifier}${repeated}${suffix}`;
      assert.equal(
        parse(source, [{ byte, deleteBytes: 0, insert: repeated }]).hasError,
        true,
      );
      assert.equal(parse(invalid).hasError, true);
      assert.equal(
        valid(invalid, [{ byte, deleteBytes: repeated.length, insert: "" }]),
        valid(source),
      );
    }
  });
}

test("closing brace edits repair groups without borrowing scalar value source", () => {
  for (const assignment of ["x=a}", `x=\${x}}`, "typeset x=a}"]) {
    for (const [prefix, suffix] of [
      ["", "\n"],
      ['print "$(', ')"\n'],
      ["cat <<$(", ")\nBODY\n"],
    ]) {
      const incomplete = `${prefix}{ ${assignment}`;
      const complete = `${incomplete} }${suffix}`;
      assert.equal(parse(incomplete + suffix).hasError, true);
      assert.equal(
        valid(incomplete + suffix, [
          { byte: incomplete.length, deleteBytes: 0, insert: " }" },
        ]),
        valid(complete),
      );
      assert.equal(
        parse(complete, [
          { byte: incomplete.length, deleteBytes: 2, insert: "" },
        ]).hasError,
        true,
      );
    }
  }
});

test("short condition edits preserve completed commands and keep body ownership", () => {
  for (const condition of [
    "case x in x) :;; esac",
    "{ :; } always { :; }",
    "f() [[ x ]]",
    "repeat 1 [[ x ]]",
    "for x (a) [[ x ]]",
    ": | case x in x) :;; esac",
    ": && case x in x) :;; esac",
    "time case x in x) :;; esac",
  ]) {
    for (const prefix of ["if ", "while ", "until "]) {
      const before = `${prefix}[[ x ]] { :; }\n`;
      const after = `${prefix}${condition} { :; }\n`;
      assert.equal(
        valid(before, [
          { byte: prefix.length, deleteBytes: 7, insert: condition },
        ]),
        valid(after),
      );
      assert.equal(
        valid(after, [
          {
            byte: prefix.length,
            deleteBytes: condition.length,
            insert: "[[ x ]]",
          },
        ]),
        valid(before),
      );
    }
  }
  const before = "if if :; then :; fi :\n";
  const body = before.lastIndexOf(":");
  const broken = `${before.slice(0, body)}{ :; }\n`;
  assert.equal(parse(broken).hasError, true);
  assert.equal(
    valid(broken, [{ byte: body, deleteBytes: 6, insert: ":" }]),
    valid(before),
  );
});

test("conditional opening edits preserve nested source boundaries in every lookahead context", () => {
  const condition = "[[ x ]]";
  const command = "[[x]] case";
  for (const { source, expected } of [
    { source: 'print "$([[ x ]])"\n', expected: /command_substitution/ },
    { source: "a[$([[ x ]])]=x\n", expected: /assignment_word/ },
    {
      source: `print \${a[$([[ x ]])]}\n`,
      expected: /subscript: array_subscript/,
    },
    { source: "print [a$([[ x ]])b]\n", expected: /pattern_bracket_text `b`/ },
    { source: "(($([[ x ]])))\n", expected: /arithmetic_command/ },
    { source: `print \${(j:$([[ x ]]):)x}\n`, expected: /flag_argument_text/ },
    {
      source: "cat <<$([[ x ]])\nBODY\n$([[ x ]])\nprint AFTER\n",
      expected: /here_document_end_text/,
    },
  ]) {
    const changed = source.replaceAll(condition, command);
    const originalTree = valid(source);
    const changedTree = valid(changed);
    assert.match(originalTree, expected);
    assert.match(changedTree, expected);
    assert.doesNotMatch(changedTree, /conditional_command|case_clause/);
    for (const [before, oldText, newText, expectedTree] of [
      [source, condition, command, changedTree],
      [changed, command, condition, originalTree],
    ]) {
      const edits = [];
      for (
        let byte = before.indexOf(oldText);
        byte >= 0;
        byte = before.indexOf(oldText, byte + oldText.length)
      ) {
        edits.push({ byte, deleteBytes: oldText.length, insert: newText });
      }
      assert.equal(valid(before, edits.reverse()), expectedTree);
    }
  }
});

test("quoting and repairing whitespace braces restores the parameter boundary", () => {
  const source = `print \${x:-{ }x}\n`;
  const quoted = `print "\${x:-{ }x}"\n`;
  const open = source.indexOf("$");
  const close = source.length - 1;
  assert.equal(
    valid(source, [
      { byte: open, deleteBytes: 0, insert: '"' },
      { byte: close + 1, deleteBytes: 0, insert: '"' },
    ]),
    valid(quoted),
  );
  assert.equal(
    valid(quoted, [
      { byte: close + 1, deleteBytes: 1, insert: "" },
      { byte: open, deleteBytes: 1, insert: "" },
    ]),
    valid(source),
  );
  const missing = `${source.slice(0, close - 1)}\n`;
  assert.equal(
    parse(source, [{ byte: close - 1, deleteBytes: 1, insert: "" }]).hasError,
    true,
  );
  assert.equal(
    valid(missing, [{ byte: close - 1, deleteBytes: 0, insert: "}" }]),
    valid(source),
  );
  const heredoc = `cat <<\${x:-{a}x}\nbody\n\${x:-{a}x}\nprint after\n`;
  const edits = [heredoc.indexOf("{a"), heredoc.lastIndexOf("{a")].map(
    (byte) => ({ byte: byte + 1, deleteBytes: 1, insert: " " }),
  );
  assert.equal(valid(heredoc, edits), valid(heredoc.replaceAll("{a", "{ ")));
});

test("crossing brace edits retain lexical state across groups and modifier operands", () => {
  for (const [source, oldText, newText] of [
    ["print (/{b})\n", "})", ")}"],
    [`print \${x:s/a{}/b/}\n`, "a{}/b/", "a{/b}/"],
    ["print {a({b})}\n", "})", ")}"],
    ["print [({a})]\n", "})", ")}"],
    ["print (#qe:({a})b:)\n", "})", ")}"],
    ["print ({b)}TAIL\n", "TAIL", ""],
    [`print \${x:s/a{/b}/}TAIL\n`, "TAIL", ""],
  ]) {
    const byte = source.indexOf(oldText);
    const changed =
      source.slice(0, byte) + newText + source.slice(byte + oldText.length);
    const edit = { byte, deleteBytes: oldText.length, insert: newText };
    const repair = { byte, deleteBytes: newText.length, insert: oldText };
    assert.equal(valid(source, [edit]), valid(changed));
    assert.equal(valid(changed, [repair]), valid(source));
    assert.equal(valid(source, [edit, repair]), valid(source));
  }
  const missing = `print \${x:s/a{/b/}\n`;
  const repaired = `print \${x:s/a{/b}/}\n`;
  const byte = missing.indexOf("b") + 1;
  assert.equal(parse(missing).hasError, true);
  assert.equal(
    valid(missing, [{ byte, deleteBytes: 0, insert: "}" }]),
    valid(repaired),
  );
  assert.equal(
    parse(repaired, [{ byte, deleteBytes: 1, insert: "" }]).hasError,
    true,
  );
});

test("crossing brace closures precede older enclosing braces even with adjacent literal tails", () => {
  for (const source of [
    "print {a({b)}}\n",
    "print {long({inner)}}TAIL\n",
    "print ({b)TAIL}END\n",
    `print \${unset_name:-{a({b)}}}\n`,
    `print \${unset_name:-[({a)b,c}d]}\n`,
    "print [[:({a)b,c}d:]]\n",
    "print (#i({a)b,c}d)\n",
    "print (#qe:({a)b,c}d:)\n",
    "print ({a)~name}TAIL\n",
  ]) {
    const tree = valid(source);
    const closers = tree
      .split("\n")
      .filter((line) => line.includes("brace_closing_source"));
    assert.equal(closers.length, 1, tree);
    const range = closers[0].match(/^0:([0-9]+) +- +0:([0-9]+)/);
    assert.deepEqual(
      range?.slice(1).map(Number),
      [source.indexOf("}"), source.indexOf("}") + 1],
      tree,
    );
  }
});

test("crossing brace state stays outside quotes nested expansions and later words", () => {
  for (const source of [
    `print ({a)"}"}\n`,
    `print ({a)\${(j:{z}:)a}}\n`,
    `print ({a)\${a[1]}}\n`,
    `print ({a)$a[1]}\n`,
    `print ({a)$(print -r -- inner)}\n`,
    `print \${x:s/a{/$(print -r -- b)}/}\n`,
  ]) {
    assert.equal(valid(source).split("brace_closing_source").length - 1, 1);
  }
  assert.equal(parse("print ({a) next}\n").hasError, true);
});

test("heredoc delimiter edits preserve crossing brace and parameter boundaries", () => {
  const source = `cat <<\${x:s/a{}/b/}\nbody\n\${x:s/a{}/b/}\nprint after\n`;
  const changed = source.replaceAll("a{}/b/", "a{/b}/");
  const declaration = source.indexOf("a{}/b/");
  const terminator = source.lastIndexOf("a{}/b/");
  const edits = [declaration, terminator].map((byte) => ({
    byte,
    deleteBytes: 6,
    insert: "a{/b}/",
  }));
  assert.equal(valid(source, edits), valid(changed));
  const repairs = edits.map((edit) => ({ ...edit, insert: "a{}/b/" }));
  assert.equal(valid(changed, repairs), valid(source));
  assert.equal(valid(source, [...edits, ...repairs]), valid(source));
  assert.equal(
    parse(`cat <<\${x:s/a{/b/}\nbody\n\${x:s/a{/b/}\n`).hasError,
    true,
  );
});

test("removing and restoring a conditional expression distinguishes empty source from empty operands", () => {
  for (const [prefix, suffix] of [
    ["", "\n"],
    ["if ", "; then :; fi\n"],
    ["f() { ", "; }\n"],
    ["x=$(", ")\n"],
    ["cat <<$(", ")\nBODY\n"],
  ]) {
    for (const layout of [" ", "\n", " # comment\n"]) {
      const head = `${prefix}[[${layout}`;
      const tail = ` ]]${suffix}`;
      const empty = head + tail;
      assert.equal(parse(empty).hasError, true, empty);
      for (const expression of ['""', "$unset_value"]) {
        const source = head + expression + tail;
        const remove = {
          byte: head.length,
          deleteBytes: expression.length,
          insert: "",
        };
        const repair = {
          byte: head.length,
          deleteBytes: 0,
          insert: expression,
        };
        const fresh = valid(source);
        assert.equal(parse(source, [remove]).hasError, true, empty);
        assert.equal(valid(empty, [repair]), fresh);
        assert.equal(valid(source, [remove, repair]), fresh);
      }
    }
  }
});

test("descriptor edits reject compound redirections while preserving numeric redirections and inner simple bodies", () => {
  for (const command of [
    "{ :; }",
    "( : )",
    "if :; then :; fi",
    "for x in a; do :; done",
    "foreach x (a); :; end",
    "case x in x) :;; esac",
    "[[ x ]]",
    "((1))",
    "f() { :; }",
    "function f { :; }",
    "{ :; } always { :; }",
  ]) {
    for (const [prefix, suffix] of [
      ["", "\n"],
      ["if :; then ", "; fi\n"],
      ["x=$(", ")\n"],
    ]) {
      const head = `${prefix}${command} `;
      const tail = `>out${suffix}`;
      const source = `${head}2${tail}`;
      const changed = `${head}{fd}${tail}`;
      const edit = { byte: head.length, deleteBytes: 1, insert: "{fd}" };
      const repair = { byte: head.length, deleteBytes: 4, insert: "2" };
      const fresh = valid(source);
      assert.equal(parse(changed).hasError, true, changed);
      assert.equal(parse(source, [edit]).hasError, true, changed);
      assert.equal(valid(changed, [repair]), fresh);
      assert.equal(valid(source, [edit, repair]), fresh);
    }
  }
  for (const head of [
    "f() : ",
    "function f; : ",
    "for x; : ",
    "repeat 1 : ",
    "f ",
    "function f ",
    "() { :; } ",
    "function { :; } ",
    "x=y : ",
    "x=y exec ",
    "typeset x ",
  ]) {
    const tail = head === "f " ? ">out () { :; }\n" : ">out\n";
    const source = `${head}2${tail}`;
    const changed = `${head}{fd}${tail}`;
    const edit = { byte: head.length, deleteBytes: 1, insert: "{fd}" };
    const undo = { byte: head.length, deleteBytes: 4, insert: "2" };
    assert.equal(valid(source, [edit]), valid(changed), changed);
    assert.equal(valid(changed, [undo]), valid(source), source);
  }
});

test("unquoting a leading hash hides condition closers and repairing it restores the tree", () => {
  for (const source of ["[[ \\# ]]\n", "[[ x =~ \\# ]]\n"]) {
    const byte = source.indexOf("\\");
    const incomplete = source.slice(0, byte) + source.slice(byte + 1);
    assert.equal(
      parse(source, [{ byte, deleteBytes: 1, insert: "" }]).hasError,
      true,
    );
    assert.equal(parse(incomplete).hasError, true);
    assert.equal(
      valid(incomplete, [{ byte, deleteBytes: 0, insert: "\\" }]),
      valid(source),
    );
  }
});

test("editing conditional closing word boundaries rejects attached keywords and restores the complete tree", () => {
  for (const [prefix, keyword, suffix] of [
    ["if [[ x ]]", "then", " :; fi\n"],
    ["if :; then [[ x ]]", "fi", "\n"],
    ["if :; then [[ x ]]", "else", " :; fi\n"],
    ["if :; then [[ x ]]", "elif", " :; then :; fi\n"],
    ['while [[ "" ]]', "do", " break; done\n"],
    ["for x in a; do [[ x ]]", "done", "\n"],
    ["case x in x) [[ x ]]", "esac", "\n"],
    ["foreach x (a)\n[[ x ]]", "end", "\n"],
    ["[[ x ]]", "#comment", "\n"],
  ]) {
    for (const close of ["]]", "]\\\n]"]) {
      const head = prefix.slice(0, -2) + close;
      const complete = `${head} ${keyword}${suffix}`;
      const fresh = valid(complete);
      for (const gap of ["", "\\\n"]) {
        const incomplete = head + gap + keyword + suffix;
        const remove = { byte: head.length, deleteBytes: 1, insert: gap };
        const repair = {
          byte: head.length,
          deleteBytes: gap.length,
          insert: " ",
        };
        assert.equal(parse(complete, [remove]).hasError, true, incomplete);
        assert.equal(valid(incomplete, [repair]), fresh, incomplete);
        assert.equal(valid(complete, [remove, repair]), fresh, complete);
      }
    }
  }
});

test("removed continuations preserve pattern, assignment and subscript initial state", () => {
  for (const pattern of ["[\\\n]a]", "[!\\\n]]"]) {
    for (const source of [
      `print ${pattern}\n`,
      `print \${x:-${pattern}}\n`,
      `[[ x == ${pattern} ]]\n`,
      `case x in ${pattern}) :;; esac\n`,
    ]) {
      assert.match(valid(source), /pattern_bracket_source/);
    }
  }
  assert.match(valid("x=\\\n=(print x)\n"), /process_substitution/);
  assert.match(valid(`print \${a[\\\n(r)x]}\n`), /subscript_flags/);
  assert.match(valid(`print \${\\\n#x}\n`), /parameter_length_operator/);
});

test("parameter operand prefixes do not hide following pattern source", () => {
  for (const prefix of ["abc", "~user", "=command"]) {
    assert.match(
      valid(`print \${x:-${prefix}<1-2>}\n`),
      /pattern_numeric_range_source/,
    );
    assert.match(
      valid(`print \${x:-${prefix}(a|b)}\n`),
      /pattern_group_source/,
    );
    assert.match(
      valid(`print \${x:-${prefix}(#q)}\n`),
      language.name === "zsh_extended_glob"
        ? /glob_qualifier/
        : /pattern_group_source/,
    );
    assert.doesNotMatch(
      valid(`print "\${x:-${prefix}<1-2>}"\n`),
      /pattern_numeric_range_source/,
    );
  }
});

test("each asynchronous list separator requires a preceding command", () => {
  for (const separators of ["& &", "; &", "&! &!", "&\n&", "& ; &|"]) {
    for (const source of [
      `: ${separators} :\n`,
      `(: ${separators} :)\n`,
      `{ : ${separators} :; }\n`,
      `if :; then : ${separators} :; fi\n`,
      `print $(: ${separators} :)\n`,
    ])
      assert.equal(parse(source).hasError, true, source);
  }
  for (const separators of ["&\n", "&!\n", ";\n", "&\n\n"]) {
    valid(`: ${separators} :\n`);
  }
});

test("redirections reject an incompatible leading process substitution", () => {
  for (const redirect of ["> <(:)", ">! <(:)", ">| <(:)", "< >(:)"]) {
    for (const prefix of ["", "cat ", "2", "{fd}"]) {
      for (const spacing of ["", " ", "\t\\\n"]) {
        if (redirect === "< >(:)" && !spacing) continue;
        const source = `${prefix}${redirect.replace(" ", spacing)}\n`;
        assert.equal(parse(source).hasError, true, source);
      }
    }
  }
  for (const redirect of ["> <(:)", ">! <(:)", ">| <(:)", "< >(:)"]) {
    for (const prefix of ["x", "''", '""', `\${x}`]) {
      assert.match(
        valid(`cat ${redirect.replace(" ", ` ${prefix}`)}\n`),
        /process_substitution/,
      );
    }
  }
  for (const redirect of [
    "> >(:)",
    "< <(:)",
    "> =(print x)",
    "< =(print x)",
    ">> <(:)",
    "<> >(:)",
    ">& <(:)",
    "<& >(:)",
    "&> <(:)",
    "<<< >(:)",
  ]) {
    assert.match(valid(`cat ${redirect}\n`), /process_substitution/);
  }
});

test("file redirect edits reject direct process suffixes and repair filename boundaries", () => {
  for (const [operator, substitution] of [
    ["<", "<(:)"],
    [">", ">(:)"],
    [">!", ">(:)"],
    [">|", ">(:)"],
    [">>", "<(:)"],
    [">>!", "<(:)"],
    [">>|", "<(:)"],
    ["<>", "<(:)"],
    ["<&", "<(:)"],
    [">&", ">(:)"],
    ["&>", ">(:)"],
    [">&!", ">(:)"],
    [">&|", ">(:)"],
    ["&>!", ">(:)"],
    ["&>|", ">(:)"],
    [">>&", ">(:)"],
    [">>&!", ">(:)"],
    [">>&|", ">(:)"],
    ["&>>", ">(:)"],
    ["&>>!", ">(:)"],
    ["&>>|", ">(:)"],
    [">", "=(:)"],
  ]) {
    const prefix = `: ${operator} `;
    const source = `${prefix}${substitution} x\n`;
    const joined = `${prefix}${substitution}x\n`;
    const byte = prefix.length + substitution.length;
    const join = { byte, deleteBytes: 1, insert: "" };
    const separate = { byte, deleteBytes: 0, insert: " " };
    assert.equal(parse(source, [join]).hasError, true, joined);
    assert.equal(valid(joined, [separate]), valid(source));
    assert.equal(valid(source, [join, separate]), valid(source));
    assert.equal(
      valid(joined, [{ byte: prefix.length, deleteBytes: 0, insert: '""' }]),
      valid(`${prefix}""${substitution}x\n`),
    );
  }
});

test("process filename suffix restrictions survive quotation expansion and continuation edits", () => {
  const source = ": < <(:)\n";
  const byte = source.length - 1;
  const expected = valid(source);
  for (const suffix of [
    "x",
    "''",
    '""',
    String.raw`\x`,
    "$x",
    `\${x}`,
    "$(print x)",
    "`print x`",
    "$((1))",
    "{a,b}",
    "(N)",
    "<1-2>",
    "<(:)",
    "\\\nx",
  ]) {
    const changed = source.slice(0, byte) + suffix + source.slice(byte);
    const insert = { byte, deleteBytes: 0, insert: suffix };
    const remove = { byte, deleteBytes: suffix.length, insert: "" };
    assert.equal(parse(source, [insert]).hasError, true, changed);
    assert.equal(valid(changed, [remove]), expected);
    assert.equal(valid(source, [insert, remove]), expected);
  }
  for (const continuation of ["\\\n", "\\\n\\\n"]) {
    assert.equal(
      valid(source, [{ byte, deleteBytes: 0, insert: continuation }]),
      valid(source.slice(0, byte) + continuation + source.slice(byte)),
    );
  }
});

test("file and here string operator edits keep process suffix rules local to the operand", () => {
  for (const [prefix, suffix] of [
    ["", "\n"],
    ["f() { ", "; }\n"],
    ["x=$(", ")\n"],
    [": `", "`\n"],
    [": < <(", ")\n"],
    [": <<$(", ")\nBODY\n"],
    [": ${a[$(", ")]}\n"],
  ]) {
    const source = `${prefix}: <<< <(:)x${suffix}`;
    const changed = `${prefix}: < <(:)x${suffix}`;
    const byte = prefix.length + 3;
    const edit = { byte, deleteBytes: 2, insert: "" };
    const repair = { byte, deleteBytes: 0, insert: "<<" };
    const expected = valid(source);
    assert.equal(parse(source, [edit]).hasError, true, changed);
    assert.equal(valid(changed, [repair]), expected);
    assert.equal(valid(source, [edit, repair]), expected);
  }
});

test("parenthesized filenames preserve complete redirection operators", () => {
  for (const operator of [
    ">!",
    ">|",
    ">>!",
    ">>|",
    "<&",
    ">&",
    "<>",
    ">&!",
    ">&|",
    ">>&",
    ">>&!",
    ">>&|",
    "&>",
    "&>>",
    "&>!",
    "&>|",
    "&>>!",
    "&>>|",
  ]) {
    for (const prefix of ["", "2", "{fd}"]) {
      const output = valid(`cat ${prefix}${operator}(x)\n`);
      assert.ok(output.includes(`redirect_operator \`${operator}\``), output);
      assert.doesNotMatch(output, /process_substitution/);
    }
  }
  assert.match(valid("cat <<<(:)\n"), /here_string/);
  const document = valid("cat <<-(x)\nbody\n(x)\nprint after\n");
  assert.match(document, /here_document_end_text `\(x\)`/);
  assert.doesNotMatch(document, /process_substitution/);
});

test("dollar quote prefixes accept continuations in word and delimiter contexts", () => {
  for (const continuation of ["\\\n", "\\\n\\\n"]) {
    for (const source of [
      `x=$${continuation}'x'\n`,
      `print \${x:-$${continuation}'x'}\n`,
      `print $(print $${continuation}'x')\n`,
      `case x in $${continuation}'x') :;; esac\n`,
      `[[ x == $${continuation}'x' ]]\n`,
      `cat <<$${continuation}'E'\n$x\nE\nprint after\n`,
    ]) {
      const output = valid(source);
      assert.match(output, /dollar_single_quoted/);
      assert.match(output, /line_continuation/);
    }
  }
});

test("brace words preserve immediately nested patterns and substitutions", () => {
  for (const word of ["{(a|b)}", "{<1-2>}", "{<(print x)}", "{>(print x)}"]) {
    assert.match(valid(`print ${word}\n`), /brace_expansion/);
  }
});

test("a command brace opener does not need whitespace before its body", () => {
  for (const source of [
    "{print x}\n",
    "{(print x)}\n",
    "time {:}\n",
    "for x; {print x}\n",
  ]) {
    assert.match(valid(source), /brace_group/);
  }
  for (const source of [
    "nocorrect {:}\n",
    "x=1 {:}\n",
    "function f {print x}\n",
  ]) {
    assert.equal(parse(source).hasError, true, source);
  }
});

test("numeric ranges do not terminate qualifier candidates or their arguments", () => {
  for (const word of ["(<1-2>)", "*(#qP:<1-2>:)", "*(e:<1-2>:)"]) {
    valid(`print ${word}\n`);
    valid(`[[ x == ${word} ]]\n`);
  }
});

test("case patterns preserve process substitutions at their original word positions", () => {
  for (const word of [
    "<(print x)",
    ">(print x)",
    "=(print x)",
    "[<(print x)]",
    "{<(print x)}",
    "*(#qP:<(print x):)",
  ]) {
    assert.match(
      valid(`case x in ${word}) :;; esac\n`),
      /process_substitution/,
    );
  }
  assert.doesNotMatch(
    valid("case x in pre=(print x)) :;; esac\n"),
    /process_substitution/,
  );
});

test("quoted parameter operands inherit literal apostrophes and braces", () => {
  for (const operand of ["{a", "'a", "$'a", `\${y:-'a}`]) {
    for (const source of [
      `print "\${x:-${operand}}"\n`,
      `cat <<E\n\${x:-${operand}}\nE\n`,
      `print $((\${x:-${operand}}))\n`,
    ])
      assert.doesNotMatch(valid(source), /single_quoted|brace_expansion/);
  }
  assert.match(valid(`print "\${x:-"a"}"\n`), /double_quoted/);
  assert.match(
    valid(`print "\${x:-$(print \${y:-{a,b}})}"\n`),
    /brace_expansion/,
  );
});

test("unquoted flag arguments retain balanced literal braces", () => {
  for (const [open, close] of [
    [":", ":"],
    ["[", "]"],
    ["<", ">"],
    ["(", ")"],
  ]) {
    for (const flag of ["s", "j"]) {
      assert.match(
        valid(`print \${(${flag}${open}{{a,b}}${close})x}\n`),
        /flag_argument_text `\{\{a,b\}\}`/,
      );
    }
  }
  const fallback = valid(`print $((\${(s:{a,b}:)x}))\n`);
  assert.match(fallback, /command_substitution/);
  assert.doesNotMatch(fallback, /arithmetic_expansion/);
  assert.equal(parse(`print \${(s:{:)x}\n`).hasError, true);
  valid(`print "\${(s:{:)x}"\n`);
});

test("an exec option with attached source does not consume a separate operand", () => {
  for (const option of [
    "-a}x",
    "-a(x)",
    "-a<1-2>",
    "-a<(print x)",
    "-a>(print x)",
  ]) {
    const output = valid(`noglob exec ${option} /bin/echo output\n`);
    assert.match(output, /name: word\n[^\n]+literal `\/bin\/echo`/);
    assert.doesNotMatch(output, /operand:/);
  }
});

test("reserved words and modifiers must occupy the complete command word", () => {
  for (const word of [
    "if",
    "while",
    "for",
    "case",
    "then",
    "esac",
    "in",
    "time",
    "function",
    "typeset",
    "exec",
    "nocorrect",
    "coproc",
    "!",
    "[[",
  ]) {
    for (const suffix of [
      "}x",
      "<1-2>",
      "(a)",
      "<(print x)",
      ">(print x)",
      "\\\n}x",
    ]) {
      const output = valid(`${word}${suffix} arg\n`);
      assert.match(output, /name: word/);
      assert.doesNotMatch(
        output,
        /keyword|precommand_modifier|conditional_command|if_clause|time_command/,
      );
    }
  }
});

test("arithmetic quotes preserve their raw source inside commands, subscripts and nested expansions", () => {
  for (const expression of ['"1', "'1", '##"', "##'", 'a["1]', `\${x:-{}`]) {
    for (const source of [
      `((${expression}))\n`,
      `print $((${expression}))\n`,
      `print $[${expression}]\n`,
      `for ((${expression};0;)) do :; done\n`,
      `a[$((${expression}))]=x\n`,
      `[[ -n $((${expression})) ]]\n`,
    ]) {
      const output = valid(source);
      assert.doesNotMatch(
        output,
        /single_quoted|double_quoted|brace_expansion/,
      );
    }
  }
});

test("arithmetic lookahead falls back to shell syntax for unmatched raw delimiters", () => {
  for (const word of ['"("', "'('", "[1", "1]"]) {
    const output = valid(`print $((${word}))\n`);
    assert.match(output, /command_substitution/);
    assert.match(output, /subshell/);
    assert.doesNotMatch(output, /arithmetic_expansion/);
  }
  assert.match(valid(`print $((1+$(print \${x:-{a}})))\n`), /brace_expansion/);
});

test("square arithmetic boundaries agree with enclosing lookahead", () => {
  for (const expression of [
    '$[1"["2]]',
    "$[1@[]]",
    "$[1'[]]",
    "$[(1[)]]",
    "$[[(1])]",
    "$[(1[) + $[2]]]",
    "$[a[(b[2])]]",
    "$[1\\[2]",
    "$[(1\\(2)]",
    "$[f(1\\[2)]",
    "$[1\\]2]",
    "$[1\\)2]",
    "$[(1[)\\\n]]",
  ]) {
    for (const source of [
      `print ${expression}\n`,
      `print $((1 + ${expression}))\n`,
      `a[${expression}]=x\n`,
      `cat <<END\n${expression}\nEND\n`,
    ]) {
      const output = valid(source);
      assert.match(output, /arithmetic_expansion/);
      assert.doesNotMatch(output, /command_substitution|subshell/);
    }
    assert.match(
      valid(`print \${(s:${expression}:)x}\n`),
      /flag_argument_text/,
    );
  }
});

test("arithmetic fragments preserve every for header separator", () => {
  for (const fragment of ["@", ".", "$", "'", '"', "([1)]"]) {
    const output = valid(`for ((${fragment};0;)) do :; done\n`);
    assert.match(output, /initializer: arithmetic_source/);
    assert.match(output, /condition: arithmetic_source/);
    assert.doesNotMatch(output, /update: arithmetic_source/);
  }
});

test("nested unbraced subscript sources stop at their enclosing parameter", () => {
  for (const source of [
    `print \${x:-$a[1}\n`,
    `print \${x:-$a[1}after]\n`,
    `a[\${x:-$a[1}]=x\n`,
    `print $((1+\${x:-$a[1}))\n`,
    `[[ -n \${x:-$a[1} ]]\n`,
  ]) {
    const output = valid(source);
    assert.match(output, /parameter_suffix_source/);
    assert.match(output, /subscript_text `1`/);
  }
  assert.match(valid(`print \${x:-$a[{foo}]}\n`), /parameter_suffix_source/);
});

test("heredoc body insertion and removal preserve substitution and outer document ownership", () => {
  for (const { source, newlineError = true } of [
    { source: 'print "$(cat <<E)"\nprint AFTER\n' },
    { source: "print `cat <<E`\nprint AFTER\n", newlineError: false },
    { source: "cat <(cat <<E)\nprint AFTER\n" },
    { source: ": >(cat <<E)\nprint AFTER\n" },
    { source: "cat =(cat <<E)\nprint AFTER\n" },
    { source: ': <<OUT "$(cat <<E)"\nbody\nOUT\nprint AFTER\n' },
    { source: 'print "$(print "$(cat <<E)")"\nprint AFTER\n' },
    { source: "cat <<OUT\n$(cat <<E)\nOUT\nprint AFTER\n" },
  ]) {
    const byte = source.indexOf("<<E") + 3;
    const body = "\ninner\nE\n";
    const changed = source.slice(0, byte) + body + source.slice(byte);
    const insert = { byte, deleteBytes: 0, insert: body };
    const remove = { byte, deleteBytes: body.length, insert: "" };
    const fresh = valid(source);
    assert.equal(valid(source, [insert]), valid(changed));
    assert.equal(valid(changed, [remove]), fresh);
    assert.equal(valid(source, [insert, remove]), fresh);
    const incomplete = `${source.slice(0, byte)}\n${source.slice(byte)}`;
    assert.equal(
      parse(source, [{ byte, deleteBytes: 0, insert: "\n" }]).hasError,
      newlineError,
    );
    assert.equal(
      valid(incomplete, [{ byte, deleteBytes: 1, insert: "" }]),
      fresh,
    );
  }
});

test("square delimiter continuations preserve source ranges while joining the matching value", () => {
  const tree = valid("cat <<$[a\\\nb]\nbody\n$[ab]\nprint after\n");
  assert.match(tree, /0:9 +- +0:10 +line_continuation/);
  assert.match(tree, /3:0 +- +3:5 +here_document_end_text/);
  assert.match(tree, /literal `after`/);
});

test("editing quoted references repairs nested values independently of the enclosing context", () => {
  for (const { before, after, offset, deleteBytes, insert, accepted } of [
    {
      before: `\${"$x"}`,
      after: `\${"\${x}"}`,
      offset: 3,
      deleteBytes: 2,
      insert: `\${x}`,
      accepted: true,
    },
    {
      before: `\${"\${x}"}`,
      after: `\${"\${x}text"}`,
      offset: 7,
      deleteBytes: 0,
      insert: "text",
      accepted: false,
    },
    {
      before: `\${"$[1+2]"}`,
      after: `\${"$((1+2))"}`,
      offset: 3,
      deleteBytes: 6,
      insert: "$((1+2))",
      accepted: true,
    },
    {
      before: `\${"$x"}`,
      after: `\${:-"$x"}`,
      offset: 2,
      deleteBytes: 0,
      insert: ":-",
      accepted: true,
    },
  ]) {
    for (const [prefix, suffix] of [
      ["print ", "\n"],
      ['print "', '"\n'],
      ["print $(print ", ")\n"],
      ["(( ", " ))\n"],
      ["cat <<E\n", "\nE\nprint AFTER\n"],
    ]) {
      const source = prefix + before + suffix;
      const changed = prefix + after + suffix;
      const edit = { byte: prefix.length + offset, deleteBytes, insert };
      const undo = {
        byte: edit.byte,
        deleteBytes: insert.length,
        insert: before.slice(offset, offset + deleteBytes),
      };
      if (accepted) {
        assert.equal(parse(source).hasError, true, source);
        assert.equal(valid(source, [edit]), valid(changed));
        assert.equal(parse(changed, [undo]).hasError, true, source);
      } else {
        assert.equal(parse(changed).hasError, true, changed);
        assert.equal(parse(source, [edit]).hasError, true, changed);
        assert.equal(valid(changed, [undo]), valid(source));
        assert.equal(valid(source, [edit, undo]), valid(source));
      }
    }
  }
});

test("reference quote edits preserve heredoc delimiter matching and change body quoting", () => {
  for (const { before, after, end, offset, insert } of [
    {
      before: `\${x}`,
      after: `\${""x}`,
      end: `\${x}`,
      offset: 2,
      insert: '""',
    },
    {
      before: `\${\${x}}`,
      after: `\${""\${x}}`,
      end: `\${\${x}}`,
      offset: 2,
      insert: '""',
    },
    {
      before: `\${"\${x}"}`,
      after: `\${"\${x}"""}`,
      end: `\${\${x}}`,
      offset: 8,
      insert: '""',
    },
  ]) {
    const tail = `\n$VALUE\n${end}\nprint AFTER\n`;
    const source = `cat <<${before}${tail}`;
    const changed = `cat <<${after}${tail}`;
    const edit = { byte: 6 + offset, deleteBytes: 0, insert };
    const undo = { byte: edit.byte, deleteBytes: insert.length, insert: "" };
    const output = valid(changed);
    assert.match(output, /here_document_end_text/);
    assert.match(output, /quoted_here_document_text/);
    assert.match(output, /literal `AFTER`/);
    assert.equal(
      valid(source).includes("quoted_here_document_text"),
      before.includes('"'),
    );
    assert.equal(valid(source, [edit]), output);
    assert.equal(valid(changed, [undo]), valid(source));
  }
});

test("switching a heredoc delimiter to a here string rechecks quoted reference syntax", () => {
  for (const reference of [
    `\${"$x"}`,
    `\${"x"}`,
    `\${"\${x}text"}`,
    `\${"\${x}\${x}"}`,
    `\${"$[1+2]"}`,
  ]) {
    const source = `cat <<${reference}\n`;
    const changed = `cat <<<${reference}\n`;
    const edit = { byte: 6, deleteBytes: 0, insert: "<" };
    const undo = { byte: 6, deleteBytes: 1, insert: "" };
    assert.equal(parse(changed).hasError, true, changed);
    assert.equal(parse(source, [edit]).hasError, true, changed);
    assert.equal(valid(changed, [undo]), valid(source));
    assert.equal(valid(source, [edit, undo]), valid(source));
  }
});

test("editing parameter flag names rechecks their allowed arguments", () => {
  for (const { before, after, args, accepted } of [
    { before: "q+", after: "+", args: "", accepted: false },
    { before: "+", after: "q+", args: "", accepted: true },
    { before: "l", after: "j", args: ":5::0::X:", accepted: false },
    { before: "j", after: "l", args: ":5::0::X:", accepted: true },
    { before: "j", after: "_", args: ":x:", accepted: false },
    { before: "j", after: "g", args: ":x:", accepted: false },
    { before: "j", after: "Z", args: ":x:", accepted: false },
    { before: "g", after: "j", args: ":x:", accepted: true },
  ]) {
    for (const [prefix, suffix] of [
      ["print ", ":$after\n"],
      ['print "', ':$after"\n'],
      ["cat <<E\n", ":$after\nE\n"],
    ]) {
      const source = `${prefix}\${(${before}${args})x}${suffix}`;
      const changed = `${prefix}\${(${after}${args})x}${suffix}`;
      const edits = [
        { byte: prefix.length + 3, deleteBytes: before.length, insert: after },
      ];
      if (accepted) assert.equal(valid(source, edits), valid(changed));
      else {
        assert.equal(parse(source, edits).hasError, true, changed);
        assert.equal(parse(changed).hasError, true, changed);
      }
    }
  }
});

test("fixed flag option edits preserve validation across delimiters and enclosing contexts", () => {
  for (const { before, after, byte, deleteBytes, insert } of [
    {
      before: `\${(_::)x}`,
      after: `\${(_:x:)x}`,
      byte: 5,
      deleteBytes: 0,
      insert: "x",
    },
    {
      before: `\${(g:oce:)x}`,
      after: `\${(g:ocx:)x}`,
      byte: 7,
      deleteBytes: 1,
      insert: "x",
    },
    {
      before: `\${(Z[cCn])x}`,
      after: `\${(Z[cCx])x}`,
      byte: 7,
      deleteBytes: 1,
      insert: "x",
    },
    {
      before: `\${(pg:c:)x}`,
      after: `\${(pg:$opt:)x}`,
      byte: 6,
      deleteBytes: 1,
      insert: "$opt",
    },
    {
      before: `\${(pZ:n:)x}`,
      after: `\${(pZ:\\x6e:)x}`,
      byte: 6,
      deleteBytes: 1,
      insert: "\\x6e",
    },
    {
      before: `\${(g:c\\\ne:)x}`,
      after: `\${(g:c\\\nx:)x}`,
      byte: 8,
      deleteBytes: 1,
      insert: "x",
    },
  ]) {
    for (const [prefix, suffix] of [
      ["print ", " $after\n"],
      ['print "', ':$after"\n'],
      ["cat <<E\n", ":$after\nE\n"],
      ["print $(( ", " + 1 ))\n"],
    ]) {
      const source = prefix + before + suffix;
      const changed = prefix + after + suffix;
      const edit = { byte: prefix.length + byte, deleteBytes, insert };
      const undo = {
        byte: edit.byte,
        deleteBytes: insert.length,
        insert: before.slice(byte, byte + deleteBytes),
      };
      assert.equal(parse(changed).hasError, true, changed);
      assert.equal(parse(source, [edit]).hasError, true, changed);
      assert.equal(valid(changed, [undo]), valid(source), source);
      assert.equal(valid(source, [edit, undo]), valid(source), source);
    }
  }
});

test("global modifier edits recheck adjacency to a closed substitution", () => {
  for (const { before, after, byte, deleteBytes, insert, accepted } of [
    {
      before: `\${x:s/a/A/:G}`,
      after: `\${x:G}`,
      byte: 4,
      deleteBytes: 7,
      insert: "",
      accepted: false,
    },
    {
      before: `\${x:s/a/A/:G}`,
      after: `\${x:s/a/A/:h:G}`,
      byte: 11,
      deleteBytes: 0,
      insert: "h:",
      accepted: false,
    },
    {
      before: `\${x:s/a/A/:G}`,
      after: `\${x:s/a/A/:G:G}`,
      byte: 12,
      deleteBytes: 0,
      insert: ":G",
      accepted: false,
    },
    {
      before: `\${x:s/a/A/:G}`,
      after: `\${x:s/a/A/:fG}`,
      byte: 11,
      deleteBytes: 0,
      insert: "f",
      accepted: false,
    },
    {
      before: `\${x:s/a/A/:G}`,
      after: `\${x:s/a/A:G}`,
      byte: 9,
      deleteBytes: 1,
      insert: "",
      accepted: true,
    },
    {
      before: `\${x:s/a/A/:G}`,
      after: `\${x:s/a/A/:u}`,
      byte: 11,
      deleteBytes: 1,
      insert: "u",
      accepted: true,
    },
    {
      before: `\${x:1:s/a/A/:G}`,
      after: `\${x:1:G}`,
      byte: 6,
      deleteBytes: 7,
      insert: "",
      accepted: false,
    },
    {
      before: `\${x:s/a/\${y:s/b/B/:G}/:G}`,
      after: `\${x:s/a/\${y:G}/:G}`,
      byte: 12,
      deleteBytes: 7,
      insert: "",
      accepted: false,
    },
  ]) {
    for (const [prefix, suffix] of [
      ["print ", " $after\n"],
      ['print "', ':$after"\n'],
      ["cat <<E\n", ":$after\nE\n"],
      ["print $(( ", " + 1 ))\n"],
    ]) {
      const source = prefix + before + suffix;
      const changed = prefix + after + suffix;
      const edit = { byte: prefix.length + byte, deleteBytes, insert };
      const undo = {
        byte: edit.byte,
        deleteBytes: insert.length,
        insert: before.slice(byte, byte + deleteBytes),
      };
      if (accepted)
        assert.equal(valid(source, [edit]), valid(changed), changed);
      else {
        assert.equal(parse(changed).hasError, true, changed);
        assert.equal(parse(source, [edit]).hasError, true, changed);
      }
      assert.equal(valid(changed, [undo]), valid(source), source);
      assert.equal(valid(source, [edit, undo]), valid(source), source);
    }
  }
});

test("redirect edits distinguish unevaluated delimiter parameters from here string expansions", () => {
  for (const parameter of [
    `\${(_:x:)x}`,
    `\${(g:x:)x}`,
    `\${(Z:x:)x}`,
    `\${x:G}`,
  ]) {
    for (const word of [parameter, `$(print ${parameter})`]) {
      const source = `cat <<${word}\n`;
      const changed = `cat <<<${word}\n`;
      const edit = { byte: 6, deleteBytes: 0, insert: "<" };
      const undo = { byte: 6, deleteBytes: 1, insert: "" };
      assert.equal(parse(changed).hasError, true, changed);
      assert.equal(parse(source, [edit]).hasError, true, changed);
      assert.equal(valid(changed, [undo]), valid(source), source);
      assert.equal(valid(source, [edit, undo]), valid(source), source);
    }
  }
});

test("editing parameter source restores lexical state across flags and closing source", () => {
  const cases = [
    {
      before: `\${(j:"x:)y:-$(print \${(j*"*"*)x})}"}`,
      after: `\${(j:"x:)y:-$(case x in x) print \${(j*"*"*)x};; esac)}"}`,
      accepted: true,
    },
    {
      before: `\${(j:$(print A):)x}`,
      after: `\${(j:$(case x in x) print A;; esac):)x}`,
      accepted: true,
    },
    {
      before: `\${(j:$(print A):)x}`,
      after: `\${(j:$(cat <<'INNER'\n)\nINNER\nprint A\n):)x}`,
      accepted: true,
    },
    {
      before: `\${(j:$(ab):)x}`,
      after: `\${(j:$(a\\\nb):)x}`,
      accepted: true,
    },
    {
      before: `\${(j$X\\$Y$)x}`,
      after: `\${(j$X$Y$)x}`,
      accepted: false,
    },
    {
      before: `\${(j$X$Y$)x}`,
      after: `\${(j$X\\$Y$)x}`,
      accepted: true,
    },
    { before: `\${(j:"x:)x}"}`, after: `\${(j:"x:)x}Q"}`, accepted: true },
    { before: `\${(j:"x:)x}"}`, after: `\${(j:"x:)x"}`, accepted: false },
    { before: `\${(j:"x:)x"}`, after: `\${(j:"x:)x}"}`, accepted: true },
    { before: `\${(j:"x:)x}"}`, after: `\${(j:"x:)x:-Z}"}`, accepted: true },
    {
      before: `\${(j:"x:)x}"}`,
      after: `\${(j:"x:)\${(q)x}}"}`,
      accepted: true,
    },
    { before: `\${(j:\${x:)x}}`, after: `\${(j:\${x:)x}TAIL}`, accepted: true },
    { before: `\${(j:\${x:)x}}`, after: `\${(j:\${x:)x}`, accepted: false },
    { before: `\${(j:\${x:)x}`, after: `\${(j:\${x:)x}}`, accepted: true },
    { before: `\${(j:"x:)x}"}`, after: `\${(j:"x:)x}Q\\\n"}`, accepted: true },
    { before: `\${(j:":j:":)x}`, after: `\${(j:":j:a":)x}`, accepted: true },
    { before: `\${(j:":j:":)x}`, after: `\${(j:":j::)x}`, accepted: false },
    { before: `\${(j:":j::)x}`, after: `\${(j:":j:":)x}`, accepted: true },
    { before: `\${(j:':j:':)x}`, after: `\${(j:':j:a':)x}`, accepted: true },
    {
      before: `\${(j:\${sep:j:}:)x}`,
      after: `\${(j:\${sep:j:a}:)x}`,
      accepted: true,
    },
    {
      before: `\${(j:\${sep:j:}:)x}`,
      after: `\${(j:\${sep:j::)x}`,
      accepted: false,
    },
    {
      before: `\${(j:\${sep:j::)x}`,
      after: `\${(j:\${sep:j:}:)x}`,
      accepted: true,
    },
    {
      before: `\${(j:$(;):)x}`,
      after: `\${(j:$(print -n x):)x}`,
      accepted: true,
    },
    {
      before: `\${(j:'a\\\nb':)x}`,
      after: `\${(j:'a\\\ncb':)x}`,
      accepted: true,
    },
  ];
  for (const { before, after, accepted } of cases) {
    for (const { prefix, suffix } of [
      { prefix: "print ", suffix: "\nprint AFTER\n" },
      { prefix: 'print "', suffix: '"\nprint AFTER\n' },
      { prefix: "cat <<E\n", suffix: "\nE\nprint AFTER\n" },
    ]) {
      const source = prefix + before + suffix;
      const target = prefix + after + suffix;
      let start = 0;
      while (source[start] === target[start]) start++;
      let end = 0;
      while (
        end < source.length - start &&
        end < target.length - start &&
        source[source.length - end - 1] === target[target.length - end - 1]
      )
        end++;
      const fresh = parse(target);
      const edited = parse(source, [
        {
          byte: start,
          deleteBytes: source.length - end - start,
          insert: target.slice(start, target.length - end),
        },
      ]);
      assert.equal(fresh.hasError, !accepted, target + fresh.output);
      assert.equal(edited.hasError, fresh.hasError, target + edited.output);
      if (accepted) assert.equal(edited.output, fresh.output, target);
    }
  }
});

test("editing substring separators restores operand and modifier ownership", () => {
  const cases = [
    {
      before: `\${x::1}`,
      byte: 5,
      deleteBytes: 1,
      insert: "=",
      after: `\${x::=}`,
    },
    {
      before: `\${x::=}`,
      byte: 5,
      deleteBytes: 1,
      insert: "1",
      after: `\${x::1}`,
    },
    {
      before: `\${x:}`,
      byte: 4,
      deleteBytes: 0,
      insert: ":",
      after: `\${x::}`,
    },
    { before: `\${x::}`, byte: 4, deleteBytes: 1, insert: "", after: `\${x:}` },
    {
      before: `\${x:1:2}`,
      byte: 7,
      deleteBytes: 0,
      insert: ":h",
      after: `\${x:1:2:h}`,
    },
    {
      before: `\${x:1:2:h}`,
      byte: 7,
      deleteBytes: 2,
      insert: "",
      after: `\${x:1:2}`,
    },
    {
      before: `\${x:1:2:h}`,
      byte: 8,
      deleteBytes: 1,
      insert: "s/b/B/",
      after: `\${x:1:2:s/b/B/}`,
    },
    {
      before: `\${x:x}`,
      byte: 4,
      deleteBytes: 1,
      insert: "h",
      after: `\${x:h}`,
    },
    {
      before: `\${x:h}`,
      byte: 4,
      deleteBytes: 1,
      insert: "x",
      after: `\${x:x}`,
      error: true,
    },
    {
      before: `\${x:1:2:3}`,
      byte: 8,
      deleteBytes: 1,
      insert: "h",
      after: `\${x:1:2:h}`,
    },
    {
      before: `\${x::h}`,
      byte: 5,
      deleteBytes: 1,
      insert: "1",
      after: `\${x::1}`,
    },
    {
      before: `\${x::1}`,
      byte: 5,
      deleteBytes: 1,
      insert: "h",
      after: `\${x::h}`,
    },
    {
      before: `\${x:0:2:q}`,
      byte: 6,
      deleteBytes: 1,
      insert: `\${n:-2}`,
      after: `\${x:0:\${n:-2}:q}`,
    },
    {
      before: `\${x:0:2:q}`,
      byte: 6,
      deleteBytes: 1,
      insert: "$((1?2:3))",
      after: `\${x:0:$((1?2:3)):q}`,
    },
    {
      before: `\${x:1:2:h}`,
      byte: 8,
      deleteBytes: 0,
      insert: "\\\n",
      after: `\${x:1:2:\\\nh}`,
    },
    {
      before: `\${x::=}`,
      byte: 5,
      deleteBytes: 0,
      insert: "\\\n",
      after: `\${x::\\\n=}`,
    },
  ];
  for (const item of cases) {
    assert.equal(
      item.before.slice(0, item.byte) +
        item.insert +
        item.before.slice(item.byte + item.deleteBytes),
      item.after,
    );
    for (const { prefix, suffix } of [
      { prefix: "print ", suffix: "\nprint AFTER\n" },
      { prefix: 'print "', suffix: '"\nprint AFTER\n' },
      { prefix: "cat <<E\n", suffix: "\nE\nprint AFTER\n" },
    ]) {
      const source = prefix + item.before + suffix;
      const target = prefix + item.after + suffix;
      const fresh = parse(target);
      const edited = parse(source, [
        {
          byte: prefix.length + item.byte,
          deleteBytes: item.deleteBytes,
          insert: item.insert,
        },
      ]);
      assert.equal(fresh.hasError, item.error ?? false, target + fresh.output);
      assert.equal(edited.hasError, fresh.hasError, target + edited.output);
      if (!fresh.hasError) assert.equal(edited.output, fresh.output, target);
    }
  }
});

test("continuations preserve token roles across command and quoted contexts", () => {
  for (const { source, byte, node } of [
    {
      source: ": && :\n",
      byte: 3,
      node: "and_if",
    },
    {
      source: ": || :\n",
      byte: 3,
      node: "or_if",
    },
    {
      source: "cat >!out\n",
      byte: 5,
      node: "redirect_operator",
    },
    {
      source: "cat 2>out\n",
      byte: 5,
      node: "io_number",
    },
    {
      source: "cat <1-2>\n",
      byte: 6,
      node: "pattern_numeric_range_source",
    },
    {
      source: "cat <(:)\n",
      byte: 5,
      node: "process_substitution",
    },
    {
      source: "f() :\n",
      byte: 2,
      node: "function_definition",
    },
    {
      source: "((1))\n",
      byte: 1,
      node: "arithmetic_command",
    },
    {
      source: "((1))\n",
      byte: 4,
      node: "arithmetic_command",
    },
    {
      source: 'print "$(print x)"\n',
      byte: 8,
      node: "command_substitution",
    },
    {
      source: `print "\${x}"\n`,
      byte: 8,
      node: "parameter_expansion",
    },
  ]) {
    const continued = `${source.slice(0, byte)}\\\n${source.slice(byte)}`;
    const tree = valid(continued);
    assert.ok(tree.includes(node), continued);
    assert.match(tree, /line_continuation/);
    assert.equal(
      valid(source, [{ byte, deleteBytes: 0, insert: "\\\n" }]),
      tree,
    );
    assert.equal(
      valid(continued, [{ byte, deleteBytes: 2, insert: "" }]),
      valid(source),
    );
  }
});

test("editing escaped delimiter bytes switches between EOF body and a matching terminator", () => {
  for (const { initial, repaired, terminator } of [
    { initial: "$'\\xFF'", repaired: "$'\\xC3\\xBF'", terminator: "ÿ" },
    { initial: "$'\\377'", repaired: "$'\\303\\277'", terminator: "ÿ" },
    { initial: "$'\\xC3'", repaired: "$'\\xC3'$'\\277'", terminator: "ÿ" },
    { initial: "$'\\C-é'", repaired: "$'\\cé'", terminator: "cé" },
  ]) {
    const tail = `\nbody\n${terminator}\nprint AFTER\n`;
    const before = `cat <<${initial}${tail}`;
    const after = `cat <<${repaired}${tail}`;
    const beforeTree = valid(before);
    const afterTree = valid(after);
    assert.match(beforeTree, /1:0 +- +4:0 +quoted_here_document_text/);
    assert.doesNotMatch(beforeTree, /here_document_end|literal `print`/);
    assert.match(afterTree, /1:0 +- +2:0 +quoted_here_document_text/);
    assert.match(afterTree, /2:0 +- +3:0 +here_document_end/);
    assert.ok(afterTree.includes(`here_document_end_text \`${terminator}\``));
    assert.match(afterTree, /3:0 +- +3:5 +literal `print`/);
    const repair = {
      byte: 6,
      deleteBytes: Buffer.byteLength(initial),
      insert: repaired,
    };
    const restore = {
      byte: 6,
      deleteBytes: Buffer.byteLength(repaired),
      insert: initial,
    };
    assert.equal(valid(before, [repair]), afterTree);
    assert.equal(valid(after, [restore]), beforeTree);
    assert.equal(valid(before, [repair, restore]), beforeTree);
  }
});

test("case separator edits preserve terminator tokens and following items", () => {
  for (const { open, close } of [
    { open: "in", close: "esac" },
    { open: "in", close: "}" },
    { open: "{", close: "esac" },
    { open: "{", close: "}" },
  ]) {
    for (const terminator of [";;", ";&", ";|"]) {
      const source = `case x ${open} x) :${terminator} y) :;; ${close}\n`;
      const byte = source.indexOf(terminator) + terminator.length;
      const fresh = valid(source);
      for (const insert of [";", "; ; # BETWEEN\n"]) {
        const changed = source.slice(0, byte) + insert + source.slice(byte);
        const add = { byte, deleteBytes: 0, insert };
        const remove = { byte, deleteBytes: insert.length, insert: "" };
        assert.equal(valid(source, [add]), valid(changed));
        assert.equal(valid(changed, [remove]), fresh);
        assert.equal(valid(source, [add, remove]), fresh);
      }
      const invalid = `${source.slice(0, byte)};;${source.slice(byte)}`;
      assert.equal(
        parse(source, [{ byte, deleteBytes: 0, insert: ";;" }]).hasError,
        true,
      );
      assert.equal(
        valid(invalid, [{ byte, deleteBytes: 2, insert: "" }]),
        fresh,
      );
    }
  }
});

test("case item terminator removal preserves matching tails and repairs mixed endings", () => {
  for (const open of ["in", "{"]) {
    for (const close of ["esac", "}"]) {
      for (const body of ["", ":;", "{ :; }"]) {
        for (const terminator of [";;", ";&", ";|"]) {
          const head = `case x ${open} x) ${body} `;
          const source = `${head}${terminator} ${close}`;
          const omitted = `${head} ${close}`;
          const remove = {
            byte: head.length,
            deleteBytes: terminator.length,
            insert: "",
          };
          const restore = {
            byte: head.length,
            deleteBytes: 0,
            insert: terminator,
          };
          if ((open === "in") === (close === "esac")) {
            assert.equal(valid(source, [remove]), valid(omitted), omitted);
          } else {
            assert.equal(parse(omitted).hasError, true, omitted);
            assert.equal(parse(source, [remove]).hasError, true, omitted);
          }
          assert.equal(valid(omitted, [restore]), valid(source), source);
          assert.equal(valid(source, [remove, restore]), valid(source), source);
        }
      }
    }
  }
});

for (const keyword of ["for", "select"]) {
  test(`${keyword} word header completion distinguishes comments and terminators from word source`, () => {
    const header = `${keyword} x in a b :`;
    for (const { ending, complete } of [
      { ending: "\n", complete: true },
      { ending: ";", complete: true },
      { ending: " # comment", complete: true },
      { ending: " # comment\n", complete: true },
      { ending: " ", complete: false },
      { ending: "#comment", complete: false },
      { ending: " '#comment'", complete: false },
      { ending: "\\\n", complete: false },
    ]) {
      const source = header + ending;
      const add = { byte: header.length, deleteBytes: 0, insert: ending };
      const remove = {
        byte: header.length,
        deleteBytes: ending.length,
        insert: "",
      };
      assert.equal(parse(source).hasError, !complete, source);
      assert.equal(parse(header, [add]).hasError, !complete, source);
      assert.equal(parse(source, [remove]).hasError, true, header);
      if (complete) assert.equal(valid(header, [add]), valid(source));
    }
  });
}

test("select header and body edits preserve classification across command sources", () => {
  for (const [prefix, suffix] of [
    ["", ""],
    ["f() { ", "; }\n"],
    ['echo "$(', ')"\n'],
    ["a[$(", ")]=x\n"],
    ["cat <<$(", ")\nBODY\n"],
  ]) {
    for (const { before, removed, inserted, after } of [
      { before: "select x", removed: "", inserted: " :", after: "select x :" },
      {
        before: "select x (a b)",
        removed: "",
        inserted: " :",
        after: "select x (a b) :",
      },
      {
        before: "select x (a b)",
        removed: " (",
        inserted: "\n(",
        after: "select x\n(a b)",
      },
      {
        before: "select x (a b) :",
        removed: "(a b)",
        inserted: "in a b;",
        after: "select x in a b; :",
      },
      {
        before: "select x (a b) :",
        removed: ":",
        inserted: "do :; done",
        after: "select x (a b) do :; done",
      },
      {
        before: "select x (a b)",
        removed: "(a b)",
        inserted: "((a + b))",
        after: "select x ((a + b))",
      },
    ]) {
      const byte = removed ? before.indexOf(removed) : before.length;
      assert.ok(byte >= 0);
      assert.equal(
        before.slice(0, byte) + inserted + before.slice(byte + removed.length),
        after,
      );
      const source = prefix + before + suffix;
      const changed = prefix + after + suffix;
      const edit = {
        byte: prefix.length + byte,
        deleteBytes: removed.length,
        insert: inserted,
      };
      const undo = {
        byte: prefix.length + byte,
        deleteBytes: inserted.length,
        insert: removed,
      };
      const initial = valid(source);
      assert.equal(valid(source, [edit]), valid(changed), changed);
      assert.equal(valid(changed, [undo]), initial, source);
      assert.equal(valid(source, [edit, undo]), initial, source);
    }
  }
});

test("select body insertion keeps following control operators outside the loop", () => {
  for (const header of ["select x", "select x (a b)", "select x in a b;"]) {
    for (const operator of ["&&", "||", "|", "|&", "&", "&!", "&|"]) {
      const body = " { :; }";
      const source = `${header} ${operator} :`;
      const changed = `${header}${body} ${operator} :`;
      const initial = valid(source);
      const expected = valid(changed);
      for (const [text, output] of [
        [source, initial],
        [changed, expected],
      ]) {
        const loop = sourceNodes(output, text).find(
          (node) => node.type === "select_clause",
        );
        assert.ok(loop && loop.end <= text.indexOf(operator), output);
      }
      assert.equal(
        valid(source, [{ byte: header.length, deleteBytes: 0, insert: body }]),
        expected,
        changed,
      );
      assert.equal(
        valid(changed, [
          { byte: header.length, deleteBytes: body.length, insert: "" },
        ]),
        initial,
        source,
      );
    }
  }
});

test("select EOF comment edits preserve header and body boundaries", () => {
  for (const header of ["select x", "select x (a b)", "select x in a b :"]) {
    const source = `${header} # tail`;
    const changed = `${source}\n`;
    const edit = { byte: source.length, deleteBytes: 0, insert: "\n" };
    const undo = { byte: source.length, deleteBytes: 1, insert: "" };
    assert.equal(valid(source, [edit]), valid(changed), changed);
    assert.equal(valid(changed, [undo]), valid(source), source);
    assert.equal(valid(source, [edit, undo]), valid(source), source);
  }
});

test("foreach header edits preserve body forms across command sources", () => {
  for (const [prefix, suffix] of [
    ["", "\n"],
    ["f() { ", "; }\n"],
    ['echo "$(', ')"\n'],
    ["echo `", "`\n"],
    ["a[$(", ")]=x\n"],
    ["cat <<$(", ")\nBODY\n"],
  ]) {
    for (const { before, removed, inserted, after } of [
      {
        before: "foreach x (a b) :; end",
        removed: "(a b)",
        inserted: "in a b;",
        after: "foreach x in a b; :; end",
      },
      {
        before: "foreach x (a b) { :; }",
        removed: "(a b)",
        inserted: "in a b;",
        after: "foreach x in a b; { :; }",
      },
      {
        before: "foreach x (a b) do :; done",
        removed: "(a b)",
        inserted: "in a b;",
        after: "foreach x in a b; do :; done",
      },
      {
        before: "foreach x in a b; :; end",
        removed: " in a b",
        inserted: "",
        after: "foreach x; :; end",
      },
      {
        before: "foreach x (a b) { :; }",
        removed: "(a b) ",
        inserted: "",
        after: "foreach x { :; }",
      },
      {
        before: "foreach x (a b) do :; done",
        removed: "(a b) ",
        inserted: "",
        after: "foreach x do :; done",
      },
      {
        before: "foreach x # header\nin a b; :; end",
        removed: "x # header",
        inserted: "x; # header",
        after: "foreach x; # header\nin a b; :; end",
      },
      {
        before: "foreach x (a) case x in x) :;; esac; end",
        removed: "(a)",
        inserted: "in a;",
        after: "foreach x in a; case x in x) :;; esac; end",
      },
      {
        before: "foreach x in a; :; end",
        removed: "x in",
        inserted: "x # name\nin",
        after: "foreach x # name\nin a; :; end",
      },
      {
        before: "foreach x in a; :; end",
        removed: "a;",
        inserted: "a # header\n",
        after: "foreach x in a # header\n :; end",
      },
      {
        before: "foreach x in a b :; end",
        removed: "b :",
        inserted: "b; :",
        after: "foreach x in a b; :; end",
      },
    ]) {
      const byte = before.indexOf(removed);
      assert.ok(byte >= 0);
      assert.equal(
        before.slice(0, byte) + inserted + before.slice(byte + removed.length),
        after,
      );
      const source = prefix + before + suffix;
      const changed = prefix + after + suffix;
      const edit = {
        byte: prefix.length + byte,
        deleteBytes: removed.length,
        insert: inserted,
      };
      const undo = {
        byte: prefix.length + byte,
        deleteBytes: inserted.length,
        insert: removed,
      };
      const initial = valid(source);
      assert.equal(valid(source, [edit]), valid(changed), changed);
      assert.equal(valid(changed, [undo]), initial, source);
      assert.equal(valid(source, [edit, undo]), initial, source);
    }
  }
});

for (const { name, head, brace } of [
  { name: "a brace if", head: "if [[ x ]] { :; }", brace: true },
  {
    name: "a then to brace transition",
    head: "if false; then :; elif [[ x ]] { :; }",
    brace: true,
  },
  {
    name: "consecutive brace branches",
    head: "if [[ x ]] { :; } elif [[ x ]] { :; }",
    brace: true,
  },
  {
    name: "a brace to then transition",
    head: "if [[ x ]] { :; } elif false; then :;",
    brace: false,
  },
  {
    name: "consecutive then branches",
    head: "if false; then :; elif false; then :;",
    brace: false,
  },
]) {
  test(`${name} uses its final branch to determine the terminator`, () => {
    for (const { tail, accepted } of [
      { tail: "", accepted: false },
      { tail: " ", accepted: false },
      { tail: "\n", accepted: brace },
      { tail: "\nprint AFTER\n", accepted: brace },
      { tail: "; print AFTER\n", accepted: brace },
      { tail: " # comment", accepted: brace },
      { tail: " # comment\nprint AFTER\n", accepted: brace },
      { tail: " fi", accepted: true },
      { tail: " fi > /dev/null | :", accepted: true },
      { tail: " else { :; }", accepted: brace },
      { tail: " else { :; } fi", accepted: !brace },
      { tail: " else\n{ :; }", accepted: brace },
      { tail: " else\n{ :; } fi", accepted: !brace },
      { tail: " else; { :; }", accepted: brace },
      { tail: " else; { :; } fi", accepted: !brace },
      { tail: " else # comment\n{ :; }", accepted: brace },
      { tail: " else # comment\n{ :; } fi", accepted: !brace },
      { tail: " else :; fi", accepted: true },
      { tail: " else > /dev/null { :; } fi", accepted: true },
      { tail: " else > /dev/null { :; }", accepted: false },
      { tail: " > /dev/null\n", accepted: false },
      { tail: " | :", accepted: false },
      { tail: " && :", accepted: false },
      { tail: " &", accepted: false },
      { tail: "\nfi", accepted: !brace },
    ]) {
      const source = head + tail;
      if (!accepted) {
        assert.equal(parse(source).hasError, true, source);
        continue;
      }
      const nodes = sourceNodes(valid(source), source);
      const after = nodes.find(
        (node) => node.type === "simple_command" && node.text === "print AFTER",
      );
      if (source.includes("print AFTER")) {
        assert.ok(after, source);
        assert.ok(
          nodes.every(
            (node) => node.type !== "if_clause" || node.end <= after.start,
          ),
          source,
        );
      }
    }
  });
}

test("a brace if requires its own terminator before an enclosing closer", () => {
  for (const [prefix, suffix] of [
    ["{ ", " }"],
    ["(", ")"],
    ["x=$(", ")"],
    ["x=`", "`"],
    ["case x in x) ", ";; esac"],
    ["case x in x) ", ";& esac"],
    ["case x in x) ", ";| esac"],
  ]) {
    const head = `${prefix}if false; then :; elif [[ x ]] { :; }`;
    assert.equal(parse(head + suffix).hasError, true, head + suffix);
    valid(`${head}\n${suffix}`);
    valid(`${head} fi${suffix}`);
  }
});

test("mixed inner branches leave following elif and else clauses with the outer if", () => {
  for (const ending of [";", " fi;", " else { print INNER_ELSE; };"]) {
    const inner = `if false; then :; elif [[ x ]] { print INNER; }${ending}`;
    const source = `if false; then ${inner} elif false; then print OUTER_ELIF; else print OUTER_ELSE; fi\nprint AFTER\n`;
    const nodes = sourceNodes(valid(source), source);
    const clauses = nodes.filter((node) => node.type === "if_clause");
    assert.equal(clauses.length, 2, source);
    const [outer, nested] = clauses;
    assert.equal(nested.start, source.indexOf(inner), source);
    assert.equal(nested.end, source.indexOf(inner) + inner.length - 1, source);
    assert.equal(outer.start, 0, source);
    for (const label of ["OUTER_ELIF", "OUTER_ELSE"]) {
      const command = nodes.find(
        (node) =>
          node.type === "simple_command" && node.text === `print ${label}`,
      );
      assert.ok(command, source);
      assert.ok(nested.end < command.start && command.end < outer.end, source);
    }
    assert.ok(outer.end < source.indexOf("print AFTER"), source);
  }
});

test("mixed if branches keep their owners inside command source lookahead", () => {
  const body =
    "if [[ x ]] { :; } elif false; then :; elif [[ x ]] { :; } else { :; }";
  for (const [prefix, suffix] of [
    ["a[$(", ")]=x\n"],
    ["a[`", "`]=x\n"],
    ["print ${x[$(", ")]}\n"],
    ["cat <<$(", `)\nBODY\n$(${body})\n`],
  ]) {
    const source = `${prefix}${body}${suffix}print AFTER\n`;
    const nodes = sourceNodes(valid(source), source);
    const clauses = nodes.filter((node) => node.type === "if_clause");
    assert.equal(clauses.length, 1, source);
    assert.equal(clauses[0].text, body, source);
    assert.equal(
      nodes.filter((node) => node.type === "if_branch").length,
      3,
      source,
    );
    assert.equal(
      nodes.filter((node) => node.type === "else_clause").length,
      1,
      source,
    );
  }
});

test("compound body closer removal and repair preserve delimiter requirements", () => {
  for (const [source, closing] of [
    ["if false; then :;", " fi"],
    ["if [[ x ]] { :;", " };"],
    ["if [[ x ]] (:", ")"],
    ["if :; then :; elif false; then :;", " fi"],
    ["select x (a) do :;", " done"],
    ["select x (a) { :;", " }"],
    ["select x; (:", ")"],
    ["foreach x in a; :;", " end"],
    ["foreach x in a; do :;", " done"],
    ["foreach x in a; { :;", " }"],
    ["foreach x; :;", " end"],
    ["foreach x do :;", " done"],
    ["foreach x { :;", " }"],
  ]) {
    const complete = source + closing;
    assert.equal(parse(source).hasError, true, source);
    assert.equal(
      valid(source, [{ byte: source.length, deleteBytes: 0, insert: closing }]),
      valid(complete),
      complete,
    );
    assert.equal(
      parse(complete, [
        { byte: source.length, deleteBytes: closing.length, insert: "" },
      ]).hasError,
      true,
      source,
    );
  }
});

test("editing square arithmetic brackets preserves their owner and closing boundary", () => {
  for (const { before, after, byte, deleteBytes, insert, accepted } of [
    {
      before: '$[1"["2]]',
      after: '$[1"["2]',
      byte: 8,
      deleteBytes: 1,
      insert: "",
      accepted: false,
    },
    {
      before: "$[(1[)]]",
      after: "$[(1[)]",
      byte: 7,
      deleteBytes: 1,
      insert: "",
      accepted: false,
    },
    {
      before: "$[(1[)]]",
      after: "$[(1\\[)]]",
      byte: 4,
      deleteBytes: 0,
      insert: "\\",
      accepted: true,
    },
    {
      before: "$[(1[) + $[2]]]",
      after: "$[(1[) + $[3]]]",
      byte: 11,
      deleteBytes: 1,
      insert: "3",
      accepted: true,
    },
    {
      before: "$[1\\[2]]",
      after: "$[1[2]]",
      byte: 3,
      deleteBytes: 1,
      insert: "",
      accepted: true,
    },
    {
      before: "$[1@[]]",
      after: "$[1@\\\n[]]",
      byte: 4,
      deleteBytes: 0,
      insert: "\\\n",
      accepted: true,
    },
  ]) {
    for (const [prefix, suffix] of [
      ["print ", " tail\nprint after\n"],
      ["print $((", " + 1))\n"],
      ["a[", "]=x\n"],
      ["print ${(s:", ":)x}\n"],
    ]) {
      const source = prefix + before + suffix;
      const changed = prefix + after + suffix;
      const edit = { byte: prefix.length + byte, deleteBytes, insert };
      const undo = {
        byte: edit.byte,
        deleteBytes: insert.length,
        insert: before.slice(byte, byte + deleteBytes),
      };
      const initial = valid(source);
      if (accepted) assert.equal(valid(source, [edit]), valid(changed));
      else {
        assert.equal(
          parse(source, [edit]).hasError,
          parse(changed).hasError,
          changed,
        );
      }
      assert.equal(valid(changed, [undo]), initial);
      assert.equal(valid(source, [edit, undo]), initial);
    }
  }
});

for (const source of [
  "print 'unfinished",
  'print "unfinished',
  "print $(unfinished",
]) {
  test(`incomplete source reports standard recovery: ${JSON.stringify(source)}`, () => {
    assert.equal(parse(source).hasError, true);
  });
}

test("subscript candidates retain native expression fields without inferring declarations", () => {
  for (const declaration of ["", "typeset -a a; ", "typeset -A a; "]) {
    const source = `${declaration}print \${a[1+2&3]}\n`;
    const nodes = sourceNodes(valid(source), source);
    assert.deepEqual(
      nodes
        .filter(({ type }) => type.startsWith("arithmetic_candidate_"))
        .map(({ type, field, text }) => [type, field, text]),
      [
        ["arithmetic_candidate_binary_expression", "candidate", "1+2&3"],
        ["arithmetic_candidate_number", "left", "1"],
        ["arithmetic_candidate_operator", "operator", "+"],
        ["arithmetic_candidate_binary_expression", "right", "2&3"],
        ["arithmetic_candidate_number", "left", "2"],
        ["arithmetic_candidate_operator", "operator", "&"],
        ["arithmetic_candidate_number", "right", "3"],
      ],
    );
  }
});

test("explicit key candidate edits preserve first bracket boundaries and shell substitutions", () => {
  for (const [before, after] of [
    ["1+2", "1+2*3"],
    ["a=0+1", "a=0+$x"],
    ["a+++1", "a+++$x"],
    ["-1+2", "-1+$x"],
    ["1+(2*3)", "1+(2*$x)"],
    ["x[2", "x[3+1"],
    ["(r)x", "(r)$x"],
    ["foo<(:)", "foo<(print x)"],
    ["1+2", "1+$((2*3))"],
    ["1+2", "1+"],
    ["$name", "$name:s/a/b"],
    ["$name:h", "$name:t"],
    ["'quoted]key'", '"quoted]key"'],
  ]) {
    for (const declaration of ["typeset -a a; ", "typeset -A a; "]) {
      const open = `${declaration}a=([`;
      const close = "]=value untouched)\nprint after\n";
      const source = open + before + close;
      const changed = open + after + close;
      const edit = {
        byte: open.length,
        deleteBytes: before.length,
        insert: after,
      };
      const undo = {
        byte: edit.byte,
        deleteBytes: after.length,
        insert: before,
      };
      const output = valid(changed);
      assert.equal(valid(source, [edit]), output, changed);
      assert.equal(valid(source, [edit, undo]), valid(source), source);
      assert.equal(
        sourceNodes(output, changed).find(
          ({ type }) => type === "array_key_source",
        )?.text,
        after,
      );
    }
  }
});

test("arithmetic argument candidate edits preserve call boundaries and explicit arithmetic expansions", () => {
  for (const [before, after] of [
    ["1+2", "1+2&3,4"],
    ["1+2", "1+$x"],
    ["a=0+1", "a=0+$x"],
    ["a++ + 1", "a++ + $x"],
    ["-1+2", "-1+$x"],
    ["1+(2*3)", "1+(2*$x)"],
    ["1+2", "1+$((2*3))"],
    ["1+2", "g(1+2)"],
    ["1+2", "1+"],
    ["(1+2)", "(1+)"],
    ["1+2", '"text+1"'],
    ["1+2", ""],
  ]) {
    for (const [open, close] of [
      ["((f(", ")))\n"],
      ["print $((f(", ")))\n"],
      ["print $[f(", ")]\n"],
      ["cat <<END\n$((f(", ")))\nEND\n"],
      ["print `print $((f(", ")))`\n"],
      ["for ((f(", ");0;)) do :; done\n"],
    ]) {
      const source = open + before + close;
      const changed = open + after + close;
      const edit = {
        byte: open.length,
        deleteBytes: before.length,
        insert: after,
      };
      const undo = {
        byte: edit.byte,
        deleteBytes: after.length,
        insert: before,
      };
      assert.equal(valid(source, [edit]), valid(changed), changed);
      assert.equal(valid(source, [edit, undo]), valid(source), source);
    }
  }
  const source = "((f(1+$((2*3)))))\n";
  const nodes = sourceNodes(valid(source), source);
  assert.deepEqual(
    nodes
      .filter(({ type }) => type.endsWith("binary_expression"))
      .map(({ type, field, text }) => [type, field, text]),
    [
      ["arithmetic_candidate_binary_expression", "candidate", "1+$((2*3))"],
      ["arithmetic_binary_expression", "expression", "2*3"],
    ],
  );
});

test("subscript pattern candidates follow language syntax and preserve explicit expansions once", () => {
  const source = `print "\${a[(r)^foo~bar#]}" \${a[(r)foo\${part}#]} \${a[(r)(#i)foo]}\n`;
  const nodes = sourceNodes(valid(source), source);
  assert.deepEqual(
    nodes
      .filter(({ type }) => type === "pattern_candidate_operator")
      .map(({ text }) => text),
    language.name === "zsh_extended_glob" ? ["^", "~", "#"] : [],
  );
  assert.equal(
    nodes.filter(({ type }) => type === "pattern_candidate_flags").length,
    language.name === "zsh_extended_glob" ? 1 : 0,
  );
  assert.equal(
    nodes.filter(
      ({ type, text }) => type === "parameter_expansion" && text === `\${part}`,
    ).length,
    1,
  );
  assert.equal(
    nodes.filter(
      ({ type, text }) =>
        type === "pattern_candidate_operator_source" && text === "#",
    ).length,
    language.name === "zsh_extended_glob" ? 1 : 0,
  );
  assert.equal(
    nodes.filter(({ type }) => type === "subscript_pattern_candidate").length,
    3,
  );
});

test("repairing incomplete bodies and separators matches complete fresh parsing", () => {
  for (const { source, byte, insert } of [
    {
      source: "function f { :;\n",
      byte: 15,
      insert: "}",
    },
    {
      source: "if true then :; fi\n",
      byte: 7,
      insert: ";",
    },
  ]) {
    assert.equal(parse(source).hasError, true, source);
    const repaired = source.slice(0, byte) + insert + source.slice(byte);
    assert.equal(
      valid(source, [{ byte, deleteBytes: 0, insert }]),
      valid(repaired),
    );
  }
});
