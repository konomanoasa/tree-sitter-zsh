export const scaleFactors = [1, 2, 4];

export const representativeSource = `function show { print -r -- "\${(j:,:)items}"; }
items=(one two [3]=three)
for item (one two) { [[ $item == [a-z]* ]] && print $item; }
if ((1)) { print yes; }
repeat 2 do (( count += 1 )); done
case $item in (one|two) show;; (*) print other;; esac
cat <<OUT
$(print "\${item:-none}")
OUT
`;

export function nestedForSubstitutions(depth) {
  return `${"for x in $(".repeat(depth)}:${"); do :; done".repeat(depth)}\n`;
}

export const scalingWorkloads = [
  {
    name: "command lists",
    units: 256,
    source: (n) => "print value\n".repeat(n),
  },
  {
    name: "array elements",
    units: 1024,
    source: (n) => `items=(${"value ".repeat(n)})\n`,
  },
  {
    name: "unquoted words",
    units: 64 * 1024,
    source: (n) => `print ${"x".repeat(n)}\n`,
  },
  {
    name: "heredoc bodies",
    units: 64 * 1024,
    source: (n) => `cat <<E\n${"x".repeat(n)}\nE\n`,
  },
  {
    name: "regex closing braces",
    units: 64 * 1024,
    source: (n) => `[[ x =~ ${"}".repeat(n)}x ]]\n`,
  },
  {
    name: "parameter flag command source",
    units: 64 * 1024,
    source: (n) => `print \${(j:$(print ${"x".repeat(n)}):)items}\n`,
  },
  {
    name: "nested arithmetic expansions",
    units: 4,
    source: (n) => `print ${"$((".repeat(n)}1${"))".repeat(n)}\n`,
  },
  {
    name: "nested for substitutions",
    units: 8,
    source: nestedForSubstitutions,
  },
  {
    name: "static arithmetic expressions",
    units: 256,
    source: (n) => `print $((1${" + 2 * 3".repeat(n)}))\n`,
  },
  {
    name: "subscript arithmetic candidates",
    units: 256,
    source: (n) => `print \${a[1${" + 2 * 3".repeat(n)}]}\n`,
  },
  {
    name: "array key arithmetic candidates",
    units: 256,
    source: (n) => `a=([1${"+2*3".repeat(n)}]=value)\n`,
  },
  {
    name: "arithmetic function argument candidates",
    units: 256,
    source: (n) => `((f(1${" + 2 * 3".repeat(n)})))\n`,
  },
  {
    name: "subscript pattern candidates",
    units: 256,
    source: (n) => `print \${a[(r)foo${"~a#".repeat(n)}]}\n`,
  },
  {
    name: "arithmetic expressions with a dynamic tail",
    units: 256,
    source: (n) => `print $((1${" + 2 * 3".repeat(n)} + $x))\n`,
  },
  {
    name: "arithmetic assignments with a dynamic tail",
    units: 256,
    source: (n) => `(( ${"a=".repeat(n)}$x ))\n`,
  },
  {
    name: "arithmetic updates with a dynamic tail",
    units: 256,
    source: (n) => `(( ${"a++ + ".repeat(n)}$x ))\n`,
  },
  {
    name: "arithmetic unary expressions with a dynamic tail",
    units: 256,
    source: (n) => `(( ${"-1 + ".repeat(n)}$x ))\n`,
  },
  {
    name: "arithmetic argument assignments with a dynamic tail",
    units: 256,
    source: (n) => `((f(${"a=".repeat(n)}$x)))\n`,
  },
  {
    name: "extended pattern exclusions",
    units: 256,
    source: (n) => `print *${"~a#".repeat(n)}\n`,
  },
  {
    name: "explicit glob qualifier chains",
    units: 256,
    source: (n) => `print *${"(#qN)".repeat(n)}\n`,
  },
  {
    name: "nested loop bodies",
    units: 128,
    source: (n) => `${"while ((0)) { ".repeat(n)}:${"; }".repeat(n)}\n`,
  },
  {
    name: "nested positional foreach brace bodies",
    units: 128,
    source: (n) => `${"foreach x { ".repeat(n)}:${"; }".repeat(n)}\n`,
  },
  {
    name: "nested positional foreach list bodies",
    units: 128,
    source: (n) => `${"foreach x; ".repeat(n)}:${"; end".repeat(n)}\n`,
  },
];
