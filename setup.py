import sys
from pathlib import Path

from setuptools import Extension, setup

Path("dist/metadata").mkdir(parents=True, exist_ok=True)

setup(
    options={
        "build": {"build_base": "dist/build"},
        "egg_info": {"egg_base": "dist/metadata"},
    },
    ext_modules=[
        Extension(
            "tree_sitter_zsh.binding",
            sources=[
                "bindings/python/binding.c",
                "src/parser.c",
                "src/scanner.c",
                "zsh_extended_glob/src/parser.c",
                "zsh_extended_glob/src/scanner.c",
            ],
            include_dirs=["src", "zsh_extended_glob/src"],
            depends=[
                "common/input.h",
                "common/scanner.h",
                "common/source.h",
                "src/tokens.h",
                "src/tree_sitter/alloc.h",
                "src/tree_sitter/array.h",
                "src/tree_sitter/parser.h",
                "zsh_extended_glob/src/tokens.h",
                "zsh_extended_glob/src/tree_sitter/alloc.h",
                "zsh_extended_glob/src/tree_sitter/array.h",
                "zsh_extended_glob/src/tree_sitter/parser.h",
            ],
            extra_compile_args=["/std:c17", "/utf-8"]
            if sys.platform == "win32"
            else ["-std=c17"],
        )
    ],
)
