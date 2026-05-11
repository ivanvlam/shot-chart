#!/usr/bin/env python3
"""
NBA shot data fetcher for shot-chart.

Usage:
  python scripts/fetch_shots.py --roster           # write data/roster.js (~569 players)
  python scripts/fetch_shots.py --top100           # fetch shots for top-100 FGA players
  python scripts/fetch_shots.py --all              # fetch shots for all remaining players (~11 min)
  python scripts/fetch_shots.py --player 201939    # fetch shots for one player by ID

Requires: pip install nba_api
"""

import argparse
import json
import re
import sys
import time
from pathlib import Path

try:
    from nba_api.stats.endpoints import leaguedashplayerstats, leagueleaders, shotchartdetail
except ImportError:
    sys.exit("nba_api not installed — run: pip install nba_api")

BASE = Path(__file__).parent.parent
DATA = BASE / "data"
SHOTS_DIR = DATA / "shots"

SEASON = "2025-26"
SEASON_TYPE = "Regular Season"

# NBA team abbreviation → primary hex color
TEAM_COLORS = {
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


def fetch_roster() -> list:
    data = leaguedashplayerstats.LeagueDashPlayerStats(
        season=SEASON,
        season_type_all_star=SEASON_TYPE,
        per_mode_detailed="Totals",
        timeout=30,
    ).get_data_frames()[0]
    players = []
    seen = set()
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
        })
    players.sort(key=lambda p: p["name"].split()[-1].lower())
    return players


def fetch_top100_ids() -> list:
    data = leagueleaders.LeagueLeaders(
        season=SEASON,
        season_type_all_star=SEASON_TYPE,
        per_mode48="Totals",
        stat_category_abbreviation="FGA",
        timeout=30,
    ).get_data_frames()[0]
    return [int(row["PLAYER_ID"]) for _, row in data.head(100).iterrows()]


def fetch_player_shots(player_id: int) -> list:
    data = shotchartdetail.ShotChartDetail(
        team_id=0,
        player_id=player_id,
        season_nullable=SEASON,
        season_type_all_star=SEASON_TYPE,
        context_measure_simple="FGA",
        timeout=30,
    ).get_data_frames()[0]
    shots = []
    for _, row in data.iterrows():
        shots.append({
            "LOC_X": int(row["LOC_X"]),
            "LOC_Y": int(row["LOC_Y"]),
            "SHOT_MADE_FLAG": int(row["SHOT_MADE_FLAG"]),
            "SHOT_TYPE": row["SHOT_TYPE"],
        })
    return shots


def write_roster(players: list):
    DATA.mkdir(exist_ok=True)
    out = DATA / "roster.js"
    lines = ["export const ROSTER = [\n"]
    for p in players:
        color_hex = hex(p["color"])
        lines.append(
            f'  {{ id: {p["id"]}, name: {json.dumps(p["name"])}, '
            f'team: {json.dumps(p["team"])}, color: {color_hex}, '
            f'hasData: {str(p["hasData"]).lower()} }},\n'
        )
    lines.append("];\n")
    out.write_text("".join(lines))
    print(f"Wrote {len(players)} players → {out}")


def mark_has_data(player_id: int):
    roster_path = DATA / "roster.js"
    if not roster_path.exists():
        return
    text = roster_path.read_text()
    lines = text.splitlines(keepends=True)
    for i, line in enumerate(lines):
        if f"id: {player_id}," in line and "hasData: false" in line:
            lines[i] = line.replace("hasData: false", "hasData: true")
            break
    roster_path.write_text("".join(lines))


def write_shots(player_id: int, shots: list) -> int:
    SHOTS_DIR.mkdir(parents=True, exist_ok=True)
    out = SHOTS_DIR / f"{player_id}.js"
    lines = [f"export const SHOTS_{player_id} = [\n"]
    for s in shots:
        lines.append(
            f'  {{ LOC_X: {s["LOC_X"]}, LOC_Y: {s["LOC_Y"]}, '
            f'SHOT_MADE_FLAG: {s["SHOT_MADE_FLAG"]}, '
            f'SHOT_TYPE: {json.dumps(s["SHOT_TYPE"])} }},\n'
        )
    lines.append("];\n")
    out.write_text("".join(lines))
    return len(shots)


def cmd_roster():
    print("Fetching roster...")
    players = fetch_roster()
    write_roster(players)


def cmd_top100():
    roster_path = DATA / "roster.js"
    if not roster_path.exists():
        print("No roster.js found — run --roster first")
        sys.exit(1)
    print("Fetching top-100 FGA leaders...")
    ids = fetch_top100_ids()
    print(f"Got {len(ids)} player IDs")
    for i, pid in enumerate(ids):
        out = SHOTS_DIR / f"{pid}.js"
        if out.exists():
            print(f"  [{i+1}/100] {pid} — already cached, skipping")
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


def read_roster_no_data() -> list:
    roster_path = DATA / "roster.js"
    if not roster_path.exists():
        sys.exit("No roster.js found — run --roster first")
    ids = []
    for line in roster_path.read_text().splitlines():
        if "hasData: false" in line:
            m = re.search(r'id:\s*(\d+)', line)
            if m:
                ids.append(int(m.group(1)))
    return ids


def cmd_all():
    ids = read_roster_no_data()
    total = len(ids)
    print(f"Fetching shots for {total} players without data...")
    for i, pid in enumerate(ids):
        out = SHOTS_DIR / f"{pid}.js"
        if out.exists() and out.stat().st_size > 50:
            print(f"  [{i+1}/{total}] {pid} — already cached, marking")
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


def cmd_player(player_id: int):
    SHOTS_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Fetching shots for player {player_id}...")
    shots = fetch_player_shots(player_id)
    n = write_shots(player_id, shots)
    mark_has_data(player_id)
    print(f"Wrote {n} shots → {SHOTS_DIR / str(player_id)}.js")


def main():
    parser = argparse.ArgumentParser()
    grp = parser.add_mutually_exclusive_group(required=True)
    grp.add_argument("--roster", action="store_true")
    grp.add_argument("--top100", action="store_true")
    grp.add_argument("--all", action="store_true", dest="all_players")
    grp.add_argument("--player", type=int, metavar="ID")
    args = parser.parse_args()

    if args.roster:
        cmd_roster()
    elif args.top100:
        cmd_top100()
    elif args.all_players:
        cmd_all()
    elif args.player:
        cmd_player(args.player)


if __name__ == "__main__":
    main()
