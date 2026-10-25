fn main() {
  let mut build = cc::Build::new();
  build.std("c17");

  println!("cargo::rerun-if-changed=src");
  build
    .include("src")
    .files(["src/parser.c", "src/scanner.c"])
    .compile("tree-sitter-zsh");
}
