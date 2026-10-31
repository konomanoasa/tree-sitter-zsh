from importlib.resources import files

from .binding import language, language_extended_glob

HIGHLIGHTS_QUERY: str = (
    files(__package__).joinpath("queries/highlights.scm").read_text("utf-8")
)

__all__ = ["HIGHLIGHTS_QUERY", "language", "language_extended_glob"]
