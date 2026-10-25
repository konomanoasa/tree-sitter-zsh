use tree_sitter::{InputEdit, Node, Parser, Point, Query, Range};

fn languages() -> [tree_sitter_language::LanguageFn; 2] {
  [
    konomanoasa_tree_sitter_zsh::LANGUAGE,
    konomanoasa_tree_sitter_zsh::LANGUAGE_DEFAULT,
  ]
}

fn parser(language: tree_sitter_language::LanguageFn) -> Parser {
  let mut parser = Parser::new();
  parser.set_language(&language.into()).unwrap();
  parser
}

fn position(source: &[u8], byte: usize) -> Point {
  let prefix = &source[..byte];
  Point::new(
    prefix.iter().filter(|&&byte| byte == b'\n').count(),
    prefix
      .iter()
      .rposition(|&byte| byte == b'\n')
      .map_or(byte, |newline| byte - newline - 1),
  )
}

fn structure(node: Node<'_>, source: &[u8]) -> String {
  let mut result = format!(
    "{} {:?} {:?} {:?} {} {} {}",
    node.kind(),
    node.byte_range(),
    node.start_position(),
    node.end_position(),
    node.is_named(),
    node.is_missing(),
    node.has_error(),
  );
  assert!(node.start_byte() <= node.end_byte());
  assert!(node.end_byte() <= source.len());
  assert_eq!(node.start_position(), position(source, node.start_byte()));
  assert_eq!(node.end_position(), position(source, node.end_byte()));
  if node.child_count() == 0 {
    result.push_str(&format!(" {:?}", &source[node.byte_range()]));
  } else {
    let mut previous_end = node.start_byte();
    for index in 0..node.child_count() {
      let child = node.child(index).unwrap();
      assert!(child.start_byte() >= previous_end);
      assert!(child.end_byte() <= node.end_byte());
      previous_end = child.end_byte();
      result.push_str(&format!(
        "\n{:?} {}",
        node.field_name_for_child(index),
        structure(child, source),
      ));
    }
  }
  result
}

#[test]
fn language_parses_a_command_with_named_arguments() {
  for language in languages() {
    let mut parser = parser(language);
    let tree = parser.parse("print hello\n", None).unwrap();
    assert!(!tree.root_node().has_error());
    let command = tree
      .root_node()
      .named_child(0)
      .unwrap()
      .named_child(0)
      .unwrap()
      .named_child(0)
      .unwrap()
      .named_child(0)
      .unwrap()
      .named_child(0)
      .unwrap();
    assert_eq!(command.kind(), "simple_command");
    assert_eq!(
      command.child_by_field_name("argument").unwrap().kind(),
      "word"
    );
  }
}

#[test]
fn binding_exposes_a_query_that_compiles_against_the_language() {
  for language in languages() {
    let language = language.into();
    let query =
      Query::new(&language, konomanoasa_tree_sitter_zsh::HIGHLIGHTS_QUERY)
        .unwrap();
    assert!(query.capture_names().contains(&"variable"));
    assert!(query.capture_names().contains(&"punctuation.special"));
  }
}

#[test]
fn chunked_input_preserves_utf8_quotes_and_heredoc_boundaries() {
  for language in languages() {
    let text = "print 日本語\\\n続き\ncat <<'Σ'\n$literal\nΣ\ncat <<$'\\xC3\\xA9'\nbody\né\nprint \"${x:-$(print y)}\"\n";
    let source = text.as_bytes();
    let mut parser = parser(language);
    let complete = parser.parse(source, None).unwrap();
    assert!(!complete.root_node().has_error());
    let expected = structure(complete.root_node(), source);
    for chunk_bytes in [1, 2, 3, 5, 17] {
      let tree = parser
        .parse_with_options(
          &mut |offset, _| {
            let mut end = source.len().min(offset + chunk_bytes);
            while !text.is_char_boundary(end) {
              end += 1;
            }
            &source[offset..end]
          },
          None,
          None,
        )
        .unwrap();
      assert_eq!(structure(tree.root_node(), source), expected);
    }
  }
}

#[test]
fn nul_inside_quotes_and_heredoc_content_does_not_end_the_input() {
  for language in languages() {
    for source in [
      b"print 'a\0b' tail\n".as_slice(),
      b"cat <<E\na\0b\nE\nprint tail\n".as_slice(),
      b"cat <<$'E\\0F'\nbody\nE\0F\nprint tail\n".as_slice(),
    ] {
      let tree = parser(language).parse(source, None).unwrap();
      assert!(!tree.root_node().has_error(), "{:?}", source);
      assert_eq!(tree.root_node().end_byte(), source.len());
      structure(tree.root_node(), source);
    }
  }
}

