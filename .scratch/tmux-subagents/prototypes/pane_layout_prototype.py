#!/usr/bin/env python3
"""THROWAWAY PROTOTYPE: render binary or ternary pane-layout geometry."""

import argparse
from dataclasses import dataclass, replace

CELL_HEIGHT_TO_WIDTH = 2
CANVASES = {
    "landscape": (64, 18),
    "portrait": (36, 32),
}


@dataclass(frozen=True)
class Mode:
    arity: int
    remainder_index: int


MODES = {
    # Preserve remainder placement from the four locked prototypes.
    "binary": Mode(arity=2, remainder_index=-1),
    "ternary": Mode(arity=3, remainder_index=0),
}


@dataclass(frozen=True)
class Rect:
    x: int
    y: int
    width: int
    height: int
    label: str = ""


def shape_for(width: int, height: int) -> str:
    return "landscape" if width >= height * CELL_HEIGHT_TO_WIDTH else "portrait"


def split_axis(rect: Rect) -> str:
    if rect.width >= rect.height * CELL_HEIGHT_TO_WIDTH:
        return "side-by-side"
    return "stacked"


def partition(rect: Rect, mode: Mode, additions: int) -> list[Rect]:
    """Add panes while preserving eventual equal arity-sized regions.

    First region retains all unconsumed shares. Each added region consumes one
    share at right/bottom. For ternary this yields 2:1, then 1:1:1.
    """
    if not 0 <= additions < mode.arity:
        raise ValueError(f"additions must be between 0 and {mode.arity - 1}")
    if additions == 0:
        return [rect]

    axis = split_axis(rect)
    size = rect.width if axis == "side-by-side" else rect.height
    share, remainder = divmod(size, mode.arity)
    spans = [share * (mode.arity - additions), *([share] * additions)]
    spans[mode.remainder_index] += remainder
    children: list[Rect] = []
    offset = 0

    for span in spans:
        if axis == "side-by-side":
            children.append(Rect(rect.x + offset, rect.y, span, rect.height))
        else:
            children.append(Rect(rect.x, rect.y + offset, rect.width, span))
        offset += span

    return children


def slot_order(rects: list[Rect], shape: str) -> list[Rect]:
    if shape == "landscape":
        return sorted(rects, key=lambda rect: (rect.y, rect.x))
    return sorted(rects, key=lambda rect: (rect.x, rect.y))


def render_order(rects: list[Rect]) -> list[Rect]:
    return sorted(rects, key=lambda rect: (rect.y, rect.x))


def target_order(rects: list[Rect], shape: str) -> list[Rect]:
    if shape == "landscape":
        return sorted(rects, key=lambda rect: (-rect.x, -rect.y))
    return sorted(rects, key=lambda rect: (-rect.y, -rect.x))


def largest_power(value: int, base: int) -> int:
    power = 1
    while power * base <= value:
        power *= base
    return power


def complete_level(size: int, width: int, height: int, mode: Mode, shape: str) -> list[Rect]:
    rects = [Rect(0, 0, width, height)]

    while len(rects) < size:
        rects = slot_order(
            [child for rect in rects for child in partition(rect, mode, mode.arity - 1)],
            shape,
        )

    return [replace(rect, label=str(slot)) for slot, rect in enumerate(rects, start=1)]


def layout(
    pane_count: int,
    width: int,
    height: int,
    mode: Mode,
) -> tuple[list[Rect], list[str], str]:
    shape = shape_for(width, height)
    level_size = largest_power(pane_count, mode.arity)
    additions_left = pane_count - level_size
    base = complete_level(level_size, width, height, mode, shape)
    targets = target_order(base, shape)
    additions_by_slot: dict[str, int] = {}

    for target in targets:
        additions = min(mode.arity - 1, additions_left)
        additions_by_slot[target.label] = additions
        additions_left -= additions

    leaves = [
        child
        for rect in base
        for child in partition(rect, mode, additions_by_slot[rect.label])
    ]
    leaves = [
        replace(rect, label=str(pane))
        for pane, rect in enumerate(render_order(leaves), start=1)
    ]

    completed_additions = pane_count - level_size
    all_steps = [
        f"{target.label}.{step}"
        for target in targets
        for step in range(1, mode.arity)
    ]
    remaining = all_steps[completed_additions:]
    return leaves, remaining, split_axis(base[0])


def render(rects: list[Rect], width: int, height: int) -> str:
    horizontal = 1
    vertical = 2
    edges = [[0 for _ in range(width + 1)] for _ in range(height + 1)]

    for rect in rects:
        x0, y0 = rect.x, rect.y
        x1, y1 = x0 + rect.width, y0 + rect.height

        for x in range(x0, x1 + 1):
            edges[y0][x] |= horizontal
            edges[y1][x] |= horizontal
        for y in range(y0, y1 + 1):
            edges[y][x0] |= vertical
            edges[y][x1] |= vertical

    chars = {0: " ", horizontal: "─", vertical: "│", horizontal | vertical: "┼"}
    canvas = [[chars[cell] for cell in row] for row in edges]

    for rect in rects:
        y = rect.y + max(1, rect.height // 2)
        x = rect.x + max(1, (rect.width - len(rect.label)) // 2)
        if y < rect.y + rect.height and x + len(rect.label) < rect.x + rect.width:
            canvas[y][x : x + len(rect.label)] = rect.label

    return "\n".join("".join(row).rstrip() for row in canvas)


def main() -> None:
    parser = argparse.ArgumentParser(description="Render binary or ternary pane-layout splits.")
    parser.add_argument("--mode", choices=MODES, default="binary", help="split arity (default: binary)")
    parser.add_argument("--canvas", choices=CANVASES, default="landscape", help="canvas shape (default: landscape)")
    parser.add_argument("--splits", type=int, default=19, help="number of splits to render (default: 19)")
    args = parser.parse_args()
    if args.splits < 0:
        parser.error("--splits must be non-negative")

    mode = MODES[args.mode]
    width, height = CANVASES[args.canvas]
    print(f"PROTOTYPE — {args.canvas} {args.mode} layout")
    print(f"canvas: {width}x{height} terminal cells; cell height ratio: {CELL_HEIGHT_TO_WIDTH}:1")
    print(f"branching factor: {mode.arity}; each target consumes at most {mode.arity - 1} additions")
    if args.canvas == "landscape":
        print("partial levels fill rightmost column bottom-to-top before moving left")
    else:
        print("partial levels fill bottom row right-to-left before moving upward")
    print()

    for split_count in range(args.splits + 1):
        pane_count = split_count + 1
        rects, remaining, next_axis = layout(pane_count, width, height, mode)
        level_size = largest_power(pane_count, mode.arity)
        print(f"=== {split_count} splits / {pane_count} panes ===")
        print(f"partial-level additions applied: {pane_count - level_size}")
        print(f"remaining base-slot steps: {' → '.join(remaining) if remaining else 'level complete'}")
        print(f"next split: {next_axis}")
        print(render(rects, width, height))
        print()


if __name__ == "__main__":
    main()
