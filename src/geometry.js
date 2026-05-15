import * as THREE from 'three';
import { scene } from './scene.js';
import {
  HOOP_Y, HOOP_Z, HOOP_RADIUS, BB_Z, POLE_Z,
  CROWD_COUNT, JUMP_PER, JUMP_HEIGHT,
  TEAM_SECONDARY, getTeamSecondary,
} from './constants.js';

// ---------------------------------------------------------------------------
// Court materials (MAT_APRON exported so ui.js can recolor it)
// ---------------------------------------------------------------------------
export const MAT_WOOD  = new THREE.MeshStandardMaterial({ color: 0xc8924a, roughness: 0.78 });
export const MAT_LINE  = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
export const MAT_APRON = new THREE.MeshStandardMaterial({ color: 0x1d428a, roughness: 0.88 });

// Ball + floor-marker materials
export const MAT_MADE          = new THREE.MeshStandardMaterial({ color: 0x3ddc6a, emissive: 0x22aa44, emissiveIntensity: 0.7, roughness: 0.35 });
export const MAT_MISS          = new THREE.MeshStandardMaterial({ color: 0xe04444, emissive: 0xaa2222, emissiveIntensity: 0.7, roughness: 0.35 });
export const MAT_DOT_MADE_FILL = new THREE.MeshBasicMaterial({ color: 0x3ddc6a, transparent: true, opacity: 1.0,  depthWrite: false });
export const MAT_DOT_MADE_RING = new THREE.MeshBasicMaterial({ color: 0x2ab854, transparent: true, opacity: 0.65, depthWrite: false });
export const MAT_CROSS_MISS    = new THREE.MeshBasicMaterial({ color: 0xe04444, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide });

export const CROSS_BAR_GEO = new THREE.PlaneGeometry(0.62, 0.13);

export function makeMissCross(x, z) {
  const g = new THREE.Group();
  const b1 = new THREE.Mesh(CROSS_BAR_GEO, MAT_CROSS_MISS);
  b1.rotation.set(-Math.PI / 2, 0,  Math.PI / 4);
  g.add(b1);
  const b2 = new THREE.Mesh(CROSS_BAR_GEO, MAT_CROSS_MISS);
  b2.rotation.set(-Math.PI / 2, 0, -Math.PI / 4);
  g.add(b2);
  g.position.set(x, 0.14, z);
  return g;
}

// dotGroup holds all persistent floor markers
export const dotGroup = new THREE.Group();
scene.add(dotGroup);

// ---------------------------------------------------------------------------
// Court geometry
// ---------------------------------------------------------------------------
function box(w, h, d, x, y, z, mat, shadow = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  if (shadow) { m.receiveShadow = true; m.castShadow = false; }
  scene.add(m);
  return m;
}

function hline(w, d, x, z, t = 0.08) { box(w, t, d, x, t / 2, z, MAT_LINE); }

function arc(cx, cz, r, a0, a1, yPos, segs = 72, thick = 0.06) {
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const a = a0 + (a1 - a0) * (i / segs);
    pts.push(new THREE.Vector3(cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r));
  }
  const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), segs, thick / 2, 5, false);
  const m = new THREE.Mesh(geo, MAT_LINE);
  m.position.y = yPos;
  scene.add(m);
}

