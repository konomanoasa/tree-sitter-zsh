import assert from "node:assert/strict";
import { test } from "node:test";
import { parse, valid } from "./support/parser.js";

const sources = [
  "in\n",
  "always\n",
  "function fi { :; }\n",
  "f fi() { :; }\n",
  "if true; then function fi { :; }; fi\n",
  "if true; then function else { :; }; fi\n",
  "while false; do function done { :; }; done\n",
  "command fi\n",
  "noglob fi\n",
  "noglob nocorrect print yes\n",
  "nocorrect nocorrect print yes\n",
  "function nocorrect { :; }\n",
  "for fi in a; do :; done\n",
  "for do in a; do :; done\n",
  "for x in if then fi; do :; done\n",
  "repeat 1 if ((1)) print yes\n",
  "repeat if print never\n",
  ": <<< if\n",
  "< if print x\n",
  "> /dev/null if ((1)) print yes\n",
  "print $(if ((1)) print yes) fi\n",
  "[[ if == if ]]\n",
  "a=(if then fi)\n",
  "a=(\nif\nthen\n)\n",
  "a=(x;fi)\n",
  "[[\nif == if\n]]\n",
  "((\nif + 1\n))\n",
  "case x { if) :;; }\n",
  "case x in a) { :; };; if) :;; esac\n",
  "[[ a == ! ]]\n",
  "a=( ! [[ {x} )\n",
  "> /dev/null time print yes\n",
  "time > /dev/null print yes\n",
  "if ((1)) { print yes; }\n",
  "if ((1)) { print yes; } else { print no; }\n",
  "if ((1)) ! { print yes; } | print out\n",
  "if time { print yes; } then print then; fi\n",
  "while time ((0)) do :; done\n",
  "(if ((1)) { print yes; };)\n",
  "if true; then if ((1)) { print yes; }; fi\n",
  "typeset x+=1 a[1]+=(x)\n",
  "typeset x=1 a[1]=x\n",
  "typeset a-b=(x y)\n",
  `print \${x:s/a/~/} \${x:s/a/pre~post/}\n`,
  `print \${x/a/~} \${x/a/pre~post}\n`,
  "print $x:s/(a|b)/*/\n",
  'print $x:s/a/"$replacement"/\n',
  "print $x:s/[a-z]/{b,c}/\n",
  "print $x:s/<1-2>/b/\n",
  "print $x:s/a/(b|c)/ $x:s/a/<1-2>/\n",
  "((f((1 + 2)) + (3 * 4)))\n",
  `print \${(f)"$(print x)"}\n`,
  `print "\${(@f)"$(print x)"}"\n`,
  "while ((0)) { print never; } | print out\n",
  "until ((1)) { print never; } | print out\n",
  "repeat 0 { print never; } | print out\n",
  "for x in; { print never; } | print out\n",
  "for x () { print never; } | print out\n",
  "for ((;0;)) { print never; } | print out\n",
  "select x in; { print never; } | print out\n",
  `print \${x:fs/a/b/} \${x:F:2:s/a/b/}\n`,
  `print \${x:W:,:u} \${x:F(2)s/a/b/}\n`,
  `print \${x:W[,]u} \${x:F<2>s/a/b/}\n`,
  "print $x:wu $x:F:2:s/a/b/\n",
  "cat <<$(print 'E')\n$x\n$(print 'E')\nprint after\n",
  "cat <<\"$(print 'E')\"\n$x\n$(print 'E')\nprint after\n",
  `cat <<\${x:-"E"}\n$x\n\${x:-E}\nprint after\n`,
  "cat <<E('foo')\n$x\nE(foo)\nprint after\n",
  "cat <<E(foo bar)\nbody\nE(foo bar)\nprint after\n",
  "cat <<$(a(b)c)\nbody\n$(a(b)c)\nprint after\n",
  "cat <<$(echo a\\\nb)\nbody\n",
  `cat <<\${x:-a;b}\nbody\n\${x:-a;b}\nprint after\n`,
  "function -T f { print yes; }\n",
  "function { print yes; } a b\n",
  "function f; print inside && print after\n",
  "function f\nprint inside && print after\n",
  "function f() print inside && print after\n",
  "f() print inside && print after\n",
  "function f() { print inside; } && print after\n",
  "function f ( ) { :; }\n",
  "> /dev/null { print yes; }\n",
  "> /dev/null (print yes)\n",
  "> /dev/null f() { print yes; }\n",
  "f() > /dev/null { print yes; }\n",
  "if true; then print yes; fi >/dev/null\n",
  "f() { print yes; } >/dev/null\n",
  "print {}\n",
  "print ~ ~/file ~user/file ~+ ~-2 ~[project]/file =cat\n",
  "p=~/bin:~user/bin:=cat\n",
  `print \${path:-~user/bin}\n`,
  "a=([1]=x [2]=y [3]=)\n",
  "a=(x;y;[3]=z)\n",
  "a=([1]=~/file)\n",
  "x=pre(a|b)post\n",
  "print ((^x)) pre(g)(.N)\n",
  "case x in x) print yes;; esac\n",
  "case x in (x|y) print yes;; esac\n",
  "case x in ((x|y)) print yes;; esac\n",
  "case 'a b' in (a b) print yes;; esac\n",
  "case x in a | x) print yes;; esac\n",
  "case x in x) print yes; esac\n",
  "case x { x) print yes;; }\n",
  "case x in x) print one;& y) print two;| x) print three;; esac\n",
  "case x in x )\nprint yes\nesac\n",
  "case x in\nesac\n",
  "case x in (esac) print no;; *) print yes;; esac\n",
  "print *.zsh a?b [!a-z[:digit:]] [a b]\n",
  "print [a-z] [^x] []a] [-a] [a-]\n",
  "print (a|b) pre(a|b)post a(b)\n",
  "print foo(.N) foo(#qN) (#i)foo foo~bar foo##\n",
  "print <1-20> <-5> <3-> <->\n",
  "print {foo} {a,b} {1..10..2} {,x,} pre{one,{two,three}}post\n",
  "print *.\\\nzsh [a-\\\nz]\n",
  "[[ $name == a*(b|c) ]]\n",
  `print \${name##*.} \${name/[a-z]/?}\n`,
  "builtin typeset x=1\n",
  "command -pv print x\n",
  'command "-v" print\n',
  'exec "-a" "$0" print x\n',
  "exec -cl -a argv0 print x\n",
  'exec -a "$0" command -- print x\n',
  "noglob print '*'\n",
  "nocorrect x=1 print $x\n",
  "exec\n",
  "exec() { :; }\n",
  "exec () { :; }\n",
  "exec f() { :; }\n",
  "exec -a() { :; }\n",
  "noglob f() { :; }\n",
  "function exec { :; }\n",
  "[[ -n $x && $x == yes ]]\n",
  "[[ $x =~ (a|b) ]]\n",
  "[[ $x =~ [ ]]\n",
  '[[ $x =~ pre"(quoted)"$part(suffix) ]]\n',
  "[[ ! ( -f file || -d dir ) ]]\n",
  "[[ 1 -eq 2 || a < b ]]\n",
  "[[ -n ]]\n",
  "[[ -module-condition $value ]]\n",
  "[[ $a -module-condition $b ]]\n",
  "if [[ $x == y ]]; then print yes; fi\n",
  "if [[ x ]] print yes\n",
  "if (true) print yes\n",
  "if { true; } print yes\n",
  "if true && [[ x ]] print yes\n",
  "if [[ x ]] { print yes; } else { print no; }\n",
  "while ((0)) print never\n",
  "until ((1)) print never\n",
  "print \"|&\" '|'\n",
  "cat <<E\n|& body\nE\n",
  "((x = 1 + 2 * 3))\n",
  "((1+))\n",
  "(( 1 + (2 * 3) ))\n",
  "(( x += sin(1, 2) ))\n",
  "(( 16#ff + 0xff + .5e-2 + 1_000 ))\n",
  "(( [#16_4] 65536 ** 2 ))\n",
  "((a[$index]++))\n",
  "((a[1]++))\n",
  "((##a + #name))\n",
  "print $((1+)) $[1+]\n",
  "print $((x + $(print 1)))\n",
  'print "$((1 + $value))"\n',
  "for ((i=0;i<3;i++)); do print $i; done\n",
  "for ((;;)) { break; }\n",
  "((1) )\n",
  'print $ a$ "$" "a$"\n',
  "a[1]\n",
  "x=1 print $x\n",
  "x=\n",
  'a=(one "two three")\n',
  "typeset -a a=(x y)\n",
  `print \${x:-a b}\n`,
  `print \${#name}\n`,
  `print \${x%%suffix}\n`,
  "print $#name\n",
  "print $a[1]\n",
  `print \${a[1]}\n`,
  "a[1]=x\n",
  `print \${(q)x}\n`,
  `print \${(@kv)x}\n`,
  `print \${(s.:.)x}\n`,
  `print \${(s:):)x}\n`,
  `print \${(l:8::0::x:)x}\n`,
  `print \${(j[;])x}\n`,
  `print \${(ps.$sep.)x}\n`,
  `print \${(P)$(print x)}\n`,
  `print \${(g(oe))x}\n`,
  `print \${^x}\n`,
  `print \${a[(r)foo*]}\n`,
  `print \${a[(n:2:r)foo]}\n`,
  `print \${a[1,(r)foo]}\n`,
  `print \${a[1+(2*3)]}\n`,
  `print \${a[b[1]]}\n`,
  `print \${x/a/b}\n`,
  `print \${x//a/b}\n`,
  `print \${x:/a/b}\n`,
  `print \${x/foo/}\n`,
  `print \${x/foo}\n`,
  `print \${x:1:2}\n`,
  `print \${x: -2}\n`,
  `print \${x:$offset:$length}\n`,
  `print \${x:h:t}\n`,
  `print \${x:h3}\n`,
  `print \${x:s/foo/bar/}\n`,
  `print \${x:gs|foo|bar|}\n`,
  `print \${x:s/)/x/}\n`,
  `print \${x:s/a/$replacement/}\n`,
  `print \${x:s/a/b}\n`,
  "print $x:h $x:s/a/b/\n",
  "print $^x $=x $~x $+x\n",
  `print \${:-fallback} \${#1}\n`,
  "if true; then print yes; else print no; fi\n",
  "for x y in a b; do print $x; done\n",
  "for x (a b) print $x\n",
  "foreach x (a b)\nprint $x\nend\n",
  "while true; do print x; done\n",
  "repeat 2 do print x; done\n",
  "repeat 2 print x\n",
  "f g() { print x; }\n",
  "function f { print x; }\n",
  "() { print x; } a b\n",
  "{ print x; } always { print y; }\n",
  "! print x |& cat\n",
  "coproc cat\n",
  "time print x | cat\n",
  "exec {fd}>file\n",
  "print x &>>!file\n",
  "print pre'quoted'\"double\"post\n",
  "pr\\\nint a\\\nb\n",
  'print "a $name $(print x) z"\n',
  "print `print x`\n",
  'print "`printf \\"%s\\\\n\\" x`"\n',
  "print $'a\\nb'\n",
  "# comment\\\nprint x\n",
  "cat <(print x) >(cat) =(print x)\n",
  "cat <<E\nbody\nE\nprint after\n",
  "cat <<A <<B\na\nA\nb\nB\nprint after\n",
  "cat <<'E'\n$x $(print no)\nE\n",
  "cat <<OUT\n$(cat <<IN\ninner\nIN\n)\nOUT\nprint after\n",
  "cat <<-E\n\tbody\n\tE\n",
  "cat <<E\nbody\nE",
  "cat <<E\nbody",
  "cat <<E\\\nND\nbody\nEND\n",
  "cat <<E\na\\\nE\nprint after\n",
  "cat <<`E`\n$x\n`E`\n",
  "cat <<$'\\u03a3'\nbody\nΣ\n",
  "cat <<-Z\n\t$((1 +\n\t2))\n\tZ\nprint after\n",
  'print "$(cat <<Z\n$((1 + 2))\nZ\n)"\nprint after\n',
  `cat <<Z\n\${value:-$((1 + 2))}\nZ\nprint after\n`,
  "cat <<Z\n$( [[ aaa =~ a{3} ]] && print $((1 + 2)))\nZ\nprint after\n",
  "cat <<Z\n\\$((1 + 2))\nZ\nprint after\n",
  "[[ aaa =~ (a{3}){1,2} ]]\nprint after\n",
  `[[ aaa =~ a{\${count}} ]]\nprint after\n`,
  "[[ aaa =~ a{3,2} ]]\nprint after\n",
  "[[ aaa =~ a{3 ]]\nprint after\n",
  "[[ aaa =~ [{]b} ]]\nprint after\n",
  "[[ aaa =~ [}] ]]\nprint after\n",
  "[[ aaa =~ }b ]]\nprint after\n",
  "[[ aaa =~ {a{b}} ]]\nprint after\n",
  "[[ aaa =~ a\\{3}b ]]\nprint after\n",
];

