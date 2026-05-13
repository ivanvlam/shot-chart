#!/usr/bin/env python3
"""
NBA shot data fetcher for shot-chart.

Usage:
  python scripts/fetch_shots.py --roster           # write data/roster.js (~569 players, with stats)
  python scripts/fetch_shots.py --heights          # add height/position via commonteamroster (~30 calls)
  python scripts/fetch_shots.py --top100           # fetch shots for top-100 FGA players (new fields)
  python scripts/fetch_shots.py --all              # fetch shots for all remaining players
  python scripts/fetch_shots.py --upgrade          # re-fetch shot files missing new fields
  python scripts/fetch_shots.py --player 201939    # fetch shots for one player by ID

Requires: pip install nba_api
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path
from typing import Any

try:
    from nba_api.stats.endpoints import (
        commonplayerinfo,
        commonteamroster,
        leaguedashplayerstats,
        leagueleaders,
        shotchartdetail,
    )
    from nba_api.stats.static import teams as static_teams
except ImportError:
    sys.exit("nba_api not installed — run: pip install nba_api")

BASE = Path(__file__).parent.parent
DATA = BASE / "data"
SHOTS_DIR = DATA / "shots"
ROSTER_PATH = DATA / "roster.js"

SEASON = "2025-26"
SEASON_TYPE = "Regular Season"

TEAM_COLORS: dict[str, int] = {
    "ATL": 0xC8102E, "BOS": 0x007A33, "BKN": 0x000000, "CHA": 0x1D1160,
    "CHI": 0xCE1141, "CLE": 0x860038, "DAL": 0x00538C, "DEN": 0x0E2240,
    "DET": 0xC8102E, "GSW": 0x1D428A, "HOU": 0xCE1141, "IND": 0x002D62,
    "LAC": 0xC8102E, "LAL": 0x552583, "MEM": 0x5D76A9, "MIA": 0x98002E,
    "MIL": 0x00471B, "MIN": 0x0C2340, "NOP": 0x0C2340, "NYK": 0x006BB6,
    "OKC": 0x007AC1, "ORL": 0x0077C0, "PHI": 0x006BB6, "PHX": 0x1D1160,
    "POR": 0xE03A3E, "SAC": 0x5A2D81, "SAS": 0xC4CED4, "TOR": 0xCE1141,
    "UTA": 0x002B5C, "WAS": 0x002B5C,
}

DEFAULT_COLOR = 0x445566


def height_to_inches(height_str: str) -> int:
    """Convert 'feet-inches' (e.g. '6-3') to total inches (75). Returns 0 on parse failure."""
    if not height_str or "-" not in height_str:
        return 0
    try:
        ft, inch = height_str.split("-")
        return int(ft) * 12 + int(inch)
    except ValueError:
        return 0


def normalize_position(position: str) -> str:
    """Normalize NBA position labels to G/F/C (or combos like G-F)."""
    raw = (position or "").strip()
    if not raw:
        return ""
    p = raw.upper()
    if p in {"G", "F", "C", "G-F", "F-G", "F-C", "C-F", "G-C", "C-G"}:
        return p

    # Handle full-word labels from commonplayerinfo, e.g. "Guard-Forward".
    tokens = re.split(r"[-/\s]+", p)
    mapped: list[str] = []
    for tok in tokens:
        if not tok:
            continue
        if tok.startswith("GUARD"):
            mapped.append("G")
        elif tok.startswith("FORWARD"):
            mapped.append("F")
        elif tok.startswith("CENTER") or tok.startswith("CENTRE"):
            mapped.append("C")
        elif tok in {"G", "F", "C"}:
            mapped.append(tok)

    if not mapped:
        return raw

    # Keep order from source, de-duplicate repeats.
    uniq: list[str] = []
    for m in mapped:
        if m not in uniq:
            uniq.append(m)
    return "-".join(uniq)


def fetch_roster() -> list[dict[str, Any]]:
    data = leaguedashplayerstats.LeagueDashPlayerStats(
        season=SEASON,
        season_type_all_star=SEASON_TYPE,
        per_mode_detailed="Totals",
        timeout=30,
    ).get_data_frames()[0]
    players: list[dict[str, Any]] = []
    seen: set[int] = set()
    for _, row in data.iterrows():
        pid = int(row["PLAYER_ID"])
        if pid in seen:
            continue
        seen.add(pid)
        abbr = row.get("TEAM_ABBREVIATION", "") or ""
        players.append({
            "id": pid,
            "name": row["PLAYER_NAME"],
            "team": abbr,
            "color": TEAM_COLORS.get(abbr, DEFAULT_COLOR),
            "hasData": False,
            "fga": int(row["FGA"]),
            "fg_pct": round(float(row["FG_PCT"]), 3),
            "pts": int(row["PTS"]),
            "gp": int(row["GP"]),
            "height_in": 0,
            "position": "",
        })
    players.sort(key=lambda p: p["name"].split()[-1].lower())
    return players


def fetch_heights() -> dict[int, dict[str, Any]]:
    """Hit commonteamroster for each active team — returns {player_id: {height_in, position}}."""
    teams = static_teams.get_teams()
    out: dict[int, dict[str, Any]] = {}
    print(f"Fetching heights/positions for {len(teams)} teams...")
    for i, t in enumerate(teams):
        team_id = t["id"]
        abbr = t["abbreviation"]
        try:
            df = commonteamroster.CommonTeamRoster(
                team_id=team_id, season=SEASON, timeout=30
            ).get_data_frames()[0]
            for _, row in df.iterrows():
                pid = int(row["PLAYER_ID"])
                out[pid] = {
                    "height_in": height_to_inches(str(row.get("HEIGHT", ""))),
                    "position": normalize_position(str(row.get("POSITION", "") or "")),
                }
            print(f"  [{i+1}/{len(teams)}] {abbr} — {len(df)} players")
        except Exception as e:
            print(f"  [{i+1}/{len(teams)}] {abbr} — ERROR: {e}")
        time.sleep(0.5)
    return out


def fetch_player_info(player_id: int) -> dict[str, Any] | None:
    """Per-player fallback via commonplayerinfo. Returns {height_in, position} or None."""
    try:
        df = commonplayerinfo.CommonPlayerInfo(
            player_id=player_id, timeout=30
        ).get_data_frames()[0]
    except Exception as e:
        print(f"    commonplayerinfo({player_id}) ERROR: {e}")
        return None
    if df.empty:
        return None
    row = df.iloc[0]
    return {
        "height_in": height_to_inches(str(row.get("HEIGHT", ""))),
        "position": normalize_position(str(row.get("POSITION", "") or "")),
    }


def fetch_missing_heights(
    missing_ids: list[int],
) -> dict[int, dict[str, Any]]:
    """Per-player commonplayerinfo pass for IDs missing height and/or position."""
    out: dict[int, dict[str, Any]] = {}
    total = len(missing_ids)
    if total == 0:
        return out
    print(f"Filling {total} missing heights via commonplayerinfo...")
    for i, pid in enumerate(missing_ids):
        info = fetch_player_info(pid)
        if info and (info["height_in"] > 0 or info["position"]):
            out[pid] = info
            print(f"  [{i + 1}/{total}] {pid} — {info['height_in']}in / {info['position'] or '-'}")
        else:
            print(f"  [{i + 1}/{total}] {pid} — no height/position data")
        time.sleep(0.6)
    return out


def fetch_top100_ids() -> list[int]:
    data = leagueleaders.LeagueLeaders(
        season=SEASON,
        season_type_all_star=SEASON_TYPE,
        per_mode48="Totals",
        stat_category_abbreviation="FGA",
        timeout=30,
    ).get_data_frames()[0]
    return [int(row["PLAYER_ID"]) for _, row in data.head(100).iterrows()]


def fetch_player_shots(player_id: int) -> list[dict[str, Any]]:
    data = shotchartdetail.ShotChartDetail(
        team_id=0,
        player_id=player_id,
        season_nullable=SEASON,
        season_type_all_star=SEASON_TYPE,
        context_measure_simple="FGA",
        timeout=30,
    ).get_data_frames()[0]
    shots: list[dict[str, Any]] = []
    for _, row in data.iterrows():
        shots.append({
            "LOC_X": int(row["LOC_X"]),
            "LOC_Y": int(row["LOC_Y"]),
            "SHOT_MADE_FLAG": int(row["SHOT_MADE_FLAG"]),
            "SHOT_TYPE": row["SHOT_TYPE"],
            "PERIOD": int(row["PERIOD"]),
            "ACTION_TYPE": row["ACTION_TYPE"],
            "SHOT_DISTANCE": int(row["SHOT_DISTANCE"]),
        })
    return shots


def jsstr(s: str) -> str:
    """JSON-encode a string with UTF-8 preserved (so 'č' stays as 'č', not '\\u010d')."""
    return json.dumps(s, ensure_ascii=False)


def write_roster(players: list[dict[str, Any]]) -> None:
    DATA.mkdir(exist_ok=True)
    lines = ["export const ROSTER = [\n"]
    for p in players:
        color_hex = hex(p["color"])
        lines.append(
            "  { "
            f'id: {p["id"]}, '
            f'name: {jsstr(p["name"])}, '
            f'team: {jsstr(p["team"])}, '
            f'color: {color_hex}, '
            f'hasData: {str(p["hasData"]).lower()}, '
            f'fga: {p["fga"]}, '
            f'fg_pct: {p["fg_pct"]}, '
            f'pts: {p["pts"]}, '
            f'gp: {p["gp"]}, '
            f'height_in: {p["height_in"]}, '
            f'position: {jsstr(p["position"])}'
            " },\n"
        )
    lines.append("];\n")
    ROSTER_PATH.write_text("".join(lines), encoding="utf-8")
    print(f"Wrote {len(players)} players → {ROSTER_PATH}")


def read_roster() -> list[dict[str, Any]]:
    """Parse roster.js back into Python dicts. Used by --heights to merge into existing roster."""
    if not ROSTER_PATH.exists():
        return []
    text = ROSTER_PATH.read_text()
    players: list[dict[str, Any]] = []
    for raw in text.splitlines():
        line = raw.strip().rstrip(",").strip()
        if not (line.startswith("{ ") and line.endswith(" }")):
            continue
        body = line[2:-2]
        parts = [p.strip() for p in body.split(", ")]
        d: dict[str, Any] = {}
        for part in parts:
            if ":" not in part:
                continue
            k, _, v = part.partition(":")
            k = k.strip()
            v = v.strip()
            if v.startswith('"') and v.endswith('"'):
                s = v[1:-1]
                # Legacy files may contain literal \uXXXX escapes; decode them.
                if "\\u" in s:
                    try:
                        s = s.encode("latin-1", "backslashreplace").decode("unicode_escape")
                    except (UnicodeDecodeError, UnicodeEncodeError):
                        pass
                d[k] = s
            elif v in ("true", "false"):
                d[k] = v == "true"
            elif v.startswith("0x"):
                d[k] = int(v, 16)
            else:
                try:
                    d[k] = int(v)
                except ValueError:
                    try:
                        d[k] = float(v)
                    except ValueError:
                        d[k] = v
        d.setdefault("fga", 0)
        d.setdefault("fg_pct", 0.0)
        d.setdefault("pts", 0)
        d.setdefault("gp", 0)
        d.setdefault("height_in", 0)
        d.setdefault("position", "")
        players.append(d)
    return players


def mark_has_data(player_id: int) -> None:
    if not ROSTER_PATH.exists():
        return
    text = ROSTER_PATH.read_text()
    lines = text.splitlines(keepends=True)
    for i, line in enumerate(lines):
        if f"id: {player_id}," in line and "hasData: false" in line:
            lines[i] = line.replace("hasData: false", "hasData: true")
            break
    ROSTER_PATH.write_text("".join(lines))


def write_shots(player_id: int, shots: list[dict[str, Any]]) -> int:
    SHOTS_DIR.mkdir(parents=True, exist_ok=True)
    out = SHOTS_DIR / f"{player_id}.js"
    lines = [f"export const SHOTS_{player_id} = [\n"]
    for s in shots:
        lines.append(
            "  { "
            f'LOC_X: {s["LOC_X"]}, '
            f'LOC_Y: {s["LOC_Y"]}, '
            f'SHOT_MADE_FLAG: {s["SHOT_MADE_FLAG"]}, '
            f'SHOT_TYPE: {json.dumps(s["SHOT_TYPE"])}, '
            f'PERIOD: {s["PERIOD"]}, '
            f'ACTION_TYPE: {json.dumps(s["ACTION_TYPE"])}, '
            f'SHOT_DISTANCE: {s["SHOT_DISTANCE"]}'
            " },\n"
        )
    lines.append("];\n")
    out.write_text("".join(lines))
    return len(shots)


def cmd_roster() -> None:
    print("Fetching roster with player stats...")
    players = fetch_roster()
    if ROSTER_PATH.exists():
        prev = {p["id"]: p for p in read_roster()}
        for p in players:
            old = prev.get(p["id"])
            if not old:
                continue
            p["hasData"] = bool(old.get("hasData", False))
            p["height_in"] = int(old.get("height_in", 0))
            p["position"] = str(old.get("position", ""))
    write_roster(players)


def cmd_heights() -> None:
    if not ROSTER_PATH.exists():
        sys.exit("No roster.js found — run --roster first")
    players = read_roster()
    heights = fetch_heights()
    matched = 0
    for p in players:
        h = heights.get(p["id"])
        if not h:
            continue
        updated = False
        if h["height_in"] > 0 and int(p.get("height_in", 0)) != h["height_in"]:
            p["height_in"] = h["height_in"]
            updated = True
        if h["position"] and str(p.get("position", "")).strip() != h["position"]:
            p["position"] = h["position"]
            updated = True
        if updated:
            matched += 1

    # Fallback: per-player commonplayerinfo for anyone still at height_in == 0.
    # Catches waived / mid-season-released players who don't appear in any
    # current team roster but did show up in leaguedashplayerstats.
    missing = [
        p["id"] for p in players
        if not p.get("height_in") or not str(p.get("position", "")).strip()
    ]
    if missing:
        filled = fetch_missing_heights(missing)
        for p in players:
            f = filled.get(p["id"])
            if not f:
                continue
            updated = False
            if f["height_in"] > 0 and int(p.get("height_in", 0)) != f["height_in"]:
                p["height_in"] = f["height_in"]
                updated = True
            if f["position"] and str(p.get("position", "")).strip() != f["position"]:
                p["position"] = f["position"]
                updated = True
            if updated:
                matched += 1

    write_roster(players)
    still_missing = sum(
        1 for p in players
        if not p.get("height_in") or not str(p.get("position", "")).strip()
    )
    print(
        f"Updated heights/positions for {matched}/{len(players)} players "
        f"({still_missing} still missing height and/or position)"
    )


def shot_file_needs_upgrade(path: Path) -> bool:
    """True if shot file is missing the new PERIOD field (legacy format)."""
    if not path.exists():
        return True
    try:
        sample = path.read_text()[:500]
    except OSError:
        return True
    return "PERIOD" not in sample


def cmd_top100() -> None:
    if not ROSTER_PATH.exists():
        print("No roster.js found — run --roster first")
        sys.exit(1)
    print("Fetching top-100 FGA leaders...")
    ids = fetch_top100_ids()
    print(f"Got {len(ids)} player IDs")
    for i, pid in enumerate(ids):
        out = SHOTS_DIR / f"{pid}.js"
        if out.exists() and not shot_file_needs_upgrade(out):
            print(f"  [{i+1}/100] {pid} — already cached (new format), skipping")
            mark_has_data(pid)
            continue
        try:
            shots = fetch_player_shots(pid)
            if not shots:
                print(f"  [{i+1}/100] {pid} — 0 shots, skipping")
            else:
                n = write_shots(pid, shots)
                mark_has_data(pid)
                print(f"  [{i+1}/100] {pid} — {n} shots")
        except Exception as e:
            print(f"  [{i+1}/100] {pid} — ERROR: {e}")
        time.sleep(0.6)
    print("Done.")


def read_roster_no_data() -> list[int]:
    if not ROSTER_PATH.exists():
        sys.exit("No roster.js found — run --roster first")
    ids: list[int] = []
    for line in ROSTER_PATH.read_text().splitlines():
        if "hasData: false" in line:
            m = re.search(r"id:\s*(\d+)", line)
            if m:
                ids.append(int(m.group(1)))
    return ids


def cmd_all() -> None:
    ids = read_roster_no_data()
    total = len(ids)
    print(f"Fetching shots for {total} players without data...")
    for i, pid in enumerate(ids):
        out = SHOTS_DIR / f"{pid}.js"
        if out.exists() and out.stat().st_size > 50 and not shot_file_needs_upgrade(out):
            print(f"  [{i+1}/{total}] {pid} — already cached (new format), marking")
            mark_has_data(pid)
            continue
        try:
            shots = fetch_player_shots(pid)
            if not shots:
                print(f"  [{i+1}/{total}] {pid} — 0 shots, skipping")
            else:
                n = write_shots(pid, shots)
                mark_has_data(pid)
                print(f"  [{i+1}/{total}] {pid} — {n} shots")
        except Exception as e:
            print(f"  [{i+1}/{total}] {pid} — ERROR: {e}")
        time.sleep(0.6)
    print("Done.")


def cmd_upgrade() -> None:
    """Re-fetch any shot file that's missing the new PERIOD/ACTION_TYPE/SHOT_DISTANCE fields."""
    if not SHOTS_DIR.exists():
        sys.exit("No shots directory — run --top100 first")
    to_upgrade: list[int] = []
    for path in sorted(SHOTS_DIR.glob("*.js")):
        if shot_file_needs_upgrade(path):
            try:
                to_upgrade.append(int(path.stem))
            except ValueError:
                continue
    total = len(to_upgrade)
    print(f"Upgrading {total} shot files to new format...")
    for i, pid in enumerate(to_upgrade):
        try:
            shots = fetch_player_shots(pid)
            if shots:
                n = write_shots(pid, shots)
                print(f"  [{i+1}/{total}] {pid} — {n} shots")
            else:
                print(f"  [{i+1}/{total}] {pid} — 0 shots, skipping")
        except Exception as e:
            print(f"  [{i+1}/{total}] {pid} — ERROR: {e}")
        time.sleep(0.6)
    print("Done.")


def cmd_player(player_id: int) -> None:
    SHOTS_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Fetching shots for player {player_id}...")
    shots = fetch_player_shots(player_id)
    n = write_shots(player_id, shots)
    mark_has_data(player_id)
    print(f"Wrote {n} shots → {SHOTS_DIR / str(player_id)}.js")


def main() -> None:
    parser = argparse.ArgumentParser()
    grp = parser.add_mutually_exclusive_group(required=True)
    grp.add_argument("--roster", action="store_true")
    grp.add_argument("--heights", action="store_true")
    grp.add_argument("--top100", action="store_true")
    grp.add_argument("--all", action="store_true", dest="all_players")
    grp.add_argument("--upgrade", action="store_true")
    grp.add_argument("--player", type=int, metavar="ID")
    args = parser.parse_args()

    if args.roster:
        cmd_roster()
    elif args.heights:
        cmd_heights()
    elif args.top100:
        cmd_top100()
    elif args.all_players:
        cmd_all()
    elif args.upgrade:
        cmd_upgrade()
    elif args.player:
        cmd_player(args.player)


if __name__ == "__main__":
    main()