export function buildCourt() {
  {
    const hw = 51, hd = 45.5, r = 8;
    const s = new THREE.Shape();
    s.moveTo(-hw + r, -hd);
    s.lineTo( hw - r, -hd);
    s.absarc( hw - r, -hd + r, r, -Math.PI / 2, 0,            false);
    s.lineTo( hw,      hd - r);
    s.absarc( hw - r,  hd - r, r, 0,             Math.PI / 2,  false);
    s.lineTo(-hw + r,  hd);
    s.absarc(-hw + r,  hd - r, r, Math.PI / 2,   Math.PI,      false);
    s.lineTo(-hw,     -hd + r);
    s.absarc(-hw + r, -hd + r, r, Math.PI,       3 * Math.PI / 2, false);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: false });
    const apron = new THREE.Mesh(geo, MAT_APRON);
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(0, -0.075, -19.5);
    apron.receiveShadow = true;
    scene.add(apron);
  }

  box(50, 0.15, 47, 0, 0, -23.5, MAT_WOOD);
  hline(50, 0.12, 0,    0);
  hline(50, 0.12, 0,  -47);
  hline(0.1, 47, -25, -23.5);
  hline(0.1, 47,  25, -23.5);
  hline(0.1, 19,  -8, -9.5);
  hline(0.1, 19,   8, -9.5);
  hline(16,  0.1,  0, -19);
  arc(0, -19, 6, 0, Math.PI * 2, 0.17);
  arc(0, HOOP_Z, 4, 0, -Math.PI, 0.18, 36, 0.06);
  arc(0, -47, 6, 0, Math.PI, 0.16, 48, 0.06);
  arc(0, -47, 2, 0, Math.PI, 0.16, 24, 0.05);
}

export function build3PointArc() {
  const r3 = 23.75;
  const cornerX = 22;
  const arcStartZ = -Math.sqrt(r3 * r3 - cornerX * cornerX);
  const cornerWorldZ = HOOP_Z + arcStartZ;
  const cornerLineLen = -cornerWorldZ;
  const cornerLineMid = cornerWorldZ / 2;
  hline(0.1, cornerLineLen,  cornerX, cornerLineMid, 0.09);
  hline(0.1, cornerLineLen, -cornerX, cornerLineMid, 0.09);
  const a0 = Math.atan2(arcStartZ,  cornerX);
  const a1 = Math.atan2(arcStartZ, -cornerX);
  arc(0, HOOP_Z, r3, a0, a1, 0.18, 90, 0.07);
}

// ---------------------------------------------------------------------------
// Basket
// ---------------------------------------------------------------------------
export let hoopMesh  = null;
export let netMesh   = null;
export let hoopBaseY = HOOP_Y;
export let netBaseY  = HOOP_Y - 0.75;

export function buildBasket() {
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8, roughness: 0.3 });

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 13, 12), metalMat);
  pole.position.set(0, 6.75, POLE_Z);
  pole.castShadow = true;
  scene.add(pole);

  const overhangLen = POLE_Z - BB_Z + 0.1;
  const overhang = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, overhangLen, 8), metalMat);
  overhang.rotation.x = Math.PI / 2;
  overhang.position.set(0, 13, (POLE_Z + BB_Z) / 2);
  scene.add(overhang);

  const BB_CY = 11.25;
  const boardMat = new THREE.MeshBasicMaterial({
    color: 0xc8e8ff, transparent: true, opacity: 0.13, side: THREE.DoubleSide,
  });
  const board = new THREE.Mesh(new THREE.BoxGeometry(6, 3.5, 0.06), boardMat);
  board.position.set(0, BB_CY, BB_Z);
  scene.add(board);

  const frameMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
  const fZ = BB_Z - 0.07, fW = 6.0, fH = 3.5, fT = 0.12;
  for (const [w, h, fx, fy] of [
    [fW + fT, fT,  0,        BB_CY + fH / 2],
    [fW + fT, fT,  0,        BB_CY - fH / 2],
    [fT,      fH, -fW / 2,   BB_CY         ],
    [fT,      fH,  fW / 2,   BB_CY         ],
  ]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.05), frameMat);
    bar.position.set(fx, fy, fZ);
    scene.add(bar);
  }

  const sqMat = new THREE.MeshBasicMaterial({ color: 0xff1a00 });
  const bW = 2.0, bH = 1.5, bT = 0.07, bZ = BB_Z - 0.09, sqCY = HOOP_Y + bH / 2;
  for (const [w, h, sx, sy] of [
    [bW + bT * 2, bT,  0,       sqCY + bH / 2],
    [bW + bT * 2, bT,  0,       sqCY - bH / 2],
    [bT,          bH, -bW / 2,  sqCY         ],
    [bT,          bH,  bW / 2,  sqCY         ],
  ]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.05), sqMat);
    bar.position.set(sx, sy, bZ);
    scene.add(bar);
  }

  const rimNearZ = HOOP_Z + HOOP_RADIUS;
  const arm = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, Math.abs(rimNearZ - BB_Z), 8), metalMat
  );
  arm.rotation.x = Math.PI / 2;
  arm.position.set(0, HOOP_Y, (BB_Z + rimNearZ) / 2);
  scene.add(arm);

  const hoopMat = new THREE.MeshStandardMaterial({ color: 0xff5200, roughness: 0.35, metalness: 0.75 });
  const hoop = new THREE.Mesh(new THREE.TorusGeometry(HOOP_RADIUS, 0.065, 12, 48), hoopMat);
  hoop.position.set(0, HOOP_Y, HOOP_Z);
  hoop.rotation.x = Math.PI / 2;
  scene.add(hoop);

  const netMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, transparent: true, opacity: 0.32, wireframe: true,
  });
  const net = new THREE.Mesh(
    new THREE.CylinderGeometry(HOOP_RADIUS - 0.04, HOOP_RADIUS * 0.4, 1.5, 16, 4, true),
    netMat
  );
  net.position.set(0, HOOP_Y - 0.75, HOOP_Z);
  scene.add(net);

  hoopMesh  = hoop;
  netMesh   = net;
  hoopBaseY = HOOP_Y;
  netBaseY  = net.position.y;

  box(2, 0.4, 2, 0, 0.2, POLE_Z, metalMat);
}

