use std::path::Path;

fn main() {
  let mut build = cc::Build::new();
  build.std("c17");
  let grammars = [
    ("src", "tree-sitter-zsh"),
    ("zsh_default/src", "tree-sitter-zsh-default"),
  ];
  for (directory, _) in grammars {
    println!("cargo::rerun-if-changed={directory}");
  }
  for header in ["common/input.h", "common/scanner.h", "common/source.h"] {
    println!("cargo::rerun-if-changed={header}");
  }
  for (directory, library) in grammars {
    let directory = Path::new(directory);
    build
      .clone()
      .include(directory)
      .files([directory.join("parser.c"), directory.join("scanner.c")])
      .compile(library);
  }
}