#[test]
fn only_the_bom_at_source_byte_zero_is_excluded() {
  for language in languages() {
    let source = "\u{feff}print \u{feff}word\n".as_bytes();
    let tree = parser(language).parse(source, None).unwrap();
    let root = tree.root_node();
    assert!(!root.has_error());
    assert_eq!(root.start_byte(), 3);
    assert_eq!(root.end_byte(), source.len());
    assert!(
      structure(root, source).contains("[239, 187, 191, 119, 111, 114, 100]")
    );
  }
}

#[test]
fn disjoint_included_ranges_preserve_original_source_positions() {
  for language in languages() {
    let source = b"excluded\nprint a\nexcluded\nprint b\nexcluded";
    let ranges = [
      Range {
        start_byte: 9,
        end_byte: 17,
        start_point: Point::new(1, 0),
        end_point: Point::new(2, 0),
      },
      Range {
        start_byte: 26,
        end_byte: 34,
        start_point: Point::new(3, 0),
        end_point: Point::new(4, 0),
      },
    ];
    let mut parser = parser(language);
    parser.set_included_ranges(&ranges).unwrap();
    let tree = parser.parse(source, None).unwrap();
    assert!(!tree.root_node().has_error());
    assert_eq!(tree.root_node().start_byte(), 9);
    assert_eq!(tree.root_node().end_byte(), 34);
    let snapshot = structure(tree.root_node(), source);
    assert!(snapshot.contains("literal 15..16"));
    assert!(snapshot.contains("literal 32..33"));
    parser.set_included_ranges(&[]).unwrap();
    let complete = parser.parse(b"print restored\n", None).unwrap();
    assert!(!complete.root_node().has_error());
    assert_eq!(complete.root_node().start_byte(), 0);
  }
}

#[test]
fn a_bom_at_a_nonzero_included_range_start_is_literal_source() {
  for language in languages() {
    let source = "skip\u{feff}print\n".as_bytes();
    let mut parser = parser(language);
    parser
      .set_included_ranges(&[Range {
        start_byte: 4,
        end_byte: source.len(),
        start_point: Point::new(0, 4),
        end_point: Point::new(1, 0),
      }])
      .unwrap();
    let tree = parser.parse(source, None).unwrap();
    assert!(!tree.root_node().has_error());
    assert_eq!(tree.root_node().start_byte(), 4);
    assert!(structure(tree.root_node(), source).contains("literal 4..12"));
  }
}

#[test]
fn an_empty_included_range_uses_the_requested_source_position() {
  for language in languages() {
    let source = b"print before\nprint after\n";
    let mut parser = parser(language);
    for byte in [0, 6, 13, source.len()] {
      let point = position(source, byte);
      parser
        .set_included_ranges(&[Range {
          start_byte: byte,
          end_byte: byte,
          start_point: point,
          end_point: point,
        }])
        .unwrap();
      let tree = parser.parse(source, None).unwrap();
      assert!(!tree.root_node().has_error());
      assert_eq!(tree.root_node().byte_range(), byte..byte);
      assert_eq!(tree.root_node().start_position(), point);
      let reused = parser.parse(source, Some(&tree)).unwrap();
      assert_eq!(
        structure(tree.root_node(), source),
        structure(reused.root_node(), source)
      );
    }
  }
}

#[test]
fn moving_a_bom_between_byte_zero_and_word_content_matches_fresh_parsing() {
  for language in languages() {
    let leading = "\u{feff}print x\n".as_bytes();
    let ordinary = b"print x\n".as_slice();
    let embedded = "print \u{feff}x\n".as_bytes();
    let mut parser = parser(language);
    let mut tree = parser.parse(leading, None).unwrap();
    for (source, edited, start, old_end, new_end) in [
      (leading, ordinary, 0, 3, 0),
      (ordinary, embedded, 6, 6, 9),
      (embedded, ordinary, 6, 9, 6),
      (ordinary, leading, 0, 0, 3),
    ] {
      tree.edit(&InputEdit {
        start_byte: start,
        old_end_byte: old_end,
        new_end_byte: new_end,
        start_position: position(source, start),
        old_end_position: position(source, old_end),
        new_end_position: position(edited, new_end),
      });
      let incremental = parser.parse(edited, Some(&tree)).unwrap();
      let fresh = parser.parse(edited, None).unwrap();
      assert!(!fresh.root_node().has_error());
      assert_eq!(
        structure(incremental.root_node(), edited),
        structure(fresh.root_node(), edited)
      );
      tree = incremental;
    }
  }
}