// ---------------------------------------------------------------------------
// Basket animation effects
// ---------------------------------------------------------------------------
export const basketEffects = [];

export function triggerNetSwish() {
  if (!netMesh) return;
  basketEffects.push({ type: 'swish', t: 0, dur: 0.45 });
}

export function triggerRimShake(strength = 1) {
  if (!hoopMesh) return;
  basketEffects.push({ type: 'shake', t: 0, dur: 0.28, strength: Math.min(strength, 1.6) });
}

export function updateBasketEffects(dt) {
  if (basketEffects.length === 0) {
    if (netMesh)  { netMesh.scale.set(1, 1, 1); netMesh.position.y = netBaseY; }
    if (hoopMesh) { hoopMesh.scale.set(1, 1, 1); hoopMesh.position.y = hoopBaseY; }
    return;
  }
  let netSY = 1, netSXZ = 1, rimDy = 0, rimSXZ = 1;
  for (let i = basketEffects.length - 1; i >= 0; i--) {
    const ef = basketEffects[i];
    ef.t += dt;
    const p = ef.t / ef.dur;
    if (p >= 1) { basketEffects.splice(i, 1); continue; }
    if (ef.type === 'swish') {
      const decay = Math.exp(-3.0 * p);
      const phase = 2 * Math.PI * 1.6 * p;
      netSY  += 0.18 * Math.sin(phase)       * decay;
      netSXZ += 0.06 * Math.cos(phase * 1.2) * decay;
    } else if (ef.type === 'shake') {
      const damp = Math.exp(-5 * p);
      rimDy  += 0.035 * ef.strength * damp * Math.sin(2 * Math.PI * 7 * p);
      rimSXZ += 0.015 * ef.strength * damp * Math.cos(2 * Math.PI * 5 * p);
    }
  }
  if (netMesh) {
    netMesh.scale.set(netSXZ, netSY, netSXZ);
    netMesh.position.y = HOOP_Y - 0.75 * netSY;
  }
  if (hoopMesh) {
    hoopMesh.scale.set(rimSXZ, 1, rimSXZ);
    hoopMesh.position.y = hoopBaseY + rimDy;
  }
}

// ---------------------------------------------------------------------------
// Splash / bounce effects
// ---------------------------------------------------------------------------
export const splashEffects = [];