for (const source of sources) {
  test(`input boundaries remain stable after replacing the whole source: ${JSON.stringify(source)}`, () => {
    const fresh = valid(source);
    assert.equal(
      valid("print old\n", [{ byte: 0, deleteBytes: 10, insert: source }]),
      fresh,
    );
    assert.equal(valid(source), fresh);
  });
}

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

test("inserting a command argument matches a fresh parse", () => {
  assert.equal(
    valid("print one\n", [{ byte: 9, deleteBytes: 0, insert: " two" }]),
    valid("print one two\n"),
  );
});

test("inserting a quoted boundary into an existing word matches fresh parsing", () => {
  assert.equal(
    valid("print abcd\n", [{ byte: 8, deleteBytes: 0, insert: "' middle '" }]),
    valid("print ab' middle 'cd\n"),
  );
});

for (const [before, after, byte, deleteBytes, insert] of [
  ["print {a}\n", "print {a,b}\n", 8, 0, ",b"],
  ["print {1..3}\n", "print {1..3..2}\n", 11, 0, "..2"],
  ["print {1..3}\n", "print {1..3,b}\n", 11, 0, ",b"],
  ["print [abc-z]\n", "print [abc]\n", 10, 2, ""],
  ["print *(W,X:t)\n", "print *(WX:t)\n", 9, 1, ""],
  ["print *(#qW,X:t)\n", "print *(#iW,X:t)\n", 9, 1, "i"],
  ["print 2<file\n", "print 12<file\n", 6, 0, "1"],
  ["cat <12 >file\n", "cat <12>file\n", 7, 1, ""],
  ["print 2<file\n", "print 2<1-2>\n", 8, 4, "1-2>"],
  ["print 2<file\n", "print 2<(print x)\n", 8, 4, "(print x)"],
  ["print {fd}>file\n", "print {fd}>(:)\n", 11, 4, "(:)"],
  ["builtin typeset x=1\n", "nocorrect typeset x=1\n", 0, 7, "nocorrect"],
  ["x=1 typeset y=2\n", ">/dev/null typeset y=2\n", 0, 3, ">/dev/null"],
  ["exec -a name print x\n", "exec -a <(:) print x\n", 8, 4, "<(:)"],
  [
    "exec -a name print x\n",
    "exec -a 2>/dev/null name print x\n",
    8,
    0,
    "2>/dev/null ",
  ],
  [
    "print $(($(print 1)))\n",
    "print $(($(case x in x) print 1;; esac)))\n",
    11,
    7,
    "case x in x) print 1;; esac",
  ],
  ["[[ -n x ]]\n", "[[ -nx ]]\n", 5, 1, ""],
  ["[[ -n -eq ]]\n", "[[ -n -eq 1 ]]\n", 9, 0, " 1"],
  ["[[ -n -eq 1 ]]\n", "[[ -n -eq 1 2 ]]\n", 11, 0, " 2"],
  ['[[ -n"$x" ]]\n', '[[ -n"$x" value ]]\n', 9, 0, " value"],
  ["case a in (a) :;; esac\n", "case a in (a)) :;; esac\n", 13, 0, ")"],
  ["case a { a) :;; }\n", "case a { (a) :;; }\n", 9, 0, "("],
  ["print `print (a)`\n", "print `print (a`\n", 15, 1, ""],
  ["print `print {a,b}`\n", "print `print {a,b`\n", 17, 1, ""],
  ["print `print =cat `\n", "print `print =cat`\n", 17, 1, ""],
  [`print \${x-abc}\n`, `print \${$-abc}\n`, 8, 1, "$"],
  [`print \${$[1]}\n`, `print \${$((1))}\n`, 9, 3, "((1))"],
  [`print \${x[1]}\n`, `print \${x[1][2]}\n`, 12, 0, "[2]"],
  [`print \${x[1][2]}\n`, `print \${x[1]}\n`, 12, 3, ""],
  [`print \${#}\n`, `print \${##}\n`, 9, 0, "#"],
  [`print \${##}\n`, `print \${##3}\n`, 10, 0, "3"],
  ["print $#name\n", "print $#12\n", 8, 4, "12"],
  ["print $#12\n", "print $#?\n", 8, 2, "?"],
  ["a[$(print x # c\n)]=y\n", "a[$(print x # c\\\n)]=y\n", 15, 0, "\\"],
  ["print `print x # c\n`\n", "print `print x # c`\n", 18, 1, ""],
  ["if ((1)) { :; } # c\n", "if ((1)) { :; } # c\\\n", 19, 0, "\\"],
  ["cat <<$[x\n", "cat <<$[x]\n", 9, 0, "]"],
  ["cat <<$[1+2]\nbody\n$[1+2]\n", "cat <<$[1 +2]\nbody\n$[1+2]\n", 9, 0, " "],
  ["cat <<{a\nbody\n{a\n", "cat <<{a}\nbody\n{a\n", 8, 0, "}"],
  ["print a\u0000b", "print a\u0000bc", 9, 0, "c"],
  ["ix\u0000 x\n", "if\u0000 x\n", 1, 1, "f"],
  ["print }x\u0000\n", "print }\u0000\n", 7, 1, ""],
  [
    "cat <<E\u0000F\nbody\nE\u0000F",
    "cat <<E\u0000F\nbody\nE\u0000F\nprint after\n",
    18,
    0,
    "\nprint after\n",
  ],
  ["a['x']=y\nprint after\n", "a[']']=y\nprint after\n", 3, 1, "]"],
  ["a=([a]=x)\n", "a=([a[b]=x)\n", 5, 0, "[b"],
  ["a=([a[b]=x)\n", "a=([a[b]]=x)\n", 7, 0, "]"],
  ["a[$(cat <<E\nx\nE\n)]=y\n", "a[$(cat <<E\n)]\nE\n)]=y\n", 12, 1, ")]"],
  ["a[']'] x\n", "a[']']=x\n", 6, 1, "="],
  ["print $a[1+0]\n", "print $a[1 +0]\n", 10, 0, " "],
  ["print $a[1]\n", "print $a[1|print next]\n", 10, 0, "|print next"],
  ['print "$a[1]"\n', 'print "$a[1" "]"\n', 11, 0, '" "'],
  ['print "$x:s/a/b"\n', 'print "$x:s/a/(b"\n', 14, 0, "("],
  ["print $x:F:3:h\n", "print $x:F:3\n", 12, 2, ""],
  ["print [ab]\n", "print [a|print b]\n", 8, 0, "|print "],
  ["print [(a)b]\n", "print [(a]b)]\n", 9, 2, "]b)"],
  ["print {a,b}\n", "print {a,b\n", 10, 1, ""],
  ["print (a)\nprint after\n", "print (a\nprint after\n", 8, 1, ""],
  ["print ~[name]\n", "print ~[$name]\n", 8, 0, "$"],
  ["print ~[a]b/file\n", 'print ~["a]b"]/file\n', 8, 3, '"a]b"]'],
  ["print ~[$name:s/a/b/]\n", "print ~[$name:s/a/b]\n", 19, 1, ""],
  ["print ~[$a[1]]\n", "print ~[$a[1]\n", 13, 1, ""],
  [`print \${x:-~[a b]}\n`, `print \${x:-~[a} b]\n`, 13, 5, "a} b]"],
  ["print [[:class:]]\n", "print [[:$class:]]\n", 9, 0, "$"],
  ["print [a{b,c}d]\n", "print [a{b],c}d]\n", 10, 0, "]"],
  ["print =(:)\n", "print pre=(:)\n", 6, 0, "pre"],
  ["print ~[a(:)]\n", "print ~[a<(:)]\n", 9, 0, "<"],
  ["print *(#qP:one:)\n", "print *(#qP:one)\n", 15, 1, ""],
  ["print *(#a2)\n", "print *(#q2)\n", 9, 1, "q"],
  ["print *(P:tag:)\n", "print *(P:$(print tag):)\n", 10, 3, "$(print tag)"],
  [
    `print \${(l:8::0::x:)x}\n`,
    `print \${(l[8][0][x])x}\n`,
    10,
    9,
    "[8][0][x]",
  ],
  ["print $((##x))\n", "print $((##\\M-\\C-x))\n", 11, 1, "\\M-\\C-x"],
  ["print $((##\\M-A))\n", "print $((##\\M-$a))\n", 14, 1, "$a"],
  [
    "print $((##\\C-x))\n",
    "print $((##\\C-$(print A)))\n",
    14,
    1,
    "$(print A)",
  ],
  ["for ((1;0;)) do :; done\n", "for ((##;0;)) do :; done\n", 6, 1, "##"],
  ["print $(((1)))\n", "print $((\\(1)))\n", 9, 0, "\\"],
  ["print $'\\n' after\n", "print $'\\c' after\n", 9, 1, "c"],
  ["print $'\\C-x' after\n", "print $'\\C-' after\n", 11, 1, ""],
  [
    "cat <<Z\n$((1+2))\nZ\nprint after\n",
    "cat <<Z\n$((1 + 2))\nZ\nprint after\n",
    11,
    3,
    "1 + 2",
  ],
  [
    "cat <<Z\n$[1+2]\nZ\nprint after\n",
    "cat <<Z\n$[1 +\n2]\nZ\nprint after\n",
    10,
    3,
    "1 +\n2",
  ],
  [
    "cat <<Z\n$((1 + 2)\nZ\nprint after\n",
    "cat <<Z\n$((1 + 2))\nZ\nprint after\n",
    17,
    0,
    ")",
  ],
  ["[[ aaa =~ a{3} ]]\n", `[[ aaa =~ a{\${count}} ]]\n`, 12, 1, `\${count}`],
  ["[[ aaa =~ a{3}} ]]\n", "[[ aaa =~ a{3} ]]\n", 14, 1, ""],
  ["[[ aaa =~ a{3} ]]\n", "[[ aaa =~ (a{3}){2} ]]\n", 10, 4, "(a{3}){2}"],
]) {
  test(`editing source boundary ${JSON.stringify(before)} to ${JSON.stringify(after)} matches fresh parsing`, () => {
    assert.equal(valid(before, [{ byte, deleteBytes, insert }]), valid(after));
  });
}

test("case pattern edits preserve empty groups and alternation across brace source", () => {
  for (const { before, after, offset, insert } of [
    { before: "a(x)", after: "a()", offset: 2, insert: "" },
    { before: "{a|b}x", after: "{a|b}", offset: 5, insert: "" },
    { before: "{a,b}", after: "{a|b}", offset: 2, insert: "|" },
    { before: "{a|b}", after: "{a|}", offset: 3, insert: "" },
    { before: "a|esacx", after: "a|esac", offset: 6, insert: "" },
  ]) {
    for (const [open, close] of [
      ["in", "esac"],
      ["{", "}"],
    ]) {
      for (const [prefix, suffix] of [
        ["", "\n"],
        ["x=$(", ")\n"],
        ["cat <<$(", ")\nBODY\n"],
      ]) {
        const head = `${prefix}case x ${open} `;
        const tail = `) :;; ${close}${suffix}`;
        const source = head + before + tail;
        const changed = head + after + tail;
        const edit = { byte: head.length + offset, deleteBytes: 1, insert };
        const undo = {
          byte: edit.byte,
          deleteBytes: insert.length,
          insert: before.slice(offset, offset + 1),
        };
        assert.equal(valid(source, [edit]), valid(changed));
        assert.equal(valid(changed, [undo]), valid(source));
        assert.equal(valid(source, [edit, undo]), valid(source));
      }
    }
  }
});

test("timing prefix edits change inner keyword ownership and restore it across command sources", () => {
  for (const body of [
    "time true",
    "{ :; time true; }",
    "(time true)",
    "if :; then time true; fi",
    "for x in a; do time true; done",
    "foreach x (a); time true; end",
    "repeat 1 time true",
    "f() { time true; }",
    "case x in x) time true;; esac",
    "print $(time true) `time true` <(time true)",
    ": | time true",
  ]) {
    for (const [prefix, suffix] of [
      ["", "\n"],
      ["x=$(", ")\n"],
      ["cat <<$(", ")\nBODY\n"],
    ]) {
      const source = prefix + body + suffix;
      const changed = `${prefix}time ${body}${suffix}`;
      const edit = { byte: prefix.length, deleteBytes: 0, insert: "time " };
      const undo = { byte: prefix.length, deleteBytes: 5, insert: "" };
      assert.equal(valid(source, [edit]), valid(changed), changed);
      assert.equal(valid(changed, [undo]), valid(source), source);
      assert.equal(valid(source, [edit, undo]), valid(source), source);
    }
  }
});

