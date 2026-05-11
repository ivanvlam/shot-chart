# NBA Shot Chart 3D

3D shot chart for NBA players built with Three.js. Animates every field goal attempt from the 2025-26 regular season over a half-court scene.

**Live:** https://ivanvlam.github.io/shot-chart/

## Features

- **Shot data** - 581 players, full 2025-26 regular season
- **3D scene** - court, backboard, hoop, net, bleachers, instanced crowd (~590 heads)
- **Per-shot animation** - parabolic arc, ribbon trail, floor markers, point light
- **Landing effects** - rings on makes, bouncing ball and floor ripple on misses
- **Crowd** - wave animation on made shots
- **Zone stats** - PAINT / MID / 3PT FG% for the full season, unaffected by the filter
- **Made/Missed filter** - toggles animation visibility only, not stats
- **Player search** - typeahead over the full roster with keyboard navigation
- **Team colors** - apron, crowd, and UI theme per player
- **Speed** - 0.5x to 10x
- **Camera** - orbit, scroll to zoom, right-drag to pan

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
# Refresh full roster
python3 scripts/fetch_shots.py --roster

# Fetch top-100 FGA leaders (~2 min)
python3 scripts/fetch_shots.py --top100

# Single player by NBA Stats ID
python3 scripts/fetch_shots.py --player 201939
```

Run `--roster` first. Shot files land in `data/shots/{player_id}.js`.

## Deployment

Static site, no backend. Works on GitHub Pages, Vercel, Netlify, or any static host.

**GitHub Pages:** Settings -> Pages -> Source: `main` branch, root `/`

**Vercel:** Import the GitHub repo, no configuration needed.

## Tech stack

- [Three.js](https://threejs.org/) r167 (CDN importmap, no npm)
- NBA Stats API (`shotchartdetail` endpoint) - data fetched at build time, not at runtime
- Vanilla JS ES modules
- Single-file app (`index.html`)
