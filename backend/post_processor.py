#!/usr/bin/env python3
"""Post-processor for LLM-generated markdown plans.

Responsibilities:
1. Generate a Table of Contents (TOC) from heading structure.
2. Inject local static asset blocks (formulas, diagrams, tables) at
   placeholder markers left by the LLM.
3. Save the processed result alongside the raw LLM output.

Placeholder syntax in LLM output:
    {{INSERT:BLOCK_KEY}}

Where BLOCK_KEY matches a key in assets/static_blocks/index.json.

TOC is inserted right after the level-1 heading (first `# ...` line).
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple


# --------------------------------------------------------------------------- #
#  TOC generation
# --------------------------------------------------------------------------- #

def _heading_to_anchor(text: str) -> str:
    """Convert heading text to GitHub-style anchor."""
    anchor = text.lower()
    # Keep CJK characters, letters, digits, spaces and hyphens; strip the rest.
    anchor = re.sub(r"[^\w\s\-]", "", anchor, flags=re.UNICODE)
    anchor = re.sub(r"\s+", "-", anchor.strip())
    return anchor


def generate_toc(markdown: str) -> str:
    """Return a Markdown TOC string for all ## and deeper headings.

    Returns an empty string if fewer than 2 headings are found.
    """
    lines = markdown.splitlines()
    toc_lines: List[str] = []
    for line in lines:
        m = re.match(r"^(#{2,6})\s+(.+?)\s*$", line)
        if not m:
            continue
        level = len(m.group(1))  # 2 → top level in TOC
        title = m.group(2)
        anchor = _heading_to_anchor(title)
        indent = "  " * (level - 2)
        toc_lines.append(f"{indent}- [{title}](#{anchor})")

    if len(toc_lines) < 2:
        return ""
    return "\n".join(toc_lines)


def insert_toc(markdown: str) -> str:
    """Insert a TOC section right after the first level-1 heading.

    If no level-1 heading exists, insert at the very beginning.
    Returns the modified markdown.
    """
    toc_body = generate_toc(markdown)
    if not toc_body:
        return markdown

    toc_section = f"\n## 目录\n\n{toc_body}\n\n---\n"

    lines = markdown.splitlines(keepends=True)
    insert_pos = 0
    for i, line in enumerate(lines):
        if re.match(r"^#\s+", line):
            insert_pos = i + 1
            # Skip any immediately following blank line(s)
            while insert_pos < len(lines) and lines[insert_pos].strip() == "":
                insert_pos += 1
            break

    lines.insert(insert_pos, toc_section)
    return "".join(lines)


# --------------------------------------------------------------------------- #
#  Static block injection
# --------------------------------------------------------------------------- #

def load_static_blocks(assets_root: Path) -> Dict[str, str]:
    """Load all static blocks defined in assets/static_blocks/index.json.

    Returns a dict mapping BLOCK_KEY → markdown content string.
    """
    index_path = assets_root / "static_blocks" / "index.json"
    if not index_path.exists():
        return {}

    index = json.loads(index_path.read_text(encoding="utf-8"))
    blocks: Dict[str, str] = {}
    blocks_dir = assets_root / "static_blocks"
    for key, meta in index.get("blocks", {}).items():
        file_path = blocks_dir / meta["file"]
        if file_path.exists():
            blocks[key] = file_path.read_text(encoding="utf-8").strip()
    return blocks


def inject_static_blocks(markdown: str, blocks: Dict[str, str]) -> Tuple[str, List[str]]:
    """Replace all {{INSERT:BLOCK_KEY}} placeholders with loaded block content.

    Returns (processed_markdown, list_of_injected_keys).
    """
    injected: List[str] = []
    pattern = re.compile(r"\{\{INSERT:([A-Z0-9_]+)\}\}")

    def replacer(m: re.Match) -> str:
        key = m.group(1)
        if key in blocks:
            injected.append(key)
            return blocks[key]
        # Leave unknown placeholders intact with a comment.
        return f"<!-- WARNING: static block '{key}' not found -->"

    result = pattern.sub(replacer, markdown)
    return result, injected


# --------------------------------------------------------------------------- #
#  Prose depth check helper (used by evaluator integration)
# --------------------------------------------------------------------------- #

def check_prose_under_headings(markdown: str, min_chars: int = 80) -> List[str]:
    """Check that every heading at level 3+ has a prose paragraph below it.

    A 'prose paragraph' is a non-empty, non-table, non-code-block line
    (or consecutive lines) containing at least ``min_chars`` Chinese/text chars.

    Returns a list of issue strings (empty = all OK).
    """
    issues: List[str] = []
    lines = markdown.splitlines()
    n = len(lines)

    # Collect positions of all level-3+ headings.
    heading_positions: List[Tuple[int, str]] = []
    in_code_block = False
    for i, line in enumerate(lines):
        if line.strip().startswith("```"):
            in_code_block = not in_code_block
        if in_code_block:
            continue
        m = re.match(r"^(#{3,})\s+(.+?)\s*$", line)
        if m:
            heading_positions.append((i, m.group(2)))

    for idx, (pos, title) in enumerate(heading_positions):
        # Gather lines between this heading and the next heading (or EOF).
        next_pos = heading_positions[idx + 1][0] if idx + 1 < len(heading_positions) else n
        section_lines = lines[pos + 1: next_pos]

        # Extract prose: skip blank lines, table rows, code blocks, headings.
        prose_chars = 0
        inner_code = False
        for line in section_lines:
            stripped = line.strip()
            if stripped.startswith("```"):
                inner_code = not inner_code
                continue
            if inner_code:
                continue
            if not stripped:
                continue
            if stripped.startswith("|") or stripped.startswith("#"):
                continue
            # Count non-whitespace characters.
            prose_chars += len(re.sub(r"\s+", "", stripped))

        if prose_chars < min_chars:
            issues.append(
                f"章节 '{title}' 叙述文字不足（当前约 {prose_chars} 字，要求 >= {min_chars} 字）。"
            )

    return issues


# --------------------------------------------------------------------------- #
#  Main post-processing entry point
# --------------------------------------------------------------------------- #

def post_process(
    markdown: str,
    assets_root: Optional[Path] = None,
    add_toc: bool = True,
) -> Tuple[str, Dict[str, object]]:
    """Apply all post-processing steps to a generated markdown plan.

    Steps (in order):
    1. Inject static asset blocks.
    2. Insert TOC.

    Returns:
        (processed_markdown, report_dict)
    where report_dict contains:
        - injected_blocks: list of block keys that were injected
        - toc_added: bool
    """
    report: Dict[str, object] = {
        "injected_blocks": [],
        "toc_added": False,
    }

    # Step 1: static block injection
    if assets_root is not None:
        blocks = load_static_blocks(assets_root)
        markdown, injected = inject_static_blocks(markdown, blocks)
        report["injected_blocks"] = injected

    # Step 2: TOC insertion
    if add_toc:
        new_md = insert_toc(markdown)
        if new_md != markdown:
            report["toc_added"] = True
        markdown = new_md

    return markdown, report


# --------------------------------------------------------------------------- #
#  CLI for standalone use
# --------------------------------------------------------------------------- #

if __name__ == "__main__":
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="方案后处理器：注入静态资源 + 生成目录")
    parser.add_argument("input", help="输入 Markdown 文件路径")
    parser.add_argument("--output", default="", help="输出文件路径（默认覆盖输入文件）")
    parser.add_argument(
        "--assets-root",
        default="assets",
        help="静态资源根目录（默认: assets/）",
    )
    parser.add_argument("--no-toc", action="store_true", help="不生成目录")
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"错误: 文件不存在: {input_path}", file=sys.stderr)
        sys.exit(1)

    raw_md = input_path.read_text(encoding="utf-8")
    assets_dir = Path(args.assets_root).resolve()

    processed, report = post_process(
        markdown=raw_md,
        assets_root=assets_dir if assets_dir.exists() else None,
        add_toc=not args.no_toc,
    )

    out_path = Path(args.output) if args.output else input_path
    out_path.write_text(processed, encoding="utf-8")

    print(f"后处理完成 → {out_path}")
    print(f"  注入静态块: {report['injected_blocks']}")
    print(f"  生成目录: {report['toc_added']}")