test("timing boundaries preserve delimiter and subscript source through compound body edits", () => {
  for (const body of [
    "time time case",
    "time { :; time case; }",
    "time for x in a; do :; time case; done",
    "time repeat 1; : && time case; time case x in x) :;; esac",
    "time for x (a); : && time case; time case x in x) :;; esac",
    "time for ((i=0;i<1;i++)); : && time case; time case x in x) :;; esac",
    "time for x in a; : && time case; time case x in x) :;; esac",
    "time function f; : && time case; time case x in x) :;; esac",
    "time function f() : && time case; time case x in x) :;; esac",
    "time function f >out : && time case; time case x in x) :;; esac",
    "time function f { :; time case; }; time case x in x) :;; esac",
    "time if :; :; then time case; fi",
    "time if :; then if :; time case; fi",
    "time if [[ x ]] then time case; elif [[ x ]] then time case; fi",
    "time if [[ x ]] time case; time case x in x) :;; esac",
    "time if [[ x ]] : && time case; time case x in x) :;; esac",
    "time if false; then :; elif [[ x ]] : && time case; time case x in x) :;; esac",
    "time if case x in x) :;; esac : && time case; time case x in x) :;; esac",
    "time if if :; then :; fi : && time case; time case x in x) :;; esac",
    "time foreach x (a); :; time case; end",
    "time foreach x (a) { time case; }; time case x in x) :;; esac",
    "time foreach x (a) do time case; done; time case x in x) :;; esac",
    "time { :; } |& time case",
  ]) {
    for (const [prefix, suffix] of [
      ["cat <<$(", ")\nBODY\n"],
      ["a[$(", ")]=value\n"],
      ["print $((1+$(", ")))\n"],
    ]) {
      const source = prefix + body + suffix;
      const byte = source.indexOf("time case") + 5;
      const changed = `${source.slice(0, byte)}word${source.slice(byte + 4)}`;
      assert.equal(
        valid(source, [{ byte, deleteBytes: 4, insert: "word" }]),
        valid(changed),
        changed,
      );
      assert.equal(
        valid(changed, [{ byte, deleteBytes: 4, insert: "case" }]),
        valid(source),
        source,
      );
    }
  }
});

test("nocorrect command insertion and removal preserve standalone modifiers across enclosing contexts", () => {
  for (const [prefix, suffix] of [
    ["", ""],
    ["{ ", " }\n"],
    ["(", ")\n"],
    ["if ", "; then :; fi\n"],
    ["if :; then ", "; fi\n"],
    ["for x in a; do ", "; done\n"],
    ["case x in x) ", ";; esac\n"],
    ["x=$(", ")\n"],
    ["x=`", "`\n"],
    ["cat <<$(", ")\nBODY\n"],
  ]) {
    const head = `${prefix}nocorrect`;
    const source = head + suffix;
    const fresh = valid(source);
    for (const insert of [" :", " x=1", " >out", " nocorrect", " exec"]) {
      const changed = head + insert + suffix;
      const edit = { byte: head.length, deleteBytes: 0, insert };
      const undo = {
        byte: head.length,
        deleteBytes: insert.length,
        insert: "",
      };
      assert.equal(valid(source, [edit]), valid(changed), changed);
      assert.equal(valid(changed, [undo]), fresh, source);
      assert.equal(valid(source, [edit, undo]), fresh, source);
    }
  }
});

