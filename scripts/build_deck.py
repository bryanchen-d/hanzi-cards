#!/usr/bin/env python3
"""Build public/js/lib/deck-data.js: the 3000-character practice deck.

Sources
- Character set, readings and English glosses: the Unicode Han Database (Unihan),
  Unicode License v3. Uses kTGH (position in the 2013 Table of General Standard
  Chinese Characters, 通用规范汉字表; level 1 = positions 1-3500), kTGHZ2013
  (standard readings from 通用规范汉字字典), kMandarin (most customary reading)
  and kDefinition (English gloss).
- Frequency order: wordfreq (Robyn Speer et al.), whose data is CC BY-SA 4.0 and
  includes SUBTLEX-CH (Cai & Brysbaert, 2010). Character frequency is the sum of
  the frequencies of the Chinese words that contain the character.
- scripts/data/starter.tsv: the curated beginner deck, which keeps its order and
  its hand-written pinyin and meanings and is placed first.

The deck is the starter deck followed by the most frequent remaining level-1
characters, up to --size characters (default 3000).

Usage:
    python3 -m venv .venv && .venv/bin/pip install wordfreq
    .venv/bin/python scripts/build_deck.py            # downloads Unihan.zip if needed
    .venv/bin/python scripts/build_deck.py --unihan path/to/Unihan.zip
"""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UNIHAN_URL = "https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip"
UNICODE_LICENSE_URL = "https://www.unicode.org/license.txt"
LEVEL1_MAX = 3500
MEANING_MAX = 44


def load_unihan(path: Path) -> dict[str, dict[str, str]]:
    wanted = {"kTGH", "kTGHZ2013", "kMandarin", "kDefinition"}
    fields: dict[str, dict[str, str]] = defaultdict(dict)
    with zipfile.ZipFile(path) as zf:
        for name in zf.namelist():
            for raw in zf.read(name).decode("utf-8").splitlines():
                if raw.startswith("#"):
                    continue
                parts = raw.split("\t")
                if len(parts) == 3 and parts[1] in wanted:
                    fields[chr(int(parts[0][2:], 16))][parts[1]] = parts[2]
    return fields


def readings_of(entry: dict[str, str]) -> list[str]:
    readings: list[str] = []
    for token in entry.get("kTGHZ2013", "").split():
        reading = unicodedata.normalize("NFC", token.split(":", 1)[1])
        if reading not in readings:
            readings.append(reading)
    return readings


NOISE_SENSE = re.compile(r"radical\b|\(Cant\.\)|^(a )?surname$", re.IGNORECASE)


def compact_meaning(definition: str) -> str:
    text = re.sub(r"\s+", " ", definition.replace("|", "/")).strip()
    senses = [s.strip() for s in text.split(";") if s.strip()]
    senses = [s for s in senses if not NOISE_SENSE.search(s)] or senses
    out = ""
    for sense in senses:
        candidate = f"{out}; {sense}" if out else sense
        if out and len(candidate) > MEANING_MAX:
            break
        out = candidate
    return out


def character_frequencies() -> dict[str, float]:
    from wordfreq import get_frequency_dict

    freq: dict[str, float] = defaultdict(float)
    for word, f in get_frequency_dict("zh", "best").items():
        for ch in word:
            freq[ch] += f
    return freq


def read_starter() -> list[tuple[str, str, str]]:
    rows = []
    for line in (ROOT / "scripts/data/starter.tsv").read_text("utf-8").splitlines():
        if line and not line.startswith("#"):
            hanzi, pinyin, meaning = line.split("\t")
            rows.append((hanzi, pinyin, meaning))
    return rows


def unicode_license() -> str:
    with urllib.request.urlopen(UNICODE_LICENSE_URL) as res:
        return res.read().decode("utf-8").strip()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--unihan", type=Path, default=ROOT / ".cache/Unihan.zip")
    parser.add_argument("--size", type=int, default=3000)
    parser.add_argument("--out", type=Path, default=ROOT / "public/js/lib/deck-data.js")
    args = parser.parse_args()

    if not args.unihan.exists():
        args.unihan.parent.mkdir(parents=True, exist_ok=True)
        print(f"Downloading {UNIHAN_URL} ...")
        urllib.request.urlretrieve(UNIHAN_URL, args.unihan)

    unihan = load_unihan(args.unihan)
    level1 = {ch: int(e["kTGH"].split(":")[1]) for ch, e in unihan.items() if "kTGH" in e}
    level1 = {ch: pos for ch, pos in level1.items() if pos <= LEVEL1_MAX}
    assert len(level1) == LEVEL1_MAX, f"expected {LEVEL1_MAX} level-1 characters, found {len(level1)}"
    freq = character_frequencies()

    rows: list[tuple[str, str, list[str], str]] = []
    starter = read_starter()
    for hanzi, pinyin, meaning in starter:
        others = [r for r in readings_of(unihan.get(hanzi, {})) if r != pinyin]
        rows.append((hanzi, pinyin, others, meaning))
    chosen = {r[0] for r in rows}

    ranked = sorted((ch for ch in level1 if ch not in chosen), key=lambda ch: (-freq.get(ch, 0.0), level1[ch]))
    for hanzi in ranked[: args.size - len(rows)]:
        entry = unihan[hanzi]
        readings = readings_of(entry)
        customary = unicodedata.normalize("NFC", entry.get("kMandarin", "").split(" ")[0])
        primary = customary if customary in readings else (readings[0] if readings else customary)
        others = [r for r in readings if r != primary]
        meaning = compact_meaning(entry.get("kDefinition", ""))
        rows.append((hanzi, primary, others, meaning))

    assert len(rows) == args.size and len({r[0] for r in rows}) == args.size
    missing = [r[0] for r in rows if not r[1] or not r[3]]
    assert not missing, f"characters without pinyin or meaning: {''.join(missing)}"

    body = "\n".join(f"{h}|{p}|{' '.join(o)}|{m}" for h, p, o, m in rows)
    license_text = "\n".join(f" * {line}".rstrip() for line in unicode_license().splitlines())
    header = f"""/*
 * GENERATED by scripts/build_deck.py. Do not edit; edit scripts/data/starter.tsv or the script and rebuild.
 *
 * Hanzi Cards practice deck: {len(rows)} characters, one per line as
 *   hanzi|primary pinyin|other standard readings (space-separated)|English meaning
 * The first {len(starter)} rows are the curated beginner deck; the rest are level-1 characters
 * of the Table of General Standard Chinese Characters (通用规范汉字表, 2013) in order of frequency.
 *
 * This data file is licensed under CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/).
 * Character frequency order derived from wordfreq (Robyn Speer, https://github.com/rspeer/wordfreq),
 * CC BY-SA 4.0, which includes SUBTLEX-CH (Cai, Q., & Brysbaert, M. (2010). SUBTLEX-CH: Chinese word
 * and character frequencies based on film subtitles. PLoS One, 5(6), e10729; freely available data),
 * Google Books Ngrams, OpenSubtitles 2018 and Wikipedia.
 * Readings and English glosses from the Unicode Han Database (Unihan), used under the license below.
 *
{license_text}
 */
"""
    args.out.write_text(f"{header}export const DECK_DATA = {json.dumps(body, ensure_ascii=False)};\n", "utf-8")
    print(f"Wrote {args.out.relative_to(ROOT)}: {len(rows)} characters, {args.out.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