export function addMadeSplash(shotIdx) {
  for (let i = 0; i < 2; i++) {
    const geo = new THREE.RingGeometry(HOOP_RADIUS * 0.7, HOOP_RADIUS, 32);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x3ddc6a, transparent: true, opacity: i === 0 ? 0.9 : 0.55,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, HOOP_Y + 0.05, HOOP_Z);
    scene.add(mesh);
    splashEffects.push({ type: 'made', shotIdx, mesh, mat, t: -i * 0.1, dur: 0.55, baseOpacity: i === 0 ? 0.9 : 0.55 });
  }
}

function bounceY(ef, t) {
  const R = 0.36;
  for (const seg of ef.segs) {
    if (t <= seg.startT + seg.dur) {
      const s = (t - seg.startT) / seg.dur;
      if (seg.type === 'rise') return seg.y0 + seg.dy * (2*s - s*s);
      if (seg.type === 'fall') return seg.y0 + (R - seg.y0) * s*s;
      return R + seg.peakH * 4*s*(1-s);
    }
  }
  return 0.36;
}

export function addMissBounce(endPos, shotIdx) {
  const g = 32, TSCALE = 0.55, R = 0.36;
  const RIM_H = 2.0, FLOOR = [0.6, 0.25];
  const odx = endPos.x, odz = endPos.z - HOOP_Z;
  const olen = Math.sqrt(odx * odx + odz * odz) || 1;
  const vx = 3.0 * odx / olen, vz = 3.0 * odz / olen;
  const segs = [];
  let t = 0;
  const riseDur = Math.sqrt(2 * RIM_H / g) * TSCALE;
  segs.push({ startT: t, dur: riseDur, type: 'rise', y0: endPos.y, dy: RIM_H });
  t += riseDur;
  const peakY = endPos.y + RIM_H;
  const fallDur = Math.sqrt(2 * (peakY - R) / g) * TSCALE;
  segs.push({ startT: t, dur: fallDur, type: 'fall', y0: peakY });
  t += fallDur;
  const firstImpactT = t;
  for (const ph of FLOOR) {
    const bd = 2 * Math.sqrt(2 * ph / g) * TSCALE;
    segs.push({ startT: t, dur: bd, type: 'bounce', peakH: ph });
    t += bd;
  }
  const totalDur = t + 0.18;
  const ballMat = new THREE.MeshStandardMaterial({
    color: 0xe04444, emissive: 0xaa2222, emissiveIntensity: 0.6, roughness: 0.35, transparent: true,
  });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(R, 12, 12), ballMat);
  ball.position.copy(endPos);
  scene.add(ball);
  const ripMat = new THREE.MeshBasicMaterial({
    color: 0xe04444, transparent: true, opacity: 0,
    side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const ripple = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.18, 24), ripMat);
  ripple.rotation.x = -Math.PI / 2;
  ripple.position.set(endPos.x, 0.13, endPos.z);
  scene.add(ripple);
  splashEffects.push({
    type: 'miss', shotIdx, ball, ballMat, ripple, ripMat,
    startX: endPos.x, startZ: endPos.z, vx, vz,
    segs, totalDur, firstImpactT, t: 0, dur: totalDur,
  });
}