#[test]
fn removing_source_before_an_existing_bom_preserves_the_new_start() {
  for language in languages() {
    let source = "print before\n\u{feff}print after\n".as_bytes();
    let edited = "\u{feff}print after\n".as_bytes();
    let mut parser = parser(language);
    let mut tree = parser.parse(source, None).unwrap();
    tree.edit(&InputEdit {
      start_byte: 0,
      old_end_byte: 13,
      new_end_byte: 0,
      start_position: Point::new(0, 0),
      old_end_position: Point::new(1, 0),
      new_end_position: Point::new(0, 0),
    });
    let incremental = parser.parse(edited, Some(&tree)).unwrap();
    let fresh = parser.parse(edited, None).unwrap();
    assert!(!fresh.root_node().has_error());
    assert_eq!(
      structure(incremental.root_node(), edited),
      structure(fresh.root_node(), edited)
    );
  }
}

#[test]
fn repairing_a_substitution_before_a_heredoc_terminator_reuses_an_invalid_tree()
{
  for language in languages() {
    let source = b"cat <<OUT\n$(print old\nOUT\nprint after\n";
    let edited = b"cat <<OUT\n$(print old)\nOUT\nprint after\n";
    let mut parser = parser(language);
    let mut tree = parser.parse(source, None).unwrap();
    assert!(tree.root_node().has_error());
    tree.edit(&InputEdit {
      start_byte: 21,
      old_end_byte: 21,
      new_end_byte: 22,
      start_position: position(source, 21),
      old_end_position: position(source, 21),
      new_end_position: position(edited, 22),
    });
    let incremental = parser.parse(edited, Some(&tree)).unwrap();
    let fresh = parser.parse(edited, None).unwrap();
    assert!(!fresh.root_node().has_error());
    assert_eq!(
      structure(incremental.root_node(), edited),
      structure(fresh.root_node(), edited)
    );
  }
}

#[test]
fn parsers_do_not_share_pending_heredoc_or_quote_state() {
  for language in languages() {
    let incomplete = b"cat <<OUT\n$(cat <<IN\nbody\n";
    let source = b"print '${literal}'\ncat <<E\n$expanded\nE\n";
    let mut first = parser(language);
    let mut second = parser(language);
    first.parse(incomplete, None).unwrap();
    let expected =
      structure(second.parse(source, None).unwrap().root_node(), source);
    assert_eq!(
      structure(first.parse(source, None).unwrap().root_node(), source),
      expected
    );
    first.reset();
    assert_eq!(
      structure(first.parse(source, None).unwrap().root_node(), source),
      expected
    );
  }
}

#[test]
fn repeated_fresh_recovery_is_deterministic_without_fixing_its_shape() {
  for language in languages() {
    for source in [
      b"if true; then\n".as_slice(),
      b"print ${x:gs/a/\n".as_slice(),
      b"cat <<E\n$(print unfinished\nE\nprint after\n".as_slice(),
      b"if ((1)) { :; }".as_slice(),
    ] {
      let mut parser = parser(language);
      let first = parser.parse(source, None).unwrap();
      let second = parser.parse(source, None).unwrap();
      assert_eq!(
        structure(first.root_node(), source),
        structure(second.root_node(), source)
      );
    }
  }
}

#[test]
fn editing_a_heredoc_body_preserves_the_full_public_structure() {
  for language in languages() {
    let source = b"cat <<OUT\n$(print old)\nOUT\nprint after\n";
    let edited = b"cat <<OUT\n$(print newvalue)\nOUT\nprint after\n";
    let mut parser = parser(language);
    let mut tree = parser.parse(source, None).unwrap();
    assert!(!tree.root_node().has_error());
    tree.edit(&InputEdit {
      start_byte: 18,
      old_end_byte: 21,
      new_end_byte: 26,
      start_position: position(source, 18),
      old_end_position: position(source, 21),
      new_end_position: position(edited, 26),
    });
    let incremental = parser.parse(edited, Some(&tree)).unwrap();
    let fresh = parser.parse(edited, None).unwrap();
    assert!(!fresh.root_node().has_error());
    assert_eq!(
      structure(incremental.root_node(), edited),
      structure(fresh.root_node(), edited)
    );
  }
}
