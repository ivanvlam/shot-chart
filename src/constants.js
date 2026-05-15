import * as THREE from 'three';

export const SCALE = 0.1;
export const HOOP_Y = 10;
export const HOOP_RADIUS = 0.75;
export const HOOP_Z = -5.25;
export const BB_Z = -4.0;
export const POLE_Z = 1.5;

export const SHOT_DURATION_BASE = 1.2;
export const INTER_GAP_BASE = 0.5;
export const TRAIL_LEN = 54;

export const CROWD_COUNT = 720;
export const JUMP_PER = 0.28;
export const JUMP_HEIGHT = 0.55;

export function shotToFloor(locX, locY) {
  return new THREE.Vector3(locX * SCALE, 0, HOOP_Z - locY * SCALE);
}

export function parabola(p0, p1, maxH, t) {
  return new THREE.Vector3(
    p0.x + (p1.x - p0.x) * t,
    p0.y + (p1.y - p0.y) * t + maxH * 4 * t * (1 - t),
    p0.z + (p1.z - p0.z) * t
  );
}

export function classifyZone(raw) {
  const ax = Math.abs(raw.LOC_X);
  if (raw.SHOT_TYPE.startsWith('3PT')) return ax >= 220 ? 'corner3' : 'three';
  if (ax <= 80 && raw.LOC_Y <= 190) return 'paint';
  return 'mid';
}

// primaryHex and return value are hex integers (e.g. 0x1d428a), not CSS strings
export const TEAM_SECONDARY = {
  ATL: 0xFDB927, BOS: 0xBB9753, BKN: 0xCCCCCC, CHA: 0x00788C, CHI: 0x000000,
  CLE: 0xFDBB30, DAL: 0xB8C4CA, DEN: 0xFEC524, DET: 0x1D42BA, GSW: 0xFFC72C,
  HOU: 0xC4CED4, IND: 0xFDBB30, LAC: 0x1D428A, LAL: 0xFDB927, MEM: 0xFFD432,
  MIA: 0xF9A01B, MIL: 0xEEE1C6, MIN: 0x78BE20, NOP: 0x85714D, NYK: 0xF58426,
  OKC: 0xEF3B24, ORL: 0x000000, PHI: 0xED174C, PHX: 0xE56020, POR: 0x000000,
  SAC: 0x63727A, SAS: 0x000000, TOR: 0x000000, UTA: 0xF9A01B, WAS: 0xE31837,
};

export function getTeamSecondary(teamAbbr, primaryHex) {
  const s = TEAM_SECONDARY[teamAbbr];
  if (s !== undefined) return s;
  const r = (primaryHex >> 16) & 0xff;
  const g = (primaryHex >> 8) & 0xff;
  const b = primaryHex & 0xff;
  const mix = 0.55;
  return (Math.round(r + (255 - r) * mix) << 16) |
         (Math.round(g + (255 - g) * mix) << 8)  |
          Math.round(b + (255 - b) * mix);
}
