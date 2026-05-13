# NBA Shot Chart 3D :basketball:

3D shot chart for NBA players built with Three.js. Animates field goal attempts from the 2025-26 regular season over a half-court scene.

**Note:** shots taken from behind half court are not shown in the animation, but they are included in the stats.

**Live:** https://ivanvlam.github.io/shot-chart/

## Features

- **Shot data** - 582 players, full 2025-26 regular season
- **3D scene** - court, backboard, hoop, net, bleachers, instanced crowd (~720 heads)
- **Per-shot animation** - parabolic arc, ribbon trail, floor markers, point light
- **Shot markers** - made shots leave a green dot+ring, misses leave a red X, and clicking a marker shows distance/quarter/action details
- **Landing effects** - rings on makes, bouncing ball and floor ripple on misses
- **Crowd** - wave animation on made shots
- **Filtered stats** - MADE / MISSED / FG%, plus PAINT / MID / 3PT FG% for the current shot filter
- **Shot filters** - result, shot type, zone, and quarter
- **Player picker** - roster search, team/position/height/stat filters, and sorting
- **Team colors** - apron, crowd, and UI theme per player
- **Speed** - 0.5x to 10x
- **Progress** - scrub through the filtered shot sequence
- **Arena toggle** - show or hide the surrounding arena
- **Camera** - preset views (broadcast/sideline/top), auto camera pan mode, and free orbit controls (zoom + right-drag pan)

## Running locally

Requires an HTTP server (dynamic `import()` is blocked over `file://`):

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

No npm, no build step. Three.js is loaded via CDN importmap.

## Updating shot data

Data is pre-fetched and committed. To refresh or add players:

```bash
# Refresh full roster and season totals
python3 scripts/fetch_shots.py --roster

# Add roster height/position fields
python3 scripts/fetch_shots.py --heights

# Fetch top-100 FGA leaders
python3 scripts/fetch_shots.py --top100

# Fetch all remaining players without shot data
python3 scripts/fetch_shots.py --all

# Re-fetch shot files missing PERIOD / ACTION_TYPE / SHOT_DISTANCE
python3 scripts/fetch_shots.py --upgrade

# Single player by NBA Stats ID
python3 scripts/fetch_shots.py --player 201939
```

Run `--roster` first. `--heights` enriches the picker filters. Shot files land in `data/shots/{player_id}.js`.

## Deployment

Static site, no backend. Works on GitHub Pages, Vercel, Netlify, or any static host.

**GitHub Pages:** Settings -> Pages -> Source: `main` branch, root `/`

**Vercel:** Import the GitHub repo, no configuration needed.

## Tech stack

- [Three.js](https://threejs.org/) r167 (CDN importmap, no npm)
- NBA Stats API (`shotchartdetail` endpoint) - data fetched at build time, not at runtime
- Vanilla JS ES modules
- Single-file app (`index.html`)
