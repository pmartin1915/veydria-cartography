#!/usr/bin/env python3
"""
generator/export/calendar_ts.py — Generate TypeScript calendar events from YAML

Reads data/calendar-events.yaml and writes web/src/generated/calendar-events.ts.
This lets calendar data live in a structured YAML file (syncable from worldbuilder)
while the web app consumes generated TypeScript.

Usage:
    python generator/export/calendar_ts.py
"""
import json
import re
from pathlib import Path

import yaml


REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_PATH = REPO_ROOT / "data" / "calendar-events.yaml"
OUTPUT_PATH = REPO_ROOT / "web" / "src" / "generated" / "calendar-events.ts"

# Minimal inline type so the generated file is self-contained
TS_HEADER = '''// Auto-generated from data/calendar-events.yaml
// Do NOT edit manually. Run `npm run generate:calendar` to regenerate.

interface CalendarEvent {
  id: string
  name: string
  civilization: string | 'all'
  type: 'festival' | 'harvest' | 'monsoon' | 'religious' | 'political' | 'trade' | 'misc'
  startDay: number
  durationDays: number
  description: string
  effect?: string
  season: 'winter' | 'spring' | 'summer' | 'autumn' | 'all'
}

export const VEYDRIA_CALENDAR_EVENTS: CalendarEvent[] = [
'''

TS_FOOTER = ''']
'''


def escape_ts_string(s: str) -> str:
    """Escape a string for TypeScript single-quoted literal."""
    return s.replace("\\", "\\\\").replace("'", "\\'")


def event_to_ts(ev: dict) -> str:
    lines = ["  {"]
    lines.append(f"    id: '{escape_ts_string(ev['id'])}',")
    lines.append(f"    name: '{escape_ts_string(ev['name'])}',")
    lines.append(f"    civilization: '{escape_ts_string(ev['civilization'])}',")
    lines.append(f"    type: '{ev['type']}',")
    lines.append(f"    startDay: {ev['startDay']},")
    lines.append(f"    durationDays: {ev['durationDays']},")
    lines.append(f"    description: '{escape_ts_string(ev['description'])}',")
    if "effect" in ev and ev["effect"]:
        lines.append(f"    effect: '{escape_ts_string(ev['effect'])}',")
    lines.append(f"    season: '{ev['season']}',")
    lines.append("  },")
    return "\n".join(lines)


def generate() -> None:
    if not DATA_PATH.exists():
        raise FileNotFoundError(f"Calendar data not found: {DATA_PATH}")

    with open(DATA_PATH, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)

    events = data.get("events", [])
    if not events:
        raise ValueError("No events found in calendar-events.yaml")

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    parts = [TS_HEADER]
    for ev in events:
        parts.append(event_to_ts(ev))
        parts.append("")
    parts.append(TS_FOOTER)

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(parts))

    print(f"Generated {len(events)} calendar events -> {OUTPUT_PATH.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    generate()