test("nocorrect separator and command name edits preserve fresh and incremental agreement", () => {
  for (const [prefix, suffix] of [
    ["", ""],
    ["{ ", " }\n"],
    ["(", ")\n"],
    ["if ", " then :; fi\n"],
    ["x=$(", ")\n"],
    ["x=`", "`\n"],
  ]) {
    const head = `${prefix}nocorrect`;
    const source = head + suffix;
    for (const insert of [";", "\n", " # comment\n", " && :;", " | :;", " &"]) {
      const changed = head + insert + suffix;
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
  for (const insert of ["exec nocorrect", '"nocorrect"']) {
    const source = "nocorrect\n";
    const changed = `${insert}\n`;
    assert.equal(
      valid(source, [{ byte: 0, deleteBytes: 9, insert }]),
      valid(changed),
    );
    assert.equal(
      valid(changed, [
        { byte: 0, deleteBytes: insert.length, insert: "nocorrect" },
      ]),
      valid(source),
    );
  }
});

test("assignment edits share scalar and array boundaries across command lookahead", () => {
  for (const [before, after] of [
    ["x=a}", "x=(a)"],
    ["x+=a}", "x+=(a)"],
    ["x[1]=a}", "x[1]=(a)"],
    ["typeset x=a}", "typeset x=(a)"],
    ["export x=a}", "export x=(a)"],
    ["x=a}", `x=\${x}}`],
    ["x=a}", "x=a\\\n}"],
    ["x=}", "x="],
    ["x=(a)y=b}", "x=(a)y=(b)"],
    ["typeset x=(a)y=b}", "typeset x=(a)y=(b)"],
  ]) {
    for (const [prefix, suffix] of [
      ["{ ", " }\n"],
      ['print "$({ ', ' })"\n'],
      ["[[ $({ ", " }) = x ]]\n"],
      ["cat <<$({ ", " })\nBODY\n"],
    ]) {
      for (const [from, to] of [
        [before, after],
        [after, before],
      ]) {
        const value = from.indexOf("=") + 1;
        assert.equal(
          valid(prefix + from + suffix, [
            {
              byte: prefix.length + value,
              deleteBytes: from.length - value,
              insert: to.slice(value),
            },
          ]),
          valid(prefix + to + suffix),
        );
      }
    }
  }
});

test("modifier delimiter edits preserve parentheses across operands and surrounding words", () => {
  for (const [before, after] of [
    ["$x:s/a(/)y/", "$x:s/a(/y/)"],
    ["$x:s/a(/)y/", "$x:s/a(/y/:u)"],
    ["$x:s/a(/)y/", "$x:s/a(/y/:s/b/)z/"],
    ["$x:s/a(/)y/", "$x:s/a((/))y/"],
    ["$x:s/a(/)y/", "$x:s#a(#)y#"],
    ["$x:s/a(/)y/", "$x:s(a(b(:s)b)c)"],
    ["$x:s/a(/)y/", "$x:s/a(/ )y/"],
    ["$x:s/a(/)y/", "$x:s/a(/\n)y/"],
    ["$x:s/a(/)y/", "$x:s/a(/$(print Z))y/"],
    ["$x:s/a(/)y/", "$x:s/a(/\\\n)y/"],
    ["$x:s/a(/)y/", "$x:s/a(/y/)tail"],
  ]) {
    for (const [prefix, suffix] of [
      ["print ", " next\n"],
      ["(print ", ")\n"],
      ['print "$(print ', ')"\n'],
      ["cat <<$(print ", ")\nBODY\n"],
    ]) {
      for (const [from, to] of [
        [before, after],
        [after, before],
      ]) {
        const source = prefix + from + suffix;
        let start = 0;
        while (from[start] === to[start]) start++;
        let end = 0;
        while (from.at(-end - 1) === to.at(-end - 1)) end++;
        assert.equal(
          valid(source, [
            {
              byte: prefix.length + start,
              deleteBytes: from.length - start - end,
              insert: to.slice(start, to.length - end),
            },
          ]),
          valid(prefix + to + suffix),
        );
      }
    }
  }
});

test("modifier parenthesis repairs preserve quoting and closing ownership", () => {
  for (const { before, byte, deleteBytes, insert } of [
    { before: "$x:s/a/)y/", byte: 6, deleteBytes: 0, insert: "(" },
    { before: "$x:s/a\\(/)y/", byte: 6, deleteBytes: 1, insert: "" },
    { before: "$x:s/a(/)y/)", byte: 11, deleteBytes: 1, insert: "" },
  ]) {
    assert.equal(
      valid(`print ${before}\n`, [{ byte: 6 + byte, deleteBytes, insert }]),
      valid("print $x:s/a(/)y/\n"),
    );
  }
});

test("regex operand edits preserve source boundaries and substitution ownership", () => {
  const prefix = "[[ x =~ ";
  const suffix = " ]]\n";
  for (const { before, after, edits } of [
    {
      before: "<1-2>",
      after: "<(:)",
      edits: [{ byte: 1, deleteBytes: 4, insert: "(:)" }],
    },
    {
      before: "<(:)",
      after: "<1-2>",
      edits: [{ byte: 1, deleteBytes: 3, insert: "1-2>" }],
    },
    {
      before: "x=(:)",
      after: "=(:)",
      edits: [{ byte: 0, deleteBytes: 1, insert: "" }],
    },
    {
      before: "=(:)",
      after: "x=(:)",
      edits: [{ byte: 0, deleteBytes: 0, insert: "x" }],
    },
    {
      before: "a}",
      after: "a{2}",
      edits: [{ byte: 1, deleteBytes: 0, insert: "{2" }],
    },
    {
      before: 'a"{"}',
      after: "a{}",
      edits: [
        { byte: 1, deleteBytes: 1, insert: "" },
        { byte: 2, deleteBytes: 1, insert: "" },
      ],
    },
    {
      before: "(<(:))",
      after: "<(:)",
      edits: [
        { byte: 5, deleteBytes: 1, insert: "" },
        { byte: 0, deleteBytes: 1, insert: "" },
      ],
    },
    {
      before: "a{2}",
      after: "a{<(print x)}",
      edits: [{ byte: 2, deleteBytes: 1, insert: "<(print x)" }],
    },
    {
      before: "<1-2>",
      after: "<\\\n1-2>",
      edits: [{ byte: 1, deleteBytes: 0, insert: "\\\n" }],
    },
    {
      before: "<(:)",
      after: "<\\\n(:)",
      edits: [{ byte: 1, deleteBytes: 0, insert: "\\\n" }],
    },
  ]) {
    assert.equal(
      valid(
        prefix + before + suffix,
        edits.map((edit) => ({ ...edit, byte: prefix.length + edit.byte })),
      ),
      valid(prefix + after + suffix),
    );
  }
});

test("delimiter command edits share lexical boundaries with ordinary command source", () => {
  for (const condition of [
    "[[ x ]]",
    "((1))",
    "{ :; }",
    "(:)",
    "case x in x) :;; esac",
    "{ :; } always { :; }",
    "f() [[ x ]]",
    "() [[ x ]]",
    "function () [[ x ]] a",
    "repeat 1 [[ x ]]",
    "for x (a) [[ x ]]",
    "v=x",
    ">out",
    "[[ x ]] >out",
    '[[ x == "a)" ]]',
    "[[ x # ) (\n ]]",
    "[[ x =~ <(case x in x) print ]];; esac) ]]",
    "[[ x =~ (<(case x in x) :;; y) print ]];; esac)) ]]",
    "[[ x =~ =(case x in x) print ]];; esac) ]]",
    "[[ x =~ <(cat <<E\n]]\nE\n) ]]",
  ]) {
    const command = `if ${condition} then case x in x) :;; esac; fi`;
    const before = `print "$(${command})"\n`;
    const delimiter = `cat <<$(${command})\nBODY\n`;
    valid(before);
    assert.equal(
      valid(before, [
        { byte: 0, deleteBytes: 7, insert: "cat <<" },
        { byte: before.length - 3, deleteBytes: 1, insert: "" },
        { byte: before.length - 2, deleteBytes: 0, insert: "BODY\n" },
      ]),
      valid(delimiter),
    );
    const byte = delimiter.indexOf(" then");
    const separated = `${delimiter.slice(0, byte)};${delimiter.slice(byte)}`;
    assert.equal(
      valid(separated, [{ byte, deleteBytes: 1, insert: "" }]),
      valid(delimiter),
    );
  }
});

test("brace opening edits follow the enclosing operand and group boundaries", () => {
  for (const [source, oldText, newText] of [
    [`print \${x:-{a}x}\n`, "{a", "{ "],
    [`print \${x:+{a}x}\n`, "{a", "{\t"],
    [`print \${x:={a}x}\n`, "{a", "{\n"],
    [`print \${x#{a}x}\n`, "{a", "{;"],
    [`print \${x:-{{a}b}x}\n`, "{a", "{\\\n "],
    [`print \${x:-[a{b,c}d]}\n`, "{b", "{ "],
    [`print \${x:s/a{z/b}/}\n`, "{z", "{ "],
    ["print ({a,b}x)\n", "{a", "{ "],
    ["print (#q{a,b}x)\n", "{a", "{\n"],
    ["print pre{a}x\n", "{a", "{ "],
  ]) {
    const byte = source.indexOf(oldText);
    const changed = source.replace(oldText, newText);
    const edit = { byte, deleteBytes: oldText.length, insert: newText };
    const repair = { byte, deleteBytes: newText.length, insert: oldText };
    assert.equal(valid(source, [edit]), valid(changed));
    assert.equal(valid(changed, [repair]), valid(source));
    assert.equal(valid(source, [edit, repair]), valid(source));
  }
});

test("editing separators after arrays preserves subsequent command and declaration roles", () => {
  for (const head of ["x=(a b)", "x=()", "x+=(a)", "typeset x=(a)"]) {
    for (const tail of ["y", '"y"', `\${:-y}`, "y=(b)", "# note", "1>&1"]) {
      const before = `${head} ${tail}\n`;
      for (const separator of ["", "\\\n"]) {
        const after = `${head}${separator}${tail}\n`;
        assert.equal(
          valid(before, [
            { byte: head.length, deleteBytes: 1, insert: separator },
          ]),
          valid(after),
        );
        assert.equal(
          valid(after, [
            { byte: head.length, deleteBytes: separator.length, insert: " " },
          ]),
          valid(before),
        );
      }
    }
  }
});

test("editing array and scalar values restores the enclosing substitution context", () => {
  for (const [prefix, suffix] of [
    ["", "\n"],
    ['print "$(', ')"\n'],
    ["print `", "`\n"],
  ]) {
    const before = `${prefix}x=(a)y${suffix}`;
    const after = `${prefix}x=ay${suffix}`;
    const edits = [
      { byte: prefix.length + 2, deleteBytes: 1, insert: "" },
      { byte: prefix.length + 3, deleteBytes: 1, insert: "" },
    ];
    const repairs = [
      { byte: prefix.length + 2, deleteBytes: 0, insert: "(" },
      { byte: prefix.length + 4, deleteBytes: 0, insert: ")" },
    ];
    assert.equal(valid(before, edits), valid(after));
    assert.equal(valid(after, repairs), valid(before));
    assert.equal(valid(before, [...edits, ...repairs]), valid(before));
  }
});

test("command prefix edits switch descriptor spellings between brace groups and argument redirections", () => {
  for (const [prefix, suffix] of [
    ["", "\n"],
    ["function f; ", "\n"],
    ["for x; ", "\n"],
    ["x=$(", ")\n"],
    ["a[$(", ")]=value\n"],
    ["print [a$(", ")b]\n"],
    ["print $((1+$(", "; print 2)))\n"],
    ["cat <<$(", ")\nBODY\n"],
  ]) {
    for (const redirect of [">out", "<&0", "<<<text", "<<E\nbody\nE\n"]) {
      const source = `${prefix}{fd}${redirect}${suffix}`;
      const fresh = valid(source);
      for (const insert of [": ", "exec "]) {
        const changed = `${prefix}${insert}{fd}${redirect}${suffix}`;
        const edit = { byte: prefix.length, deleteBytes: 0, insert };
        const undo = {
          byte: prefix.length,
          deleteBytes: insert.length,
          insert: "",
        };
        assert.equal(valid(source, [edit]), valid(changed), changed);
        assert.equal(valid(changed, [undo]), fresh, source);
        assert.equal(valid(source, [edit, undo]), fresh, source);
      }
    }
  }
});

test("conditional comment edits preserve expression and word boundaries", () => {
  for (const source of [
    "[[ -n x && x == x || ! ( x =~ x ) ]]\n",
    '[[ "#" == [#] && x#y =~ (x#y) ]]\n',
    "[[ -n == -n ]]\n",
  ]) {
    for (let byte = 0; byte < source.length; byte++) {
      if (source[byte] !== " ") continue;
      for (const comment of [' # ]] " $(\n', " # raw \\\n"]) {
        const changed =
          source.slice(0, byte) + comment + source.slice(byte + 1);
        assert.equal(
          valid(source, [{ byte, deleteBytes: 1, insert: comment }]),
          valid(changed),
        );
        assert.equal(
          valid(changed, [{ byte, deleteBytes: comment.length, insert: " " }]),
          valid(source),
        );
      }
    }
  }
});

test("conditional operand edits preserve leading closing brackets across nested source boundaries", () => {
  for (const [prefix, suffix] of [
    ["", "\n"],
    ['print "$(', ')"\n'],
    ["print $((1+$(", "; print 2)))\n"],
    ["cat <<$(", ")\nBODY\n"],
  ]) {
    for (const condition of [
      "[[ x ]]",
      "[[ -n x ]]",
      "[[ x = x ]]",
      "[[ x =~ x ]]",
    ]) {
      const source = prefix + condition + suffix;
      const byte = prefix.length + condition.lastIndexOf("x");
      for (const insert of ["]]", "]\\\n]", "]]#"]) {
        const changed = source.slice(0, byte) + insert + source.slice(byte);
        const edit = { byte, deleteBytes: 0, insert };
        const undo = { byte, deleteBytes: insert.length, insert: "" };
        assert.equal(valid(source, [edit]), valid(changed), changed);
        assert.equal(valid(changed, [undo]), valid(source), source);
      }
    }
  }
});

test("editing separators before control keywords preserves fresh and incremental trees", () => {
  for (const body of [
    "[[ x ]]",
    "((1))",
    "{ :; }",
    "( : )",
    "case x in esac",
    "{ :; } always { :; }",
    "repeat 1 [[ x ]]",
    "for x (a) [[ x ]]",
    "f() [[ x ]]",
    "() [[ x ]]",
    "function () [[ x ]] a >out",
    `function () [[ x ]] "\${x:-$(print a)}" >out`,
    "v=x >out",
    ": | [[ x ]]",
    ": && [[ x ]]",
  ]) {
    for (const [prefix, suffix] of [
      ["if :; then ", " fi\n"],
      ["for x in a; do ", " done\n"],
      ["case x in x) ", " esac\n"],
      ["foreach x (a); :; ", " end\n"],
      ["if ", " then :; fi\n"],
      ["while ", " do break; done\n"],
    ]) {
      const after = prefix + body + suffix;
      const byte = prefix.length + body.length;
      for (const separator of [";", "\n"]) {
        const before = prefix + body + separator + suffix;
        assert.equal(
          valid(before, [{ byte, deleteBytes: separator.length, insert: "" }]),
          valid(after),
        );
        assert.equal(
          valid(after, [{ byte, deleteBytes: 0, insert: separator }]),
          valid(before),
        );
      }
    }
  }
});

test("editing body forms restores their inherited control boundary after recovery", () => {
  for (const [beforeBody, afterBody] of [
    ["repeat 1 { :; }", "repeat 1 [[ x ]]"],
    ["for x (a) { :; }", "for x (a) ( : )"],
    ["() ( : )", "() [[ x ]]"],
    ["() { :; }", "() case x in esac"],
    ["if :; then :; fi", "{ :; }"],
    ["() [[ x ]] a", "function () [[ x ]] a"],
  ]) {
    for (const [prefix, suffix] of [
      ["if :; then ", " fi\n"],
      ['print "$(if :; then ', ' fi)"\n'],
    ]) {
      const before = prefix + beforeBody + suffix;
      const after = prefix + afterBody + suffix;
      assert.equal(
        valid(before, [
          {
            byte: prefix.length,
            deleteBytes: beforeBody.length,
            insert: afterBody,
          },
        ]),
        valid(after),
      );
      const terminated = `${prefix}${beforeBody};${suffix}`;
      assert.equal(
        valid(after, [
          {
            byte: prefix.length,
            deleteBytes: afterBody.length,
            insert: `${beforeBody};`,
          },
        ]),
        valid(terminated),
      );
    }
  }
});

test("editing inner short if ownership distinguishes else from elif and grouped bodies", () => {
  const before = "if :; then if [[ x ]] [[ x ]] else :; fi\n";
  const byte = before.indexOf("else");
  const after = `${before.slice(0, byte)}elif :; then${before.slice(byte + 4)}`;
  assert.equal(
    valid(before, [{ byte, deleteBytes: 4, insert: "elif :; then" }]),
    valid(after),
  );
  const body = "if [[ x ]] [[ x ]]";
  const grouped = before.replace(body, `{ ${body}; }`);
  assert.equal(
    valid(before, [
      {
        byte: before.indexOf(body),
        deleteBytes: body.length,
        insert: `{ ${body}; }`,
      },
    ]),
    valid(grouped),
  );
});

test("editing function headers preserves anonymous arguments and operator ownership", () => {
  for (const source of [
    "() print BODY && print AFTER\n",
    "() (print BODY) arg\n",
    "() if :; then :; fi arg\n",
  ]) {
    for (const prefix of ["function ", "function -T ", "function -T -- "]) {
      const changed = prefix + source;
      assert.equal(
        valid(source, [{ byte: 0, deleteBytes: 0, insert: prefix }]),
        valid(changed),
      );
      assert.equal(
        valid(changed, [{ byte: 0, deleteBytes: prefix.length, insert: "" }]),
        valid(source),
      );
    }
  }
  const before = "function -- -T () { :; }\n";
  const after = "function -T () { :; }\n";
  assert.equal(
    valid(before, [{ byte: 9, deleteBytes: 3, insert: "" }]),
    valid(after),
  );
  assert.equal(
    valid(after, [{ byte: 9, deleteBytes: 0, insert: "-- " }]),
    valid(before),
  );
});

test("editing parentheses headers preserves interspersed redirections and name boundaries", () => {
  for (const prefix of ["f ", "nocorrect f ", "exec -a "]) {
    for (const redirect of [
      ">out ",
      "2>&1 ",
      "{fd}>out ",
      "<input ",
      "<<<DATA ",
    ]) {
      const before = `${prefix}g () :\n`;
      const after = `${prefix}${redirect}g () :\n`;
      assert.equal(
        valid(before, [
          { byte: prefix.length, deleteBytes: 0, insert: redirect },
        ]),
        valid(after),
      );
      assert.equal(
        valid(after, [
          { byte: prefix.length, deleteBytes: redirect.length, insert: "" },
        ]),
        valid(before),
      );
    }
  }
  for (const source of [
    "f >out g () { :; } | :\n",
    "f {fd}>out g () :\n",
    "f <<E g () { cat; }\nDATA\nE\n",
  ]) {
    const keyword = `function ${source}`;
    assert.equal(
      valid(source, [{ byte: 0, deleteBytes: 0, insert: "function " }]),
      valid(keyword),
    );
    assert.equal(
      valid(keyword, [{ byte: 0, deleteBytes: 9, insert: "" }]),
      valid(source),
    );
  }
  const source = "f >out g () { :; }\n";
  for (const insert of [";", "\n"]) {
    const offset = source.indexOf(" ()");
    const after = source.slice(0, offset) + insert + source.slice(offset);
    assert.equal(
      valid(source, [{ byte: offset, deleteBytes: 0, insert }]),
      valid(after),
    );
    assert.equal(
      valid(after, [{ byte: offset, deleteBytes: insert.length, insert: "" }]),
      valid(source),
    );
  }
  const target = "f >g () { :; }\n";
  assert.equal(
    valid(source, [{ byte: 3, deleteBytes: 4, insert: "" }]),
    valid(target),
  );
  assert.equal(
    valid(target, [{ byte: 3, deleteBytes: 0, insert: "out " }]),
    valid(source),
  );
  for (const incomplete of ["f >out g ()", "f >out g ("]) {
    assert.equal(
      valid(incomplete, [
        {
          byte: incomplete.length,
          deleteBytes: 0,
          insert: source.slice(incomplete.length),
        },
      ]),
      valid(source),
    );
  }
});

test("editing anonymous invocation redirections preserves arguments and lexical boundaries", () => {
  for (const [prefix, suffix] of [
    ["", "\n"],
    ['print "$( ', ' )"\n'],
  ]) {
    for (const redirect of [
      ">out ",
      "2>&1 ",
      "{fd}>out ",
      "<input ",
      "<<<DATA ",
      ">out \\\n",
      ">out # trailing comment",
    ]) {
      const before = `${prefix}() { :; } a b\n${suffix}`;
      const byte = before.indexOf("b\n");
      const after = before.slice(0, byte) + redirect + before.slice(byte);
      assert.equal(
        valid(before, [{ byte, deleteBytes: 0, insert: redirect }]),
        valid(after),
      );
      assert.equal(
        valid(after, [{ byte, deleteBytes: redirect.length, insert: "" }]),
        valid(before),
      );
    }
  }
  const before = "() { :; } a 2>out b\n";
  const after = "() { :; } a {fd}>out b\n";
  const byte = before.indexOf("2>");
  assert.equal(
    valid(before, [{ byte, deleteBytes: 1, insert: "{fd}" }]),
    valid(after),
  );
  assert.equal(
    valid(after, [{ byte, deleteBytes: 4, insert: "2" }]),
    valid(before),
  );
  const document = "() { :; } a <<E b\nDATA\nE\n";
  const without = "() { :; } a b\nDATA\nE\n";
  assert.equal(
    valid(without, [{ byte: 12, deleteBytes: 0, insert: "<<E " }]),
    valid(document),
  );
  assert.equal(
    valid(document, [{ byte: 12, deleteBytes: 4, insert: "" }]),
    valid(without),
  );
});

test("editing anonymous headers preserves the keyword argument boundary and its recovery", () => {
  for (const source of [
    "() { :; } >out\n",
    "() { :; } a b >out\n",
    "() { :; } a {fd}>out\n",
    "() (:) >body a >outer\n",
  ]) {
    const keyword = `function ${source}`;
    assert.equal(
      valid(source, [{ byte: 0, deleteBytes: 0, insert: "function " }]),
      valid(keyword),
    );
    assert.equal(
      valid(keyword, [{ byte: 0, deleteBytes: 9, insert: "" }]),
      valid(source),
    );
  }
  for (const source of [
    "() { :; } >out a\n",
    "() { :; } a >out b\n",
    "() { :; } a >out {fd}>err\n",
  ]) {
    assert.equal(
      valid(`function ${source}`, [{ byte: 0, deleteBytes: 9, insert: "" }]),
      valid(source),
    );
  }
});

test("moving anonymous redirections across the first argument preserves body ownership", () => {
  for (const body of ["{ :; }", "(:)", "if :; then :; fi"]) {
    for (const header of ["() ", "function () "]) {
      const before = `${header}${body} >out a\n`;
      const after = `${header}${body} a >out\n`;
      const byte = header.length + body.length;
      assert.equal(
        valid(before, [{ byte, deleteBytes: 7, insert: " a >out" }]),
        valid(after),
      );
      if (header === "function () " && body === "{ :; }") continue;
      assert.equal(
        valid(after, [{ byte, deleteBytes: 7, insert: " >out a" }]),
        valid(before),
      );
    }
  }
});

test("editing anonymous bodies preserves fresh and incremental source boundaries", () => {
  const bodies = [
    "{ :; }",
    "(:)",
    "if :; then :; fi",
    "print BODY",
    "for x (a) print $x",
  ];
  for (const header of ["() ", "function () "]) {
    for (const [prefix, suffix] of [
      ["", "\n"],
      ['print "$( ', ' )"\n'],
    ]) {
      for (let index = 0; index < bodies.length; index++) {
        const beforeBody = bodies[index];
        const afterBody = bodies[(index + 1) % bodies.length];
        const before = prefix + header + beforeBody + suffix;
        const after = prefix + header + afterBody + suffix;
        const byte = prefix.length + header.length;
        assert.equal(
          valid(before, [
            { byte, deleteBytes: beforeBody.length, insert: afterBody },
          ]),
          valid(after),
        );
        assert.equal(
          valid(after, [
            { byte, deleteBytes: afterBody.length, insert: beforeBody },
          ]),
          valid(before),
        );
      }
    }
  }
});

test("editing redirection-led keyword bodies preserves name and body boundaries", () => {
  const sources = [
    "function f >out :\n",
    "function f g >out print BODY\n",
    "function f >out\n",
    "function f >out { :; } | cat\n",
    "function f {fd}>out :\n",
    "function f 2>out :\n",
    "function f &>out :\n",
    "function f < /dev/null cat\n",
    "function f <<<BODY cat\n",
    "function f <<E cat\nbody\nE\n",
    "function f <<E\nbody\nE\n",
    "function f >out if :; then :; fi\n",
    "function f >out ( : )\n",
    "function f >out : && :\n",
    "function >out print BODY\n",
  ];
  for (const source of sources) {
    const offset = source.search(/[<>&]/);
    for (const insert of [" ", "\\\n"]) {
      const after = source.slice(0, offset) + insert + source.slice(offset);
      assert.equal(
        valid(source, [{ byte: offset, deleteBytes: 0, insert }]),
        valid(after),
      );
      assert.equal(
        valid(after, [
          { byte: offset, deleteBytes: insert.length, insert: "" },
        ]),
        valid(source),
      );
    }
  }
  for (const body of [">out :", ">out", ">out { :; } | cat", ">out : && :"]) {
    const before = `function f ${body}\n`;
    for (const insert of ["()", ";", "\n"]) {
      const after = `function f${insert} ${body}\n`;
      assert.equal(
        valid(before, [{ byte: 10, deleteBytes: 0, insert }]),
        valid(after),
      );
      assert.equal(
        valid(after, [{ byte: 10, deleteBytes: insert.length, insert: "" }]),
        valid(before),
      );
    }
  }
  for (const source of [
    "function f >",
    "function f",
    "function f :",
    "function f | { :; }",
  ]) {
    const after = "function f >out :\n";
    assert.equal(
      valid(source, [
        { byte: 10, deleteBytes: source.length - 10, insert: after.slice(10) },
      ]),
      valid(after),
    );
  }
});

test("editing unbraced prefix targets reclassifies the complete source in every enclosing context", () => {
  for (const [prefix, suffix] of [
    ["print ", " $after\n"],
    ['print "', ' $after"\n'],
    ["cat <<OUT\n", " $after\nOUT\n"],
    ['print "$(print ', ' $after)"\n'],
    [`print \${p:-`, "} $after\n"],
  ]) {
    for (const { before, after, byte, deleteBytes, insert } of [
      { before: "$~", after: "$+", byte: 1, deleteBytes: 1, insert: "+" },
      { before: "$+", after: "$+x", byte: 2, deleteBytes: 0, insert: "x" },
      { before: "$~+", after: "$~+x", byte: 3, deleteBytes: 0, insert: "x" },
      { before: "$~+x", after: "$~+?", byte: 3, deleteBytes: 1, insert: "?" },
      { before: "$+x", after: "$+{x}", byte: 2, deleteBytes: 1, insert: "{x}" },
      {
        before: "$+$",
        after: `$+\${x}`,
        byte: 3,
        deleteBytes: 0,
        insert: "{x}",
      },
      {
        before: "$~+x",
        after: "$~+\\\nx",
        byte: 3,
        deleteBytes: 0,
        insert: "\\\n",
      },
      {
        before: "$~\\\n+x",
        after: "$~\\\n+",
        byte: 5,
        deleteBytes: 1,
        insert: "",
      },
    ]) {
      const source = prefix + before + suffix;
      const changed = prefix + after + suffix;
      const edit = { byte: prefix.length + byte, deleteBytes, insert };
      const undo = {
        byte: edit.byte,
        deleteBytes: insert.length,
        insert: before.slice(byte, byte + deleteBytes),
      };
      assert.equal(valid(source, [edit]), valid(changed), source);
      assert.equal(valid(changed, [undo]), valid(source), changed);
    }
  }
});

test("editing nocorrect function prefixes preserves fresh and incremental agreement", () => {
  for (const { source, edits, expected } of [
    {
      source: "f () { :; }\n",
      edits: [{ byte: 0, deleteBytes: 0, insert: "nocorrect " }],
      expected: "nocorrect f () { :; }\n",
    },
    {
      source: "nocorrect f\n",
      edits: [{ byte: 11, deleteBytes: 0, insert: " () { :; }" }],
      expected: "nocorrect f () { :; }\n",
    },
    {
      source: "nocorrect f () { :; }\n",
      edits: [{ byte: 10, deleteBytes: 2, insert: "" }],
      expected: "nocorrect () { :; }\n",
    },
    {
      source: "nocorrect () { :; }\n",
      edits: [
        { byte: 9, deleteBytes: 0, insert: '"' },
        { byte: 0, deleteBytes: 0, insert: '"' },
      ],
      expected: '"nocorrect" () { :; }\n',
    },
    {
      source: "nocorrect f () { :; }\n",
      edits: [{ byte: 10, deleteBytes: 0, insert: ">out " }],
      expected: "nocorrect >out f () { :; }\n",
    },
  ]) {
    assert.equal(valid(source, edits), valid(expected), source);
  }
});

test("pending heredoc edits in delimiter command source preserve the matching value", () => {
  const source = "cat <<$(cat <<E)\nbody\n$(cat <<E)\nprint AFTER\n";
  const changed = source.replaceAll("<<E)", "<<E <<F)");
  const positions = [source.indexOf("<<E") + 3, source.lastIndexOf("<<E") + 3];
  const inserts = positions.toReversed().map((byte) => ({
    byte,
    deleteBytes: 0,
    insert: " <<F",
  }));
  const removals = positions.map((byte) => ({
    byte,
    deleteBytes: 4,
    insert: "",
  }));
  assert.equal(valid(source, inserts), valid(changed));
  assert.equal(valid(changed, removals), valid(source));
  assert.equal(valid(source, [...inserts, ...removals]), valid(source));
});

test("quoted and arithmetic subscript repairs preserve explicit delimiter ownership", () => {
  for (const [prefix, suffix] of [
    ['print -r -- "', '"\n'],
    ["(( ", " ))\n"],
  ]) {
    for (const { before, after, byte, insert } of [
      { before: `\${x[{}`, after: `\${x[{}]}`, byte: 6, insert: "]}" },
      { before: `\${x[}`, after: `\${x[1]}`, byte: 4, insert: "1]" },
      { before: `\${x[{]}`, after: `\${x[\\{]}`, byte: 4, insert: "\\" },
    ]) {
      const source = prefix + before + suffix;
      const repaired = prefix + after + suffix;
      const repair = { byte: prefix.length + byte, deleteBytes: 0, insert };
      const remove = {
        byte: prefix.length + byte,
        deleteBytes: insert.length,
        insert: "",
      };
      const fresh = valid(repaired);
      assert.equal(valid(source, [repair]), fresh);
      assert.equal(valid(repaired, [remove, repair]), fresh);
    }
  }
});

test("empty reference quote and continuation edits preserve fresh and incremental ownership", () => {
  for (const { before, after, offset, insert } of [
    { before: `\${x}`, after: `\${""x}`, offset: 2, insert: '""' },
    { before: `\${""x}`, after: `\${""""x}`, offset: 2, insert: '""' },
    { before: `\${\${x}}`, after: `\${""\${x}}`, offset: 2, insert: '""' },
    { before: `\${\${x}}`, after: `\${\${x}""}`, offset: 6, insert: '""' },
    {
      before: `\${"\${x}"[1]:h}`,
      after: `\${"\${x}"""[1]:h}`,
      offset: 8,
      insert: '""',
    },
    { before: `\${""}`, after: `\${""""}`, offset: 2, insert: '""' },
    { before: `\${""x}`, after: `\${"\\\n"x}`, offset: 3, insert: "\\\n" },
    {
      before: `\${"\${x}"}`,
      after: `\${"\\\n\${x}"}`,
      offset: 3,
      insert: "\\\n",
    },
  ]) {
    for (const [prefix, suffix] of [
      ["print ", "\n"],
      ['print "', '"\n'],
      ["cat <<E\n", "\nE\nprint AFTER\n"],
    ]) {
      const source = prefix + before + suffix;
      const changed = prefix + after + suffix;
      const edit = { byte: prefix.length + offset, deleteBytes: 0, insert };
      const undo = { byte: edit.byte, deleteBytes: insert.length, insert: "" };
      assert.equal(valid(source, [edit]), valid(changed));
      assert.equal(valid(changed, [undo]), valid(source));
      assert.equal(valid(source, [edit, undo]), valid(source));
    }
  }
});

test("changing a flag delimiter restores the surrounding parameter context", () => {
  assert.equal(
    valid(`print \${(s.:.)x}:$after\n`, [
      { byte: 10, deleteBytes: 1, insert: "|" },
      { byte: 12, deleteBytes: 1, insert: "|" },
    ]),
    valid(`print \${(s|:|)x}:$after\n`),
  );
});

test("editing a modifier replacement retains the parameter and word boundaries", () => {
  assert.equal(
    valid(`print \${x:s/a/b/}suffix\n`, [
      { byte: 14, deleteBytes: 1, insert: "$replacement" },
    ]),
    valid(`print \${x:s/a/$replacement/}suffix\n`),
  );
});

test("editing a command prefix restores the following word role", () => {
  assert.equal(
    valid("print fi { :; }\n", [
      { byte: 0, deleteBytes: 5, insert: "function" },
    ]),
    valid("function fi { :; }\n"),
  );
  assert.equal(
    valid("print fi\n", [{ byte: 0, deleteBytes: 5, insert: "command" }]),
    valid("command fi\n"),
  );
});

test("heredoc expression delimiters preserve their quoting and continuation boundaries after insertion", () => {
  for (const { delimiter, end, quoted, terminated = true } of [
    {
      delimiter: '"$(print "E F")"',
      end: '$(print "E F")',
      quoted: true,
    },
    {
      delimiter: '$(print "E")',
      end: '$(print "E")',
      quoted: false,
    },
    {
      delimiter: `\${x:-"E"}`,
      end: `\${x:-E}`,
      quoted: true,
    },
    {
      delimiter: "$[a\\\nb]",
      end: "$[ab]",
      quoted: false,
    },
    {
      delimiter: "$(print a\\\nb)",
      end: "$(print ab)",
      quoted: false,
      terminated: false,
    },
    {
      delimiter: "`E`",
      end: "`E`",
      quoted: false,
    },
    {
      delimiter: "`E\\`X`",
      end: "`E`X`",
      quoted: true,
    },
  ]) {
    const source = `cat <<${delimiter}\n$value\n${end}\nprint after\n`;
    const tree = valid(source);
    assert.equal(tree.includes("here_document_end_text"), terminated, source);
    assert.equal(/literal `after`/.test(tree), terminated, source);
    assert.equal(tree.includes("quoted_here_document_text"), quoted, source);
    assert.equal(
      valid("", [{ byte: 0, deleteBytes: 0, insert: source }]),
      tree,
    );
  }
});

test("editing standalone list separators preserves leaves and command ownership", () => {
  for (const { prefix, suffix } of [
    { prefix: "", suffix: "\nprint AFTER\n" },
    { prefix: "{ ", suffix: " }\n" },
    { prefix: "(", suffix: ")\n" },
    { prefix: 'print "$(', suffix: ')"\n' },
    { prefix: "print `", suffix: "`\n" },
    { prefix: "cat <(", suffix: ")\n" },
    { prefix: "if ", suffix: " then :; fi\n" },
    { prefix: "if :; then ", suffix: " fi\n" },
    { prefix: "if false; then :; else ", suffix: " fi\n" },
    { prefix: "while ", suffix: " do :; done\n" },
    { prefix: "until true; do ", suffix: " done\n" },
    { prefix: "for x in a; do ", suffix: " done\n" },
    { prefix: "repeat 1 do ", suffix: " done\n" },
    { prefix: "foreach x (a) ", suffix: " end\n" },
    { prefix: "f() { ", suffix: " }\n" },
    { prefix: "{ :; } always { ", suffix: " }\n" },
  ]) {
    for (const { before, after, edits } of [
      {
        before: ":;",
        after: "; :; ;",
        edits: [
          { byte: 0, deleteBytes: 0, insert: "; " },
          { byte: 4, deleteBytes: 0, insert: " ;" },
        ],
      },
      {
        before: "; :; ;",
        after: "; ;",
        edits: [{ byte: 2, deleteBytes: 3, insert: "" }],
      },
      {
        before: ";;",
        after: "; ;",
        edits: [{ byte: 1, deleteBytes: 0, insert: " " }],
      },
    ]) {
      const source = prefix + before + suffix;
      const target = prefix + after + suffix;
      const fresh = valid(target);
      assert.equal(
        valid(
          source,
          edits.map((edit) => ({ ...edit, byte: prefix.length + edit.byte })),
        ),
        fresh,
        target,
      );
      assert.equal(
        [...fresh.matchAll(/";"$/gm)].length,
        [...target.matchAll(/;/g)].length,
        target,
      );
    }
  }
});

test("case header and closing edits preserve completed items across enclosing contexts", () => {
  for (const [open, close] of [
    ["in", "esac"],
    ["{", "}"],
  ]) {
    for (const items of [
      "",
      "# header\n",
      "x) :;;",
      "x) :;&",
      "x) :;|",
      "x) :;; # tail\n",
    ]) {
      for (const [prefix, suffix] of [
        ["", ""],
        ["{ ", "; :; }"],
        ["x=$(", ")"],
        ["x=`", "`"],
        ["if :; then ", "; fi"],
        ["cat <<$(", ")\nBODY\n"],
        ["case y in y) ", ";; esac"],
        ["case y in y) ", ";; }"],
        ["case y { y) ", ";; esac"],
        ["case y { y) ", ";; }"],
      ]) {
        const header = `${prefix}case x `;
        const body = `${header}${open} ${items} `;
        const source = body + close + suffix;
        for (const edit of [
          {
            byte: header.length,
            deleteBytes: open.length,
            insert: open === "in" ? "{" : "in",
          },
          {
            byte: body.length,
            deleteBytes: close.length,
            insert: close === "esac" ? "}" : "esac",
          },
        ]) {
          const changed =
            source.slice(0, edit.byte) +
            edit.insert +
            source.slice(edit.byte + edit.deleteBytes);
          assert.equal(valid(source, [edit]), valid(changed), changed);
          assert.equal(
            valid(changed, [
              {
                byte: edit.byte,
                deleteBytes: edit.insert.length,
                insert: source.slice(edit.byte, edit.byte + edit.deleteBytes),
              },
            ]),
            valid(source),
            source,
          );
        }
      }
    }
  }
});

test("loop header newline edits preserve in and body ownership", () => {
  for (const source of [
    "for x in a b; do :; done\n",
    "for x y in a b; :\n",
    "select x in a b; do :; done\n",
    "select x in a b; :\n",
  ]) {
    const byte = source.indexOf(" in ");
    for (const separator of ["\n", "\n\n", " # variable\n"]) {
      const changed =
        source.slice(0, byte) + separator + source.slice(byte + 1);
      assert.equal(
        valid(source, [{ byte, deleteBytes: 1, insert: separator }]),
        valid(changed),
      );
      assert.equal(
        valid(changed, [{ byte, deleteBytes: separator.length, insert: " " }]),
        valid(source),
      );
    }
  }
  for (const { before, after, byte, deleteBytes, insert } of [
    {
      before: "for x\nin a; :\n",
      after: "for x\na; :\n",
      byte: 6,
      deleteBytes: 3,
      insert: "",
    },
    {
      before: "for x\na; :\n",
      after: "for x\nin a; :\n",
      byte: 6,
      deleteBytes: 0,
      insert: "in ",
    },
    {
      before: "for x (a) :\n",
      after: "for x (a) do :; done\n",
      byte: 10,
      deleteBytes: 1,
      insert: "do :; done",
    },
  ]) {
    assert.equal(valid(before, [{ byte, deleteBytes, insert }]), valid(after));
  }
});

test("parenthesized for word separators preserve word context across substitutions", () => {
  for (const first of ["a", "$(if :; then :; fi)", "<(print x)", "`print x`"]) {
    for (const body of [":", "do if :; then :; fi; done"]) {
      const source = `for x (${first} if) ${body}\n`;
      const byte = source.indexOf(" if)");
      for (const separator of ["\n", "; ", " # words\n"]) {
        const changed =
          source.slice(0, byte) + separator + source.slice(byte + 1);
        assert.equal(
          valid(source, [{ byte, deleteBytes: 1, insert: separator }]),
          valid(changed),
        );
        assert.equal(
          valid(changed, [
            { byte, deleteBytes: separator.length, insert: " " },
          ]),
          valid(source),
        );
      }
    }
  }
});

test("editing optional header separators preserves fresh and incremental agreement", () => {
  for (const { source, byte } of [
    { source: "for x (a) : && :\n", byte: 9 },
    { source: "for ((;0;)) : && :\n", byte: 11 },
    { source: "for ((;0;)) { :; }\n", byte: 11 },
    { source: "for ((;0;)) do :; done\n", byte: 11 },
    { source: "repeat 2 :\n", byte: 8 },
    { source: "repeat 2 do :; done\n", byte: 8 },
    { source: "foreach x (a) { :; }\n", byte: 13 },
    { source: "foreach x (a) do :; done\n", byte: 13 },
    { source: "case x { }\n", byte: 6 },
    { source: "case x { }\n", byte: 8 },
    { source: "case x in esac\n", byte: 6 },
    { source: "case x in esac\n", byte: 9 },
  ]) {
    const insert = "; ;\n";
    const edited = source.slice(0, byte) + insert + source.slice(byte);
    assert.equal(
      valid(source, [{ byte, deleteBytes: 0, insert }]),
      valid(edited),
    );
    assert.equal(
      valid(edited, [{ byte, deleteBytes: insert.length, insert: "" }]),
      valid(source),
    );
  }
});

test("foreach body and terminator edits preserve ownership through nesting", () => {
  for (const [prefix, suffix] of [
    ["", "\nprint AFTER\n"],
    ["foreach outer (a)\n", "\nend\n"],
    ['print "$(', ')"\n'],
  ]) {
    const header = `${prefix}foreach inner (b) `;
    for (const { beforeBody, afterBody, byte, removed, inserted } of [
      {
        beforeBody: "{ :; }",
        afterBody: "do :; done",
        byte: 0,
        removed: "{ :; }",
        inserted: "do :; done",
      },
      {
        beforeBody: "{ :; }",
        afterBody: "{ :; }; end",
        byte: 6,
        removed: "",
        inserted: "; end",
      },
      {
        beforeBody: "{ :; }; end",
        afterBody: "{ :; } always { :; }; end",
        byte: 6,
        removed: "",
        inserted: " always { :; }",
      },
      {
        beforeBody: "do :; done",
        afterBody: ":; end",
        byte: 0,
        removed: "do :; done",
        inserted: ":; end",
      },
    ]) {
      const before = header + beforeBody + suffix;
      const after = header + afterBody + suffix;
      const edit = {
        byte: header.length + byte,
        deleteBytes: removed.length,
        insert: inserted,
      };
      const restore = {
        byte: header.length + byte,
        deleteBytes: inserted.length,
        insert: removed,
      };
      assert.equal(valid(before, [edit]), valid(after));
      assert.equal(valid(after, [restore]), valid(before));
      assert.equal(valid(before, [edit, restore]), valid(before));
    }
  }
});

test("removing a separator before then or do preserves a delimited condition", () => {
  for (const condition of ["{ :; }", "(:)", "[[ x ]]", "((1))"]) {
    for (const { prefix, suffix } of [
      { prefix: "if ", suffix: "then :; fi\n" },
      { prefix: "if false; then :; elif ", suffix: "then :; fi\n" },
      { prefix: "while ", suffix: "do :; done\n" },
      { prefix: "until ", suffix: "do :; done\n" },
    ]) {
      const source = `${prefix}${condition}; ${suffix}`;
      const byte = prefix.length + condition.length;
      const edited = `${prefix}${condition} ${suffix}`;
      assert.equal(
        valid(source, [{ byte, deleteBytes: 1, insert: "" }]),
        valid(edited),
      );
      assert.equal(
        valid(edited, [{ byte, deleteBytes: 0, insert: ";" }]),
        valid(source),
      );
    }
  }
});

test("adding and removing loop bodies preserves ownership across command contexts", () => {
  for (const header of [
    "for x; ",
    "for x in a; ",
    "for x (a); ",
    "for ((;0;)); ",
    "repeat 2; ",
  ]) {
    for (const [prefix, suffix] of [
      ["", ""],
      ["f() { ", " }"],
      ["(", ")"],
      ["x=$(", ")"],
      ["x=`", "`"],
      ["if ", " then :; fi"],
      ["if :; then ", " fi"],
      ["for y (b) do ", " done"],
      ["case x in x) ", ";; esac"],
      ["cat <<$(", ")\nBODY\n"],
    ]) {
      const head = prefix + header;
      const omitted = head + suffix;
      const fresh = valid(omitted);
      for (const body of [
        ":; ",
        ">out; ",
        ": && :; ",
        "do done; ",
        "{ :; }; ",
      ]) {
        const complete = head + body + suffix;
        assert.equal(
          valid(omitted, [{ byte: head.length, deleteBytes: 0, insert: body }]),
          valid(complete),
          complete,
        );
        assert.equal(
          valid(complete, [
            { byte: head.length, deleteBytes: body.length, insert: "" },
          ]),
          fresh,
          omitted,
        );
      }
    }
  }
});

test("logical layout comment edits retain their sublist ownership", () => {
  for (const operator of ["&&", "||"]) {
    for (const [prefix, suffix] of [
      ["", ""],
      ["while ", ""],
      ["until ", ""],
      ["x=`", "`"],
    ]) {
      const head = `${prefix}: ${operator} # tail`;
      const source = head + suffix;
      for (const ending of ["\n", "\n ;", "\n ; false"]) {
        const changed = head + ending + suffix;
        assert.equal(
          valid(source, [
            { byte: head.length, deleteBytes: 0, insert: ending },
          ]),
          valid(changed),
          changed,
        );
        assert.equal(
          valid(changed, [
            { byte: head.length, deleteBytes: ending.length, insert: "" },
          ]),
          valid(source),
          source,
        );
      }
    }
  }
});

for (const keyword of ["while", "until"]) {
  test(`${keyword} body insertion and removal preserve condition ownership in nested command sources`, () => {
    for (const { condition, body } of [
      { condition: "false; ", body: "do :; done" },
      { condition: "[[ x ]] ", body: ": && :" },
      { condition: "((0)) ", body: "{ :; }" },
      { condition: "[[ x ]]; { :; } ", body: "do :; done" },
    ]) {
      for (const [prefix, suffix] of [
        ["", ""],
        ["f() { ", "; }"],
        ["(", ")"],
        ["x=$(", ")"],
        ["x=`", "`"],
        ["if ", "; then :; fi"],
        ["if :; then ", "; fi"],
        ["repeat 1 do ", "; done"],
        ["case x in x) ", ";; esac"],
        ["cat <<$(", ")\nBODY\n"],
      ]) {
        const head = `${prefix}${keyword} ${condition}`;
        const omitted = head + suffix;
        const complete = head + body + suffix;
        const fresh = valid(omitted);
        assert.equal(
          valid(omitted, [{ byte: head.length, deleteBytes: 0, insert: body }]),
          valid(complete),
          complete,
        );
        assert.equal(
          valid(complete, [
            { byte: head.length, deleteBytes: body.length, insert: "" },
          ]),
          fresh,
          omitted,
        );
      }
    }
  });

  test(`${keyword} separator edits move a brace from the body into the condition`, () => {
    for (const [prefix, suffix] of [
      ["", ""],
      ["f() { ", "; }"],
      ["x=$(", ")"],
      ["cat <<$(", ")\nBODY\n"],
    ]) {
      const head = `${prefix}${keyword} [[ x ]]`;
      const tail = ` { :; }${suffix}`;
      const source = head + tail;
      for (const separator of [";", "\n", " # condition\n"]) {
        const changed = head + separator + tail;
        assert.equal(
          valid(source, [
            { byte: head.length, deleteBytes: 0, insert: separator },
          ]),
          valid(changed),
          changed,
        );
        assert.equal(
          valid(changed, [
            { byte: head.length, deleteBytes: separator.length, insert: "" },
          ]),
          valid(source),
          source,
        );
      }
    }
  });

  test(`${keyword} EOF comment edits preserve condition and program boundaries`, () => {
    for (const condition of ["", " false", " false;"]) {
      for (const [prefix, suffix] of [
        ["", ""],
        ["x=`", "`"],
      ]) {
        const head = `${prefix}${keyword}${condition} # tail`;
        const source = head + suffix;
        const changed = `${head}\n${suffix}`;
        assert.equal(
          valid(source, [{ byte: head.length, deleteBytes: 0, insert: "\n" }]),
          valid(changed),
          changed,
        );
        assert.equal(
          valid(changed, [{ byte: head.length, deleteBytes: 1, insert: "" }]),
          valid(source),
          source,
        );
      }
    }
  });
}

test("if and final elif body edits preserve their condition and enclosing boundaries", () => {
  for (const branch of ["if ", "if false; then :; elif "]) {
    for (const { condition, body } of [
      { condition: "false; ", body: "then :; fi" },
      { condition: "[[ x ]] ", body: ": && :" },
      { condition: "[[ x ]]; { :; } ", body: "then :; fi" },
    ]) {
      for (const [prefix, suffix] of [
        ["", ""],
        ["f() { ", "; }"],
        ["(", ")"],
        ["x=$(", ")"],
        ["x=`", "`"],
        ["if :; then ", "; fi"],
        ["repeat 1 do ", "; done"],
        ["case x in x) ", ";; esac"],
        ["cat <<$(", ")\nBODY\n"],
      ]) {
        const head = prefix + branch + condition;
        const omitted = head + suffix;
        const complete = head + body + suffix;
        assert.equal(
          valid(omitted, [{ byte: head.length, deleteBytes: 0, insert: body }]),
          valid(complete),
          complete,
        );
        assert.equal(
          valid(complete, [
            { byte: head.length, deleteBytes: body.length, insert: "" },
          ]),
          valid(omitted),
          omitted,
        );
      }
    }
  }
});

test("if separator edits move a brace body into the condition", () => {
  for (const [prefix, suffix] of [
    ["", ""],
    ["f() { ", "; }"],
    ["x=$(", ")"],
    ["cat <<$(", ")\nBODY\n"],
  ]) {
    const head = `${prefix}if [[ x ]]`;
    const tail = ` { :; }${suffix}`;
    for (const separator of [";", "\n", " # condition\n"]) {
      const before = head + tail;
      const after = head + separator + tail;
      assert.equal(
        valid(before, [
          { byte: head.length, deleteBytes: 0, insert: separator },
        ]),
        valid(after),
        after,
      );
      assert.equal(
        valid(after, [
          { byte: head.length, deleteBytes: separator.length, insert: "" },
        ]),
        valid(before),
        before,
      );
    }
  }
});

test("mixed if branches retain closure ownership when their final body changes", () => {
  for (const [prefix, bodies] of [
    ["if :; then :; elif [[ x ]] ", ["", "then :; fi", "{ :; } fi"]],
    ["if [[ x ]] { :; } elif [[ x ]] ", ["", "then :; fi", "{ :; }"]],
  ]) {
    for (const beforeBody of bodies) {
      const afterBody = ":";
      const before = prefix + beforeBody;
      const after = prefix + afterBody;
      assert.equal(
        valid(before, [
          {
            byte: prefix.length,
            deleteBytes: beforeBody.length,
            insert: afterBody,
          },
        ]),
        valid(after),
        after,
      );
      assert.equal(
        valid(after, [
          {
            byte: prefix.length,
            deleteBytes: afterBody.length,
            insert: beforeBody,
          },
        ]),
        valid(before),
        before,
      );
    }
  }
});

test("if EOF comment edits retain the source condition without adding a body", () => {
  for (const branch of ["if", "if :; then :; elif"]) {
    for (const condition of ["", " false", " false;", " false &&"]) {
      for (const [prefix, suffix] of [
        ["", ""],
        ["x=`", "`"],
      ]) {
        const head = `${prefix}${branch}${condition} # tail`;
        const before = head + suffix;
        const after = `${head}\n${suffix}`;
        assert.equal(
          valid(before, [{ byte: head.length, deleteBytes: 0, insert: "\n" }]),
          valid(after),
          after,
        );
        assert.equal(
          valid(after, [{ byte: head.length, deleteBytes: 1, insert: "" }]),
          valid(before),
          before,
        );
      }
    }
  }
});

test("keyword function body edits preserve named and anonymous headers across contexts", () => {
  for (const header of [
    "function",
    "function -T --",
    "function f",
    "function f :",
    "function ()",
    "function f ()",
    "function f; # header\n",
  ]) {
    for (const body of [" { :; }", " ; : && :", " >out :", " >out"]) {
      for (const [prefix, suffix] of [
        ["", ""],
        ["{ ", "; }"],
        ["(", ")"],
        ["x=$(", ")"],
        ["x=`", "`"],
        ["if :; then ", "; fi"],
        ["case x in x) ", ";; esac"],
        ["cat <<$(", ")\nBODY\n"],
      ]) {
        const head = prefix + header;
        const omitted = head + suffix;
        const complete = head + body + suffix;
        assert.equal(
          valid(omitted, [{ byte: head.length, deleteBytes: 0, insert: body }]),
          valid(complete),
          complete,
        );
        assert.equal(
          valid(complete, [
            { byte: head.length, deleteBytes: body.length, insert: "" },
          ]),
          valid(omitted),
          omitted,
        );
      }
    }
  }
});

test("keyword function header edits move words between names and the actual body", () => {
  for (const source of [
    "function f g",
    "function f :",
    "function f print BODY",
  ]) {
    for (const ending of [";", "\n", "()", " # header\n"]) {
      const byte = "function f".length;
      const changed = source.slice(0, byte) + ending + source.slice(byte);
      assert.equal(
        valid(source, [{ byte, deleteBytes: 0, insert: ending }]),
        valid(changed),
        changed,
      );
      assert.equal(
        valid(changed, [{ byte, deleteBytes: ending.length, insert: "" }]),
        valid(source),
        source,
      );
    }
  }
});

test("bodyless keyword functions retain outer logical pipeline and asynchronous operators", () => {
  for (const header of [
    "function",
    "function f",
    "function ()",
    "function f ()",
  ]) {
    for (const operator of ["&&", "||", "|", "|&", "&", "&!", "&|"]) {
      const source = `${header} ${operator} :`;
      const changed = `${header} { :; } ${operator} :`;
      const body = " { :; }";
      assert.equal(
        valid(source, [{ byte: header.length, deleteBytes: 0, insert: body }]),
        valid(changed),
        changed,
      );
      assert.equal(
        valid(changed, [
          { byte: header.length, deleteBytes: body.length, insert: "" },
        ]),
        valid(source),
        source,
      );
    }
  }
});

test("keyword function EOF comment edits preserve header boundaries", () => {
  for (const header of [
    "function",
    "function f",
    "function f ()",
    "function f;",
  ]) {
    for (const [prefix, suffix] of [
      ["", ""],
      ["x=`", "`"],
    ]) {
      const head = `${prefix}${header} # header`;
      for (const ending of ["\n", "\n :"]) {
        const source = head + suffix;
        const changed = head + ending + suffix;
        assert.equal(
          valid(source, [
            { byte: head.length, deleteBytes: 0, insert: ending },
          ]),
          valid(changed),
          changed,
        );
        assert.equal(
          valid(changed, [
            { byte: head.length, deleteBytes: ending.length, insert: "" },
          ]),
          valid(source),
          source,
        );
      }
    }
  }
});

test("removing case pattern parentheses preserves both heredoc delimiter occurrences", () => {
  const before =
    "cat <<$(case x in (x) :;; esac)\nbody\n$(case x in (x) :;; esac)\nprint after\n";
  const after =
    "cat <<$(case x in x) :;; esac)\nbody\n$(case x in x) :;; esac)\nprint after\n";
  assert.equal(
    valid(before, [
      { byte: before.lastIndexOf("(x)"), deleteBytes: 1, insert: "" },
      { byte: before.indexOf("(x)"), deleteBytes: 1, insert: "" },
    ]),
    valid(after),
  );
});

test("editing a delimiter substitution preserves the document boundary", () => {
  for (const { before, byte, deleteBytes, insert, after } of [
    {
      before: "cat <<$(print X\n)\n$foo\n",
      byte: 15,
      deleteBytes: 0,
      insert: " # ) '\n# (",
      after: "cat <<$(print X # ) '\n# (\n)\n$foo\n",
    },
    {
      before: "cat <<$(cat <<'E'\nx\nE\n)\n$foo\n",
      byte: 18,
      deleteBytes: 1,
      insert: ")",
      after: "cat <<$(cat <<'E'\n)\nE\n)\n$foo\n",
    },
    {
      before: "cat <<$(print E)\nbody\n$(print E)\nprint after\n",
      byte: 15,
      deleteBytes: 0,
      insert: "\\\n",
      after: "cat <<$(print E\\\n)\nbody\n$(print E)\nprint after\n",
    },
  ]) {
    assert.equal(valid(before, [{ byte, deleteBytes, insert }]), valid(after));
    assert.equal(
      valid(after, [
        {
          byte,
          deleteBytes: insert.length,
          insert: before.slice(byte, byte + deleteBytes),
        },
      ]),
      valid(before),
    );
  }
});

test("editing after a trailing backslash updates its escape and continuation boundaries", () => {
  for (const [source, byte, insert, expected] of [
    ["print x \\", 9, "y", "print x \\y"],
    ["print x\\", 8, "\n", "print x\\\n"],
    ["print x \\", 9, "\n", "print x \\\n"],
  ]) {
    assert.equal(
      valid(source, [{ byte, deleteBytes: 0, insert }]),
      valid(expected),
    );
    assert.equal(
      valid(expected, [{ byte, deleteBytes: 1, insert: "" }]),
      valid(source),
    );
  }
});

test("editing before a closing backquote updates the inner trailing escape", () => {
  for (const [source, byte, expected] of [
    ["print `print x \\\\` after\n", 17, "print `print x \\\\y` after\n"],
    ["a[`print 1 \\\\`]=x\n", 13, "a[`print 1 \\\\y`]=x\n"],
  ]) {
    assert.equal(
      valid(source, [{ byte, deleteBytes: 0, insert: "y" }]),
      valid(expected),
    );
    assert.equal(
      valid(expected, [{ byte, deleteBytes: 1, insert: "" }]),
      valid(source),
    );
  }
});

test("adding always moves outer redirections from the brace to the whole clause", () => {
  assert.equal(
    valid(">before { :; } >after\n", [
      { byte: 14, deleteBytes: 0, insert: " always { :; }" },
    ]),
    valid(">before { :; } always { :; } >after\n"),
  );
});

test("joining closing braces preserves both enclosing commands", () => {
  assert.equal(
    valid("{ { :; } }\n", [{ byte: 8, deleteBytes: 1, insert: "" }]),
    valid("{ { :; }}\n"),
  );
  assert.equal(
    valid("{ { :; }}\n", [{ byte: 8, deleteBytes: 0, insert: "\\\n" }]),
    valid("{ { :; }\\\n}\n"),
  );
});

test("joining a quoted heredoc prefix preserves the matching delimiter", () => {
  assert.equal(
    valid('cat <<"$\\\n("E")"\nbody\n$("E")\nprint AFTER\n', [
      { byte: 8, deleteBytes: 2, insert: "" },
    ]),
    valid('cat <<"$("E")"\nbody\n$("E")\nprint AFTER\n'),
  );
});

test("editing an empty regex group preserves its shell operand", () => {
  assert.equal(
    valid("[[ x =~ () ]]\n", [{ byte: 9, deleteBytes: 0, insert: "a" }]),
    valid("[[ x =~ (a) ]]\n"),
  );
});

test("editing a continuation after a bracket keeps its first closing bracket literal", () => {
  assert.equal(
    valid("print []a]\n", [{ byte: 7, deleteBytes: 0, insert: "\\\n" }]),
    valid("print [\\\n]a]\n"),
  );
});

test("continuations inside numeric ranges preserve their pattern structure", () => {
  assert.equal(
    valid("cat <1-2>out\n", [{ byte: 6, deleteBytes: 0, insert: "\\\n" }]),
    valid("cat <1\\\n-2>out\n"),
  );
  assert.equal(
    valid("a[<1\\\n-2>]=x\n", [{ byte: 4, deleteBytes: 2, insert: "" }]),
    valid("a[<1-2>]=x\n"),
  );
});

test("continuation edits preserve arithmetic and quoted expansion structure", () => {
  for (const [source, byte, expected] of [
    ["((:))\n", 1, "(\\\n(:))\n"],
    ["print $((:))\n", 11, "print $((:)\\\n)\n"],
    ['print "$(print x)"\n', 8, 'print "$\\\n(print x)"\n'],
  ]) {
    assert.equal(
      valid(source, [{ byte, deleteBytes: 0, insert: "\\\n" }]),
      valid(expected),
    );
    assert.equal(
      valid(expected, [{ byte, deleteBytes: 2, insert: "" }]),
      valid(source),
    );
  }
});

test("joining empty for parentheses preserves the word list", () => {
  assert.equal(
    valid("for x ( ) :\n", [{ byte: 7, deleteBytes: 1, insert: "" }]),
    valid("for x () :\n"),
  );
  assert.equal(
    valid("for x () { :; } | :\n", [{ byte: 7, deleteBytes: 0, insert: "a" }]),
    valid("for x (a) { :; } | :\n"),
  );
});

test("a redirect before a loop brace preserves its sublist body", () => {
  assert.equal(
    valid("repeat 0 { :; } | :\n", [
      { byte: 9, deleteBytes: 0, insert: ">file " },
    ]),
    valid("repeat 0 >file { :; } | :\n"),
  );
  assert.equal(
    valid("foreach x (a) { :; }; end\n", [
      { byte: 14, deleteBytes: 0, insert: ">file " },
    ]),
    valid("foreach x (a) >file { :; }; end\n"),
  );
});

test("inserting a command repairs adjacent asynchronous separators", () => {
  assert.equal(
    valid(": & & :\n", [{ byte: 4, deleteBytes: 0, insert: ": " }]),
    valid(": & : & :\n"),
  );
});

test("a continuation preserves function parentheses", () => {
  assert.equal(
    valid("f() :\n", [{ byte: 2, deleteBytes: 0, insert: "\\\n" }]),
    valid("f(\\\n) :\n"),
  );
});

test("continuations preserve redirection operators and numeric descriptors", () => {
  for (const [source, byte, expected] of [
    ["cat >!file\n", 5, "cat >\\\n!file\n"],
    ["cat 2>file\n", 5, "cat 2\\\n>file\n"],
    ["cat >(x)\n", 5, "cat >\\\n(x)\n"],
  ]) {
    assert.equal(
      valid(source, [{ byte, deleteBytes: 0, insert: "\\\n" }]),
      valid(expected),
    );
  }
});

test("joining a parenthesized filename preserves the whole redirection operator", () => {
  assert.equal(
    valid("cat &> (x)\nprint after\n", [
      { byte: 6, deleteBytes: 1, insert: "" },
    ]),
    valid("cat &>(x)\nprint after\n"),
  );
  assert.equal(
    valid("cat >>(x)\nprint after\n", [
      { byte: 6, deleteBytes: 0, insert: "|" },
    ]),
    valid("cat >>|(x)\nprint after\n"),
  );
});

test("splitting a dollar quote prefix preserves its content and following command", () => {
  assert.equal(
    valid("print $'x'\nprint after\n", [
      { byte: 7, deleteBytes: 0, insert: "\\\n" },
    ]),
    valid("print $\\\n'x'\nprint after\n"),
  );
});

test("removing a word brace prefix restores the following pattern boundary", () => {
  assert.equal(
    valid("print {x(a|b)}\n", [{ byte: 7, deleteBytes: 1, insert: "" }]),
    valid("print {(a|b)}\n"),
  );
});

test("editing a case pattern preserves its process substitution boundary", () => {
  assert.equal(
    valid("case x in =(print x)) :;; esac\n", [
      { byte: 10, deleteBytes: 1, insert: "<" },
    ]),
    valid("case x in <(print x)) :;; esac\n"),
  );
});

test("quoting a braced parameter changes the ownership of a literal closing brace", () => {
  assert.equal(
    valid(`print \${x:-{a}}\n`, [
      { byte: 15, deleteBytes: 0, insert: '"' },
      { byte: 6, deleteBytes: 0, insert: '"' },
    ]),
    valid(`print "\${x:-{a}}"\n`),
  );
  assert.equal(
    valid(`print "\${x:-a}"\n`, [{ byte: 12, deleteBytes: 0, insert: "'" }]),
    valid(`print "\${x:-'a}"\n`),
  );
});

test("editing braces in a flag argument preserves its outer parameter", () => {
  assert.equal(
    valid(`print \${(s:{a}:)x}\n`, [
      { byte: 12, deleteBytes: 1, insert: `\${y}` },
    ]),
    valid(`print \${(s:{\${y}}:)x}\n`),
  );
});

test("editing a complete exec option updates the next command word", () => {
  assert.equal(
    valid("exec -a /bin/echo output\n", [
      { byte: 7, deleteBytes: 0, insert: "}x" },
    ]),
    valid("exec -a}x /bin/echo output\n"),
  );
});

test("joining a pattern group to a reserved spelling changes the command role", () => {
  assert.equal(
    valid("if (a) arg\n", [{ byte: 2, deleteBytes: 1, insert: "" }]),
    valid("if(a) arg\n"),
  );
  assert.equal(
    valid("exec arg\n", [{ byte: 4, deleteBytes: 0, insert: "}x" }]),
    valid("exec}x arg\n"),
  );
});

test("editing arithmetic brackets changes between arithmetic and subshell parsing", () => {
  assert.equal(
    valid("print $((1))\n", [{ byte: 10, deleteBytes: 0, insert: "]" }]),
    valid("print $((1]))\n"),
  );
  assert.equal(
    valid("print $((##a))\n", [{ byte: 11, deleteBytes: 1, insert: '"' }]),
    valid('print $((##"))\n'),
  );
});

test("removing a nested candidate subscript end preserves its enclosing parameter", () => {
  assert.equal(
    valid(`print \${x:-$a[1]}after]\n`, [
      { byte: 15, deleteBytes: 1, insert: "" },
    ]),
    valid(`print \${x:-$a[1}after]\n`),
  );
});

test("changing a heredoc terminator reparses the following command", () => {
  const before = "cat <<E\nbody\nE\nprint after\n";
  const after = "cat <<END\nbody\nEND\nprint after\n";
  assert.equal(
    valid(before, [
      { byte: 6, deleteBytes: 1, insert: "END" },
      { byte: 15, deleteBytes: 1, insert: "END" },
    ]),
    valid(after),
  );
});

for (const [before, after] of [
  [
    "print `cat <<E\nbody\nE`\nprint after\n",
    "print `cat <<E\nbody\nE\n`\nprint after\n",
  ],
  [
    "print \"`cat <<-'E'\n\tbody\n\tE`\"\nprint after\n",
    "print \"`cat <<-'E'\n\tbody\n\tE\n`\"\nprint after\n",
  ],
  [
    "print `print \\`cat <<E\nbody\nE\\``\nprint after\n",
    "print `print \\`cat <<E\nbody\nE\n\\``\nprint after\n",
  ],
]) {
  test(`editing the newline before a closing backquote matches fresh parsing in ${JSON.stringify(before)}`, () => {
    const byte = before.lastIndexOf("E") + 1;
    const insert = { byte, deleteBytes: 0, insert: "\n" };
    const remove = { byte, deleteBytes: 1, insert: "" };
    const initial = valid(before);
    assert.equal(valid(before, [insert]), valid(after));
    assert.equal(valid(after, [remove]), initial);
    assert.equal(valid(before, [insert, remove]), initial);
  });
}

test("enabling heredoc tab stripping also normalizes the quoted delimiter", () => {
  assert.equal(
    valid("cat <<$'\\tE'\nbody\nE\nprint after\n", [
      { byte: 6, deleteBytes: 0, insert: "-" },
    ]),
    valid("cat <<-$'\\tE'\nbody\nE\nprint after\n"),
  );
});

test("editing inside nested heredoc input restores outer scanner state", () => {
  const source = "cat <<OUT\n$(cat <<IN\ninner\nIN\n)\nOUT\nprint after\n";
  const replacement = "changed";
  assert.equal(
    valid(source, [{ byte: 21, deleteBytes: 5, insert: replacement }]),
    valid("cat <<OUT\n$(cat <<IN\nchanged\nIN\n)\nOUT\nprint after\n"),
  );
});

test("removing enclosing quotes restores modifier word boundaries", () => {
  assert.equal(
    valid('print "$x:s/a/b c"\n', [
      { byte: 6, deleteBytes: 1, insert: "" },
      { byte: 16, deleteBytes: 1, insert: "" },
    ]),
    valid("print $x:s/a/b c\n"),
  );
});

test("bracing a nested parameter changes modifier ownership after editing", () => {
  assert.equal(
    valid(`print \${x:-$y:h3}\n`, [
      { byte: 12, deleteBytes: 0, insert: "{" },
      { byte: 18, deleteBytes: 0, insert: "}" },
    ]),
    valid(`print \${x:-\${y:h3}}\n`),
  );
});

test("editing escaped heredoc bytes changes the terminator and preserves following commands", () => {
  assert.equal(
    valid("cat <<$'\\x41'\nbody\nA\nprint after\n", [
      { byte: 19, deleteBytes: 1, insert: "é" },
      { byte: 8, deleteBytes: 4, insert: "\\xC3\\xA9" },
    ]),
    valid("cat <<$'\\xC3\\xA9'\nbody\né\nprint after\n"),
  );
});

test("editing the word after a command prefix into another prefix element or a command name matches fresh parsing", () => {
  assert.equal(
    valid("> /dev/null time print yes\n", [
      { byte: 14, deleteBytes: 3, insert: "" },
    ]),
    valid("> /dev/null tiprint yes\n"),
  );
  assert.equal(
    valid("> out function f; :\n", [{ byte: 9, deleteBytes: 1, insert: "" }]),
    valid("> out funtion f; :\n"),
  );
  assert.equal(
    valid("x=1 >out typeset y\n", [{ byte: 13, deleteBytes: 0, insert: "=" }]),
    valid("x=1 >out type=set y\n"),
  );
});