export function tickSplashEffects(dt, sceneRef) {
  for (let i = splashEffects.length - 1; i >= 0; i--) {
    const ef = splashEffects[i];
    ef.t += dt;
    if (ef.type === 'made') {
      const p = Math.min(Math.max(ef.t / ef.dur, 0), 1);
      const scale = 1 + p * 5.5;
      ef.mesh.scale.set(scale, scale, scale);
      ef.mat.opacity = (1 - p) * ef.baseOpacity;
      if (p >= 1) {
        sceneRef.remove(ef.mesh); ef.mesh.geometry.dispose(); ef.mat.dispose();
        splashEffects.splice(i, 1);
      }
    } else {
      ef.ball.position.set(ef.startX + ef.vx * ef.t, bounceY(ef, ef.t), ef.startZ + ef.vz * ef.t);
      if (ef.t >= ef.firstImpactT) {
        const landX = ef.startX + ef.vx * ef.firstImpactT;
        const landZ = ef.startZ + ef.vz * ef.firstImpactT;
        ef.ripple.position.set(landX, 0.13, landZ);
        const rp = Math.min((ef.t - ef.firstImpactT) / 0.35, 1);
        ef.ripple.scale.set(1 + rp * 5, 1 + rp * 5, 1 + rp * 5);
        ef.ripMat.opacity = (1 - rp) * 0.65;
      }
      const fadeStart = ef.totalDur - 0.18;
      if (ef.t > fadeStart) ef.ballMat.opacity = 1 - (ef.t - fadeStart) / 0.18;
      if (ef.t >= ef.dur) {
        sceneRef.remove(ef.ball); ef.ball.geometry.dispose(); ef.ballMat.dispose();
        sceneRef.remove(ef.ripple); ef.ripple.geometry.dispose(); ef.ripMat.dispose();
        splashEffects.splice(i, 1);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Arena + crowd
// ---------------------------------------------------------------------------
export let arenaGroup = null;
let crowdMesh = null;
let crowdTypes = null;
let crowdBaseMatrices = null;
let crowdWaves = [];

export function updateCrowdColors(primaryHex, secondaryHex) {
  if (!crowdMesh) return;
  const accentC    = new THREE.Color(primaryHex);
  const secondaryC = new THREE.Color(secondaryHex ?? 0xf0e8e0);

  const luma = (hex) => {
    const r = (hex >> 16) & 0xff, g = (hex >> 8) & 0xff, b = hex & 0xff;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  };
  const chroma = (hex) => {
    const r = (hex >> 16) & 0xff, g = (hex >> 8) & 0xff, b = hex & 0xff;
    return Math.max(r, g, b) - Math.min(r, g, b);
  };
  const secHex = secondaryHex ?? 0xf0e8e0;
  const minL = Math.min(luma(primaryHex), luma(secHex));
  const brightHex = luma(primaryHex) >= luma(secHex) ? primaryHex : secHex;
  // One color dark + the brighter color is vivid (not neutral gray/white) → use light neutral
  const neutralC = new THREE.Color(minL < 0.25 && chroma(brightHex) > 40 ? 0xc8cad8 : 0x2a2a3a);

  for (let i = 0; i < crowdMesh.count; i++) {
    if (crowdTypes[i] === 0)      crowdMesh.setColorAt(i, accentC);
    else if (crowdTypes[i] === 1) crowdMesh.setColorAt(i, secondaryC);
    else                          crowdMesh.setColorAt(i, neutralC);
  }
  crowdMesh.instanceColor.needsUpdate = true;
}

export function buildArena() {
  arenaGroup = new THREE.Group();
  scene.add(arenaGroup);

  const shellMat = new THREE.MeshStandardMaterial({ color: 0x111824, roughness: 0.92, side: THREE.BackSide });
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(76, 76, 55, 40, 1, true), shellMat);
  shell.position.set(0, 16, -23.5);
  arenaGroup.add(shell);

  const ceilMat = new THREE.MeshStandardMaterial({ color: 0x07111e, roughness: 1.0 });
  const ceil = new THREE.Mesh(new THREE.CircleGeometry(76, 40), ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, 43.5, -23.5);
  arenaGroup.add(ceil);

  for (const [rx, rz] of [[-36, 0], [36, 0], [-36, -47], [36, -47]]) {
    const rl = new THREE.PointLight(0x8899cc, 0.65, 65);
    rl.position.set(rx, 40, rz);
    arenaGroup.add(rl);
  }

  const groundMat = new THREE.MeshStandardMaterial({ color: 0x0e1520, roughness: 0.98 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.02, -23.5);
  ground.receiveShadow = true;
  arenaGroup.add(ground);

  const bleachMat = new THREE.MeshStandardMaterial({ color: 0x0a0e18, roughness: 0.95 });
  function addTier(w, d, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.0, d), bleachMat);
    m.position.set(x, y, z);
    m.receiveShadow = true;
    arenaGroup.add(m);
  }
  for (let t = 0; t < 8; t++) addTier(56 + t * 2, 2.4, 0, 1.0 + t * 1.5, 4.5 + t * 2.5);
  for (let t = 0; t < 8; t++) addTier(2.4, 50, -28.5 - t * 2.5, 1.0 + t * 1.5, -23.5);
  for (let t = 0; t < 8; t++) addTier(2.4, 50,  28.5 + t * 2.5, 1.0 + t * 1.5, -23.5);

  const headGeo = new THREE.BoxGeometry(0.5, 0.82, 0.38);
  const headMat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
  crowdMesh = new THREE.InstancedMesh(headGeo, headMat, CROWD_COUNT);
  crowdMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  crowdTypes = new Uint8Array(CROWD_COUNT);
  arenaGroup.add(crowdMesh);

  const dummy = new THREE.Object3D();
  let ci = 0;
  function placeCrowd(x, y, z, rotY) {
    if (ci >= CROWD_COUNT) return;
    crowdTypes[ci] = Math.random() < 0.3 ? 0 : (Math.random() < 0.6 ? 1 : 2);
    dummy.position.set(x, y + 0.41, z);
    dummy.rotation.set(0, rotY, 0);
    dummy.updateMatrix();
    crowdMesh.setMatrixAt(ci++, dummy.matrix);
  }

  for (let t = 0; t < 8; t++)
    for (let xi = -18; xi <= 18; xi++)
      placeCrowd(xi * 1.5, 1.5 + t * 1.5, 4.5 + t * 2.5, Math.PI);
  for (let t = 0; t < 8; t++)
    for (let zi = -11; zi <= 10; zi++)
      placeCrowd(-28.5 - t * 2.5, 1.5 + t * 1.5, -23.5 + zi * 2.2, Math.PI / 2);
  for (let t = 0; t < 8; t++)
    for (let zi = -11; zi <= 10; zi++)
      placeCrowd(28.5 + t * 2.5, 1.5 + t * 1.5, -23.5 + zi * 2.2, -Math.PI / 2);

  crowdMesh.count = ci;
  crowdMesh.instanceMatrix.needsUpdate = true;

  crowdBaseMatrices = new Array(ci);
  const _snap = new THREE.Matrix4();
  for (let i = 0; i < ci; i++) {
    crowdMesh.getMatrixAt(i, _snap);
    crowdBaseMatrices[i] = _snap.clone();
  }
  // Dead code removed: if (currentPlayer) updateCrowdColors(...) — currentPlayer is always null at boot
}

export function triggerCrowdJump() {
  if (!crowdBaseMatrices) return;
  const delays = new Float32Array(crowdMesh.count);
  let maxDelay = 0;
  for (let i = 0; i < crowdMesh.count; i++) {
    const e = crowdBaseMatrices[i].elements;
    const dx = e[12], dz = e[14] - HOOP_Z;
    const d = Math.sqrt(dx * dx + dz * dz) / 20 * 0.4 + Math.random() * 0.9;
    delays[i] = d;
    if (d > maxDelay) maxDelay = d;
  }
  crowdWaves.push({ time: 0, delays, maxDelay });
}

export function tickCrowdWaves(dt) {
  if (!crowdBaseMatrices || crowdWaves.length === 0) return;
  for (const w of crowdWaves) w.time += dt;
  crowdWaves = crowdWaves.filter(w => w.time <= w.maxDelay + JUMP_PER);
  const _jm = new THREE.Matrix4();
  for (let i = 0; i < crowdMesh.count; i++) {
    let dy = 0;
    for (const w of crowdWaves) {
      const lt = w.time - w.delays[i];
      if (lt > 0 && lt < JUMP_PER) dy += Math.sin(Math.PI * lt / JUMP_PER) * JUMP_HEIGHT;
    }
    _jm.copy(crowdBaseMatrices[i]);
    _jm.elements[13] += dy;
    crowdMesh.setMatrixAt(i, _jm);
  }
  crowdMesh.instanceMatrix.needsUpdate = true;
}
