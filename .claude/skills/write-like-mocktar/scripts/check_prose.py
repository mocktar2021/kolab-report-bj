#!/usr/bin/env python3
"""Flag em dashes, AI-sounding vocabulary and AI sentence patterns in text.

Usage:
  check_prose.py FILE [FILE ...]
  some-command | check_prose.py -

Exit code 1 when any error is found, 0 otherwise (warnings never fail).

In Markdown and plain text, fenced code blocks and inline `code` spans are
skipped. Wrap a region in "check-prose: off" / "check-prose: on" comments to
skip it on purpose (for example a table that lists the banned words).
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

EM_DASH = "\u2014"
HORIZONTAL_BAR = "\u2015"
EN_DASH = "\u2013"

# (pattern, suggestion). Matched case-insensitively on word boundaries.
ERROR_PHRASES: list[tuple[str, str]] = [
    (r"delv(e|es|ed|ing)", "look at, go through"),
    (r"leverag(e|es|ed|ing)", "use"),
    (r"utiliz(e|es|ed|ing|ation)", "use"),
    (r"seamless(ly)?", "drop it, or say what is smooth"),
    (r"tapestry", "drop the metaphor"),
    (r"cutting[- ]edge", "drop it, state the fact"),
    (r"state[- ]of[- ]the[- ]art", "drop it, state the fact"),
    (r"world[- ]class", "drop it, state the fact"),
    (r"best[- ]in[- ]class", "drop it, state the fact"),
    (r"game[- ]chang(er|ing)", "drop it"),
    (r"revolutioni[sz](e|es|ed|ing)", "change, replace"),
    (r"supercharg(e|es|ed|ing)", "speed up, improve"),
    (r"empower(s|ed|ing)?", "let, help"),
    (r"embark(s|ed|ing)?", "start"),
    (r"plethora", "many"),
    (r"myriad", "many, or the number"),
    (r"ever[- ]evolving", "changing"),
    (r"testament to", "shows"),
    (r"holistic(ally)?", "full, whole, or drop it"),
    (r"synerg(y|ies|istic)", "drop it"),
    (r"paramount", "important"),
    (r"meticulous(ly)?", "careful"),
    (r"effortless(ly)?", "drop it, show the steps"),
    (r"in today'?s (fast[- ]paced|digital|modern)", "drop the opener"),
    (r"it'?s worth noting", "drop it, say the thing"),
    (r"it is worth noting", "drop it, say the thing"),
    (r"it'?s important to note", "drop it, say the thing"),
    (r"it is important to note", "drop it, say the thing"),
    (r"in conclusion", "drop the closer"),
    (r"i hope this helps", "drop the closer"),
    (r"great question", "drop the opener"),
    (r"feel free to", "drop it, or say: you can"),
    (r"let'?s dive", "drop it"),
    (r"dive into", "look at"),
    (r"deep[- ]dive", "close look, review"),
    (r"take (it|your \w+) to the next level", "say the concrete gain"),
    (r"say goodbye to", "say what changes"),
    (r"(it'?s|this is|this isn'?t|it isn'?t) not just", "say what it is"),
    (r"not only .{1,60} but also", "say both plainly"),
    (r"co-authored-by: claude", "remove the Claude trailer"),
    (r"claude-session:", "remove the Claude trailer"),
    (r"generated with \[?claude", "remove the AI footer"),
    # French
    (r"n'?h[ée]sitez pas", "drop it, or: vous pouvez"),
    (r"plongeons", "drop it"),
    (r"il est important de noter", "drop it, dites la chose"),
    (r"en somme", "drop the closer"),
    (r"incontournable", "drop it, state the fact"),
    (r"r[ée]volutionn\w*", "changer, remplacer"),
    (r"booster", "améliorer, accélérer"),
    (r"fluide et intuiti(f|ve)", "say what the user does"),
    (r"de mani[èe]re optimale", "drop it, state the result"),
    (r"en toute simplicit[ée]", "drop it"),
]

WARNING_PHRASES: list[tuple[str, str]] = [
    (r"robust(ly|ness)?", "solid, reliable, or say what it survives"),
    (r"comprehensive(ly)?", "full, complete, or list what is covered"),
    (r"streamlin(e|es|ed|ing)", "simplify, cut steps"),
    (r"facilitat(e|es|ed|ing)", "let, help"),
    (r"enhanc(e|es|ed|ing|ement)", "improve, or name the change"),
    (r"elevat(e|es|ed|ing)", "improve (fine for 'elevated privileges')"),
    (r"unlock(s|ed|ing)?", "fine for accounts and locks, otherwise drop"),
    (r"crucial(ly)?", "important, or show why"),
    (r"vital", "important, or show why"),
    (r"pivotal", "important, or show why"),
    (r"foster(s|ed|ing)?", "build, encourage"),
    (r"bolster(s|ed|ing)?", "support, add"),
    (r"harness(es|ed|ing)? (the|its|their|our|your|this)", "use ('test harness' is fine)"),
    (r"showcas(e|es|ed|ing)", "show"),
    (r"boast(s|ed|ing)?", "has"),
    (r"landscape", "drop the metaphor (fine for page orientation)"),
    (r"realm", "area, or drop it"),
    (r"journey", "drop the metaphor"),
    (r"nuanced", "detailed, or drop it"),
    (r"intricate", "detailed, complex"),
    (r"ensur(e|es|ed|ing)", "make sure, or state the check"),
    (r"navigat(e|es|ing) (the|this|these|complex)", "handle, deal with"),
    (r"here'?s the (thing|kicker|catch)", "drop the hook"),
    (r"the (result|answer|catch|kicker|best part)\?", "state it directly"),
    (r"why does (this|it) matter\?", "state why directly"),
]

SENTENCE_START_WARNINGS = ["Furthermore", "Moreover", "Additionally", "Overall", "Ultimately", "Notably", "Importantly"]

EMOJI_BULLET = re.compile(r"^\s*[-*]\s*[\U0001F300-\U0001FAFF\u2600-\u27BF]")
SPACED_DASH_SUBSTITUTE = re.compile(r"(?<=\w) (-|--) (?=\w)")
SPACED_EN_DASH = re.compile(rf"\s{EN_DASH}\s")
INLINE_CODE = re.compile(r"`[^`\n]*`")
FENCE = re.compile(r"^\s*(```|~~~)")
OFF = re.compile(r"check-prose:\s*off", re.I)
ON = re.compile(r"check-prose:\s*on", re.I)
MARKDOWN_LIKE = {".md", ".mdx", ".txt", ".csv", ""}


def compile_phrases(items: list[tuple[str, str]]) -> list[tuple[re.Pattern[str], str]]:
    return [(re.compile(rf"(?<![\w-]){p}(?![\w-])", re.I), s) for p, s in items]


ERRORS = compile_phrases(ERROR_PHRASES)
WARNINGS = compile_phrases(WARNING_PHRASES)
STARTS = re.compile(rf"(^|[.!?]\s+)({'|'.join(SENTENCE_START_WARNINGS)}),", re.M)


@dataclass
class Finding:
    source: str
    line: int
    col: int
    level: str
    rule: str
    text: str
    hint: str

    def __str__(self) -> str:
        return f"{self.source}:{self.line}:{self.col}: {self.level}: {self.rule}: \"{self.text}\" -> {self.hint}"


def mask_inline_code(line: str) -> str:
    return INLINE_CODE.sub(lambda m: " " * len(m.group(0)), line)


def check_text(source: str, text: str, markdown_like: bool) -> list[Finding]:
    findings: list[Finding] = []
    in_fence = False
    skipping = False

    for lineno, raw in enumerate(text.splitlines(), start=1):
        if OFF.search(raw):
            skipping = True
            continue
        if ON.search(raw):
            skipping = False
            continue
        if markdown_like and FENCE.match(raw):
            in_fence = not in_fence
            continue

        # Em dashes are checked everywhere, code included: they should never appear.
        for ch, name in ((EM_DASH, "em-dash"), (HORIZONTAL_BAR, "horizontal-bar")):
            start = 0
            while (idx := raw.find(ch, start)) != -1:
                findings.append(Finding(source, lineno, idx + 1, "error", name, ch, "rewrite with a period, comma, colon or parentheses"))
                start = idx + 1

        if skipping or (markdown_like and in_fence):
            continue

        line = mask_inline_code(raw) if markdown_like else raw

        for m in SPACED_EN_DASH.finditer(line):
            findings.append(Finding(source, lineno, m.start() + 2, "error", "en-dash-as-dash", EN_DASH, "rewrite the sentence; use a hyphen only for ranges"))
        for m in SPACED_DASH_SUBSTITUTE.finditer(line):
            findings.append(Finding(source, lineno, m.start() + 2, "warning", "dash-substitute", m.group(0).strip(), "rewrite instead of using a dash"))
        for pattern, hint in ERRORS:
            for m in pattern.finditer(line):
                findings.append(Finding(source, lineno, m.start() + 1, "error", "ai-phrase", m.group(0), hint))
        for pattern, hint in WARNINGS:
            for m in pattern.finditer(line):
                findings.append(Finding(source, lineno, m.start() + 1, "warning", "ai-word", m.group(0), hint))
        for m in STARTS.finditer(line):
            findings.append(Finding(source, lineno, m.start(2) + 1, "warning", "transition-opener", m.group(2), "drop it, the sentence works without"))
        if EMOJI_BULLET.match(line):
            findings.append(Finding(source, lineno, 1, "warning", "emoji-bullet", line.strip()[:20], "use a plain bullet"))

    return findings


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("paths", nargs="+", help="files to check, or - for stdin")
    parser.add_argument("--errors-only", action="store_true", help="hide warnings")
    args = parser.parse_args(argv)

    findings: list[Finding] = []
    for p in args.paths:
        if p == "-":
            findings += check_text("<stdin>", sys.stdin.read(), markdown_like=True)
            continue
        path = Path(p)
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            print(f"{p}: skipped ({exc.__class__.__name__})", file=sys.stderr)
            continue
        findings += check_text(p, text, markdown_like=path.suffix.lower() in MARKDOWN_LIKE)

    shown = [f for f in findings if not (args.errors_only and f.level == "warning")]
    for f in shown:
        print(f)

    errors = sum(f.level == "error" for f in findings)
    warnings = sum(f.level == "warning" for f in findings)
    print(f"{errors} error(s), {warnings} warning(s)", file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
