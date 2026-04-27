"""
yaml_io.py — Round-trip YAML helpers.

Wraps ruamel.yaml so coordinate-manifest.yaml round-trips through edit-mode
saves with comments, key order, and quote styles intact. Used by
coordinate_loader (load) and persistence (load + dump).

Read-only YAML loaders elsewhere in the project (yaml_loader, schema_validator)
intentionally stay on PyYAML — they never write back, so the extra cost of
round-trip mode would buy nothing.
"""

from pathlib import Path
from typing import Any, Iterable

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedSeq

_yaml = YAML(typ="rt")
_yaml.preserve_quotes = True
_yaml.indent(mapping=2, sequence=4, offset=2)
_yaml.width = 4096


def load_rt(path: Path | str) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        return _yaml.load(f)


def dump_rt(data: Any, path: Path | str) -> None:
    with open(path, "w", encoding="utf-8") as f:
        _yaml.dump(data, f)


def flow_seq(items: Iterable) -> CommentedSeq:
    """Build a flow-style sequence (`[a, b]`) for round-trip dumping.

    The manifest renders every coord pair inline; replacing a slot with a
    plain Python list reverts to block style. Wrap new values in this so
    edit-mode saves match the existing convention.
    """
    cs = CommentedSeq(items)
    cs.fa.set_flow_style()
    return cs
