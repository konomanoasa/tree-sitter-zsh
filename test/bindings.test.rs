use konomanoasa_tree_sitter_zsh as grammar;
use tree_sitter::{Parser, Query, QueryCursor, StreamingIterator};

#[test]
fn parses_valid_source() {
  let source = "# sample\ncat <<E\n$expanded\nE\n";
  for (name, language, nodes) in [
    ("zsh", grammar::LANGUAGE, grammar::NODE_TYPES),
    (
      "zsh_extended_glob",
      grammar::LANGUAGE_EXTENDED_GLOB,
      grammar::NODE_TYPES_EXTENDED_GLOB,
    ),
  ] {
    let language = language.into();
    let mut parser = Parser::new();
    parser.set_language(&language).unwrap();
    assert_eq!(language.name(), Some(name));
    let tree = parser.parse(source, None).unwrap();
    let root = tree.root_node();
    assert_eq!(root.kind(), "program");
    assert_eq!(root.byte_range(), 0..source.len());
    assert!(!root.has_error());
    assert!(nodes.contains("\"program\""));
    let query = Query::new(&language, grammar::HIGHLIGHTS_QUERY).unwrap();
    let mut cursor = QueryCursor::new();
    let mut captures = cursor.captures(&query, root, source.as_bytes());
    let mut actual = Vec::new();
    while let Some((matched, index)) = captures.next() {
      let capture = matched.captures()[*index];
      if query.capture_names()[capture.index as usize] == "comment" {
        actual.push(capture.node.utf8_text(source.as_bytes()).unwrap());
      }
    }
    assert_eq!(actual, ["# sample"]);
  }
}
