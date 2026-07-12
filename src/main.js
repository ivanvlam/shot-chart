import * as THREE from 'three';
import { renderer, scene, camera, controls } from './scene.js';
import {
  HOOP_Y, HOOP_Z, HOOP_RADIUS,
  SHOT_DURATION_BASE, INTER_GAP_BASE, TRAIL_LEN,
  shotToFloor, parabola, classifyZone, getTeamSecondary,
} from './constants.js';
import {
  MAT_APRON, MAT_MADE, MAT_MISS,
  MAT_DOT_MADE_FILL, MAT_DOT_MADE_RING, MAT_CROSS_MISS, CROSS_BAR_GEO,
  makeMissCross, dotGroup,
  buildCourt, build3PointArc, buildBasket, buildArena,
  splashEffects, addMadeSplash, addMissBounce,
  triggerNetSwish, triggerRimShake, updateBasketEffects,
  tickSplashEffects, triggerCrowdJump, tickCrowdWaves, updateCrowdColors,
} from './geometry.js';
import * as GEO from './geometry.js';
import { DATA_VERSION, ROSTER, shotCache } from './data.js';

const canvas = renderer.domElement;

// ---------------------------------------------------------------------------
// Shot data state
// ---------------------------------------------------------------------------
let RAW_SHOTS = [];
let currentPlayer = null;
let playerLoadToken = 0;
let shots = [];
let activeShots = [];
let shotQueue = [];
let firedSet = new Set();
let queueTimer = 0;
let playing = false;
let sequenceDone = false;
let speed = 1;
let madeCount = 0;
let missCount = 0;
let zoneCounts = { paint: [0,0], mid: [0,0], three: [0,0] };

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------
const filters = {
  result: new Set(['made', 'miss']),
  type:   new Set(['2PT', '3PT']),
  zone:   new Set(['paint', 'mid', 'three']),
  period: new Set([1, 2, 3, 4, 5]),
};

const DEFAULT_FILTERS = () => ({
  result: new Set(['made', 'miss']),
  type:   new Set(['2PT', '3PT']),
  zone:   new Set(['paint', 'mid', 'three']),
  period: new Set([1, 2, 3, 4, 5]),
});

const pendingFilters = {
  result: new Set(filters.result),
  type:   new Set(filters.type),
  zone:   new Set(filters.zone),
  period: new Set(filters.period),
};

function shotPassesFilters(s) {
  if (!filters.result.has(s.made ? 'made' : 'miss')) return false;
  const typeKey = s.raw.SHOT_TYPE && s.raw.SHOT_TYPE.startsWith('3PT') ? '3PT' : '2PT';
  if (!filters.type.has(typeKey)) return false;
  const zk = (s.zone === 'corner3') ? 'three' : s.zone;
  if (!filters.zone.has(zk)) return false;
  const p = s.raw.PERIOD || 1;
  if (!filters.period.has(p >= 5 ? 5 : p)) return false;
  return true;
}

function zoneKey(zone) {
  return zone === 'paint' ? 'paint' : zone === 'mid' ? 'mid' : 'three';
}

function updateZoneStats(zone, made) {
  const k = zoneKey(zone);
  zoneCounts[k][1]++;
  if (made) zoneCounts[k][0]++;
  const pct = (c) => c[1] > 0 ? Math.round(c[0] / c[1] * 100) + '%' : '—';
  document.getElementById('statPaintPct').textContent = pct(zoneCounts.paint);
  document.getElementById('statMidPct').textContent   = pct(zoneCounts.mid);
  document.getElementById('statThreePct').textContent = pct(zoneCounts.three);
}

function filteredIndices() {
  const out = [];
  for (let i = 0; i < shots.length; i++) {
    if (shotPassesFilters(shots[i])) out.push(i);
  }
  return out;
}

function placeFloorMarker(s) {
  if (s.made) {
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.16, 28), MAT_DOT_MADE_FILL);
    dot.rotation.x = -Math.PI / 2;
    dot.position.set(s.floor.x, 0.14, s.floor.z);
    dotGroup.add(dot);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.26, 0.42, 36), MAT_DOT_MADE_RING);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(s.floor.x, 0.14, s.floor.z);
    dotGroup.add(ring);
  } else {
    dotGroup.add(makeMissCross(s.floor.x, s.floor.z));
  }
}

function prepareShots() {
  shots = RAW_SHOTS.map((raw) => {
    const floor  = shotToFloor(raw.LOC_X, raw.LOC_Y);
    const origin = floor.clone().setY(4.5);
    const hoop   = new THREE.Vector3(0, HOOP_Y, HOOP_Z);
    const made   = raw.SHOT_MADE_FLAG === 1;
    const end = made
      ? hoop.clone()
      : hoop.clone().add(new THREE.Vector3(
          (Math.random() < 0.5 ? 1 : -1) * (0.9 + Math.random() * 0.8),
          (Math.random() - 0.5) * 0.5,
          (Math.random() - 0.5) * 1.0
        ));
    const dist = origin.distanceTo(hoop);
    const maxH = 3.5 + dist * 0.09;
    return { raw, origin, end, maxH, made, floor, zone: classifyZone(raw), heave: raw.LOC_Y > 417 };
  });
}

function hideShotTooltip() {
  selectedShotIdx = null;
  document.getElementById('shot-tooltip').classList.remove('show');
}

function resetAll() {
  activeShots.forEach((e) => {
    scene.remove(e.ball); e.ball.geometry.dispose();
    scene.remove(e.trailMesh); e.trailGeo.dispose(); e.trailMat.dispose();
    scene.remove(e.ballLight);
  });
  activeShots = [];
  while (dotGroup.children.length) {
    const c = dotGroup.children[0];
    dotGroup.remove(c);
    if (c.geometry) c.geometry.dispose();
  }
  splashEffects.forEach(ef => {
    if (ef.type === 'made') {
      scene.remove(ef.mesh); ef.mesh.geometry.dispose(); ef.mat.dispose();
    } else {
      scene.remove(ef.ball); ef.ball.geometry.dispose(); ef.ballMat.dispose();
      scene.remove(ef.ripple); ef.ripple.geometry.dispose(); ef.ripMat.dispose();
    }
  });
  splashEffects.length = 0;
  firedSet.clear();
  madeCount = 0; missCount = 0;
  zoneCounts = { paint: [0,0], mid: [0,0], three: [0,0] };
  document.getElementById('statMadeN').textContent = '0';
  document.getElementById('statMissN').textContent = '0';
  document.getElementById('statPct').textContent = '—';
  document.getElementById('statPaintPct').textContent = '—';
  document.getElementById('statMidPct').textContent   = '—';
  document.getElementById('statThreePct').textContent = '—';
  shotQueue = [...filteredIndices()];
  queueTimer = 0;
  hideShotTooltip();
}

function fireShotAt(idx, instant = false) {
  firedSet.add(idx);
  const s = shots[idx];

  if (s.heave) {
    if (s.made) madeCount++; else missCount++;
    updateZoneStats(s.zone, s.made);
    refreshStats();
    return;
  }

  if (instant) {
    placeFloorMarker(s);
    if (s.made) madeCount++; else missCount++;
    updateZoneStats(s.zone, s.made);
    refreshStats();
    return;
  }

  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.36, 16, 16),
    (s.made ? MAT_MADE : MAT_MISS).clone()
  );
  ball.castShadow = true;
  scene.add(ball);

  // Floor marker placed immediately (not deferred to landing)
  let dotDot, dotRing = null;
  if (s.made) {
    dotDot = new THREE.Mesh(new THREE.CircleGeometry(0.16, 28), MAT_DOT_MADE_FILL);
    dotDot.rotation.x = -Math.PI / 2;
    dotDot.position.set(s.floor.x, 0.14, s.floor.z);
    dotGroup.add(dotDot);
    dotRing = new THREE.Mesh(new THREE.RingGeometry(0.26, 0.42, 36), MAT_DOT_MADE_RING);
    dotRing.rotation.x = -Math.PI / 2;
    dotRing.position.set(s.floor.x, 0.14, s.floor.z);
    dotGroup.add(dotRing);
  } else {
    dotDot = makeMissCross(s.floor.x, s.floor.z);
    dotGroup.add(dotDot);
  }

  const TRAIL_COLOR = s.made ? 0x3ddc6a : 0xe04444;
  const ribPositions = new Float32Array(TRAIL_LEN * 2 * 3);
  const ribAlphas    = new Float32Array(TRAIL_LEN * 2);
  const ribIndices   = new Uint16Array((TRAIL_LEN - 1) * 6);
  for (let i = 0; i < TRAIL_LEN - 1; i++) {
    const v = i * 2, t = i * 6;
    ribIndices[t]=v; ribIndices[t+1]=v+1; ribIndices[t+2]=v+2;
    ribIndices[t+3]=v+1; ribIndices[t+4]=v+3; ribIndices[t+5]=v+2;
  }
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(ribPositions, 3));
  trailGeo.setAttribute('aAlpha',   new THREE.BufferAttribute(ribAlphas, 1));
  trailGeo.setIndex(new THREE.BufferAttribute(ribIndices, 1));
  trailGeo.setDrawRange(0, 0);
  const trailMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(TRAIL_COLOR) } },
    vertexShader: `attribute float aAlpha; varying float vAlpha;
      void main() { vAlpha = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uColor; varying float vAlpha;
      void main() { gl_FragColor = vec4(uColor, vAlpha); }`,
    transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const trailMesh = new THREE.Mesh(trailGeo, trailMat);
  scene.add(trailMesh);

  const ballLight = new THREE.PointLight(s.made ? 0x3ddc6a : 0xe04444, 2.8, 14, 1.8);
  scene.add(ballLight);

  activeShots.push({
    idx, ball,
    origin: s.origin.clone(), end: s.end.clone(), maxH: s.maxH,
    made: s.made, zone: s.zone,
    t: 0, duration: SHOT_DURATION_BASE, done: false,
    trailGeo, trailMat, trailMesh, ballLight,
    trailHistory: [], dotDot, dotRing,
  });
}

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------
let lastTime = null;
const progressBarEl   = document.getElementById('progress-bar');
const progressThumbEl = document.getElementById('progress-thumb');

let cameraTween       = null;
let cameraTweenActive = false;
const _tweenScratchCam = new THREE.PerspectiveCamera();

function tick(now) {
  requestAnimationFrame(tick);
  const dt = lastTime == null ? 0 : Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  if (cameraTween) {
    cameraTween.t += dt;
    const p = Math.min(cameraTween.t / cameraTween.dur, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    camera.position.lerpVectors(cameraTween.fromPos, cameraTween.toPos, eased);
    controls.target.lerpVectors(cameraTween.fromTar, cameraTween.toTar, eased);
    camera.quaternion.slerpQuaternions(cameraTween.fromQuat, cameraTween.toQuat, eased);
    if (p >= 1) {
      camera.position.copy(cameraTween.toPos);
      controls.target.copy(cameraTween.toTar);
      cameraTween = null;
      cameraTweenActive = false;
      controls.enabled = true;
    }
  } else {
    controls.update();
  }

  if (playing) {
    queueTimer -= dt * speed;
    if (queueTimer <= 0 && shotQueue.length > 0) {
      fireShotAt(shotQueue.shift());
      queueTimer = INTER_GAP_BASE;
    }
  }

  for (const s of activeShots) {
    if (s.done) continue;
    s.t += (dt * speed) / s.duration;
    if (s.t >= 1) {
      s.t = 1;
      s.done = true;
      if (s.made) madeCount++; else missCount++;
      refreshStats();
      updateZoneStats(s.zone, s.made);
      if (s.made) {
        if (filters.result.has('made')) {
          triggerCrowdJump();
          addMadeSplash(s.idx);
          triggerNetSwish();
        }
      } else {
        if (filters.result.has('miss')) {
          addMissBounce(s.end, s.idx);
          const dxz = Math.hypot(s.end.x, s.end.z - HOOP_Z);
          triggerRimShake(0.5 + Math.max(0, 1 - dxz / 2.0));
        }
      }
      scene.remove(s.ball);
      scene.remove(s.trailMesh); s.trailGeo.dispose(); s.trailMat.dispose();
      scene.remove(s.ballLight);
      continue;
    }
    s.ball.position.copy(parabola(s.origin, s.end, s.maxH, s.t));
    s.ballLight.position.copy(s.ball.position);

    s.trailHistory.push(s.ball.position.clone());
    if (s.trailHistory.length > TRAIL_LEN) s.trailHistory.shift();
    const n = s.trailHistory.length;

    if (n >= 2) {
      const camFwd = new THREE.Vector3();
      camera.getWorldDirection(camFwd);
      const MAX_HALF_W = 0.30;
      const posArr   = s.trailGeo.attributes.position.array;
      const alphaArr = s.trailGeo.attributes.aAlpha.array;
      for (let i = 0; i < n; i++) {
        const p     = s.trailHistory[i];
        const frac  = i / (n - 1);
        const iNext = Math.min(i + 1, n - 1);
        const iPrev = Math.max(i - 1, 0);
        const tangent = new THREE.Vector3().subVectors(s.trailHistory[iNext], s.trailHistory[iPrev]).normalize();
        const perp = new THREE.Vector3().crossVectors(camFwd, tangent);
        if (perp.lengthSq() < 1e-6) perp.crossVectors(camera.up, tangent);
        perp.normalize();
        const hw = frac * MAX_HALF_W;
        const vi = i * 2;
        posArr[vi*3]   = p.x + perp.x*hw; posArr[vi*3+1]   = p.y + perp.y*hw; posArr[vi*3+2]   = p.z + perp.z*hw;
        posArr[vi*3+3] = p.x - perp.x*hw; posArr[vi*3+4] = p.y - perp.y*hw; posArr[vi*3+5] = p.z - perp.z*hw;
        const a = frac * 0.88;
        alphaArr[vi] = a; alphaArr[vi+1] = a;
      }
      s.trailGeo.setDrawRange(0, (n - 1) * 6);
      s.trailGeo.attributes.position.needsUpdate = true;
      s.trailGeo.attributes.aAlpha.needsUpdate   = true;
    }
  }

  tickCrowdWaves(dt);
  tickSplashEffects(dt, scene);
  updateBasketEffects(dt);
  updateShotTooltipPosition();

  if (playing && shots.length > 0 && shotQueue.length === 0 && activeShots.every((s) => s.done)) {
    playing = false;
    sequenceDone = true;
    setPlayButton('replay');
  }

  const totalFiltered = firedSet.size + shotQueue.length;
  if (totalFiltered > 0) {
    const pct = Math.min(100, (firedSet.size / totalFiltered) * 100);
    progressBarEl.style.width  = pct + '%';
    progressThumbEl.style.left = pct + '%';
  } else {
    progressBarEl.style.width  = '0%';
    progressThumbEl.style.left = '0%';
  }

  renderer.render(scene, camera);
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------
const btnPlay        = document.getElementById('btnPlay');
const helpBubbleEl   = document.getElementById('help-bubble');
const helpPopoverEl  = document.getElementById('help-popover');
const helpTipEl      = document.getElementById('help-tip');
const helpTipCloseEl = helpTipEl.querySelector('.help-tip-x');
const helpPopoverCloseEl = helpPopoverEl.querySelector('.help-close');
const HELP_TIP_KEY   = 'shotchart-help-tip-seen-v1';

function safeGetStorageItem(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSetStorageItem(key, value) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

function openHelp() {
  helpPopoverEl.hidden = false;
  requestAnimationFrame(() => helpPopoverEl.classList.add('open'));
  helpBubbleEl.setAttribute('aria-expanded', 'true');
}
function closeHelp() {
  helpPopoverEl.classList.remove('open');
  helpBubbleEl.setAttribute('aria-expanded', 'false');
  setTimeout(() => {
    if (!helpPopoverEl.classList.contains('open')) helpPopoverEl.hidden = true;
  }, 180);
}
function hideHelpTip(markSeen = true) {
  if (markSeen) safeSetStorageItem(HELP_TIP_KEY, '1');
  helpTipEl.classList.remove('show');
  setTimeout(() => {
    if (!helpTipEl.classList.contains('show')) helpTipEl.hidden = true;
  }, 180);
}
function showHelpTip() {
  if (safeGetStorageItem(HELP_TIP_KEY) === '1') return;
  helpTipEl.hidden = false;
  requestAnimationFrame(() => helpTipEl.classList.add('show'));
  setTimeout(() => { if (!helpTipEl.hidden) hideHelpTip(true); }, 8000);
}

helpBubbleEl.addEventListener('click', () => {
  if (helpPopoverEl.hidden) openHelp(); else closeHelp();
});
helpPopoverCloseEl.addEventListener('click', closeHelp);
helpTipCloseEl.addEventListener('click', () => hideHelpTip(true));
helpTipEl.addEventListener('click', (e) => {
  if (e.target === helpTipCloseEl) return;
  hideHelpTip(true);
  openHelp();
});

function setPlayButton(state) {
  if (state === 'disabled') { btnPlay.disabled = true; btnPlay.textContent = '▶ Play'; return; }
  btnPlay.disabled = false;
  if (state === 'play')   btnPlay.textContent = '▶ Play';
  if (state === 'pause')  btnPlay.textContent = '⏸ Pause';
  if (state === 'replay') btnPlay.textContent = '↺ Replay';
}

btnPlay.addEventListener('click', () => {
  if (!currentPlayer) return;
  if (sequenceDone || (!playing && shotQueue.length === 0)) {
    resetAll();
    sequenceDone = false;
    playing = true;
    setPlayButton('pause');
    return;
  }
  playing = !playing;
  setPlayButton(playing ? 'pause' : 'play');
});

document.getElementById('btnReplay').addEventListener('click', () => {
  if (!currentPlayer) return;
  resetAll();
  sequenceDone = false;
  playing = true;
  setPlayButton('pause');
});

// Speed
const speedSelectEl = document.getElementById('speed-select');
document.querySelectorAll('#speed-pills .pill-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#speed-pills .pill-btn').forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-checked', 'false');
    });
    btn.classList.add('active');
    btn.setAttribute('aria-checked', 'true');
    speed = parseFloat(btn.dataset.speed);
    speedSelectEl.value = btn.dataset.speed;
  });
});
speedSelectEl.addEventListener('change', (e) => {
  const btn = document.querySelector(`#speed-pills .pill-btn[data-speed="${e.target.value}"]`);
  if (btn) btn.click();
});

// Camera presets
const CAMERA_PRESETS = {
  broadcast: { pos: new THREE.Vector3(0,  22, -82),         target: new THREE.Vector3(0, 4, HOOP_Z) },
  sideline:  { pos: new THREE.Vector3(70, 36,  HOOP_Z),     target: new THREE.Vector3(0, 6, HOOP_Z) },
  top:       { pos: new THREE.Vector3(0,  72,  HOOP_Z + 5), target: new THREE.Vector3(0, 0, -18) },
};

function setCameraMode(mode) {
  document.querySelectorAll('#camera-pills .pill-btn').forEach(b => {
    const on = b.dataset.cam === mode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
  });
  const cameraSelectEl = document.getElementById('camera-select');
  if (cameraSelectEl) cameraSelectEl.value = mode;
  if (mode === 'pan') {
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1;
    cameraTween = null;
    cameraTweenActive = false;
    return;
  }
  controls.autoRotate = false;
  if (mode === 'free') { cameraTween = null; cameraTweenActive = false; return; }
  const p = CAMERA_PRESETS[mode];
  if (!p) return;
  _tweenScratchCam.position.copy(p.pos);
  _tweenScratchCam.up.copy(camera.up);
  _tweenScratchCam.lookAt(p.target);
  // Drain accumulated sphericalDelta/panOffset before disabling controls.
  // Without damping, update() applies the full delta in one step and zeros it.
  // This happens before the tween starts so no visible jump occurs.
  controls.enableDamping = false;
  controls.update();
  controls.enableDamping = true;
  controls.enabled = false;
  cameraTween = {
    fromPos: camera.position.clone(), toPos: p.pos.clone(),
    fromTar: controls.target.clone(), toTar: p.target.clone(),
    fromQuat: camera.quaternion.clone(), toQuat: _tweenScratchCam.quaternion.clone(),
    t: 0, dur: 0.9,
  };
  cameraTweenActive = true;
}

document.querySelectorAll('#camera-pills .pill-btn').forEach(b => {
  b.addEventListener('click', () => setCameraMode(b.dataset.cam));
});
document.getElementById('camera-select').addEventListener('change', (e) => {
  setCameraMode(e.target.value);
});
controls.addEventListener('start', () => {
  if (cameraTweenActive) return;
  const active = document.querySelector('#camera-pills .pill-btn.active');
  if (active && active.dataset.cam !== 'free') setCameraMode('free');
});

// Seek
function seekTo(fraction) {
  if (!shots.length) return;
  const filtered = filteredIndices();
  if (filtered.length === 0) return;
  const wasPlaying = playing;
  playing = false;
  resetAll();
  const targetCount = Math.max(0, Math.min(filtered.length, Math.floor(fraction * filtered.length)));
  for (let k = 0; k < targetCount; k++) fireShotAt(filtered[k], true);
  shotQueue = filtered.slice(targetCount);
  sequenceDone = false;
  if (shotQueue.length > 0) {
    playing = wasPlaying;
    setPlayButton(playing ? 'pause' : 'play');
  } else {
    playing = false;
    setPlayButton('replay');
  }
}

function currentSeekFraction() {
  const total = firedSet.size + shotQueue.length;
  return total > 0 ? firedSet.size / total : 0;
}

// Progress bar scrubbing
{
  const track = document.getElementById('progress-track');
  const isDesktop = () => window.matchMedia('(min-width: 721px)').matches;
  let dragging = false;

  function fractionFromEvent(e) {
    const rect = track.getBoundingClientRect();
    const x = (e.touches?.[0]?.clientX ?? e.clientX) - rect.left;
    return Math.max(0, Math.min(1, x / rect.width));
  }

  track.addEventListener('mousedown', (e) => {
    if (!isDesktop() || !currentPlayer || shots.length === 0) return;
    e.preventDefault();
    dragging = true;
    track.classList.add('dragging');
    seekTo(fractionFromEvent(e));
  });
  window.addEventListener('mousemove', (e) => { if (dragging) seekTo(fractionFromEvent(e)); });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    track.classList.remove('dragging');
  });
  track.addEventListener('touchstart', (e) => {
    if (!currentPlayer || shots.length === 0) return;
    e.preventDefault();
    dragging = true;
    seekTo(fractionFromEvent(e));
  }, { passive: false });
  window.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    e.preventDefault();
    seekTo(fractionFromEvent(e));
  }, { passive: false });
  window.addEventListener('touchend', () => { if (dragging) dragging = false; });
}

function rebuildQueue() {
  shotQueue = filteredIndices().filter((i) => !firedSet.has(i));
}

function refreshStats() {
  const total = madeCount + missCount;
  document.getElementById('statMadeN').textContent = madeCount;
  document.getElementById('statMissN').textContent = missCount;
  document.getElementById('statPct').textContent = total > 0 ? Math.round(madeCount / total * 100) + '%' : '—';
  const pct = (c) => c[1] > 0 ? Math.round(c[0] / c[1] * 100) + '%' : '—';
  document.getElementById('statPaintPct').textContent = pct(zoneCounts.paint);
  document.getElementById('statMidPct').textContent   = pct(zoneCounts.mid);
  document.getElementById('statThreePct').textContent = pct(zoneCounts.three);
}

function restartAnimation() {
  if (!currentPlayer || shots.length === 0) return;
  fadeCanvas(true);
  setTimeout(() => {
    resetAll();
    sequenceDone = false;
    if (shotQueue.length === 0) {
      playing = false;
      setPlayButton('replay');
    } else {
      playing = true;
      setPlayButton('pause');
    }
    fadeCanvas(false);
  }, 160);
}

// ---------------------------------------------------------------------------
// Filter panel
// ---------------------------------------------------------------------------
const filterPanel     = document.getElementById('filter-panel');
const filterTriggerSec = document.getElementById('filter-trigger-sec');

function filtersEqual(a, b) {
  return ['result', 'type', 'zone', 'period'].every(k =>
    a[k].size === b[k].size && [...a[k]].every(v => b[k].has(v))
  );
}

function copyFiltersInto(dst, src) {
  dst.result = new Set(src.result);
  dst.type   = new Set(src.type);
  dst.zone   = new Set(src.zone);
  dst.period = new Set(src.period);
}

function syncPillsToPending() {
  document.querySelectorAll('#filter-panel .pill-btn').forEach(btn => {
    const group = btn.parentElement.dataset.filterGroup;
    let on = false;
    if (group === 'result') {
      const key = btn.dataset.result;
      on = pendingFilters.result.has(key);
      btn.classList.toggle('active-made', on && key === 'made');
      btn.classList.toggle('active-miss', on && key === 'miss');
    } else if (group === 'type')   on = pendingFilters.type.has(btn.dataset.type);
    else if (group === 'zone')   on = pendingFilters.zone.has(btn.dataset.zone);
    else if (group === 'period') on = pendingFilters.period.has(parseInt(btn.dataset.period, 10));
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  updateConflictingPills();
}

function updateApplyState() {
  const changed = !filtersEqual(filters, pendingFilters);
  const empty = pendingFilters.result.size === 0 || pendingFilters.type.size === 0 ||
                pendingFilters.zone.size === 0 || pendingFilters.period.size === 0;
  document.getElementById('filter-apply').disabled = !changed || empty;
  filterTriggerSec.classList.toggle('pending', changed);
  document.getElementById('filter-warning').classList.toggle('show', empty);
}

filterTriggerSec.addEventListener('click', (e) => {
  e.stopPropagation();
  const isOpening = !filterPanel.classList.contains('open');
  filterPanel.classList.toggle('open');
  if (isOpening) {
    copyFiltersInto(pendingFilters, filters);
    syncPillsToPending();
    updateApplyState();
  }
});
document.addEventListener('click', (e) => {
  if (!filterPanel.contains(e.target) && !filterTriggerSec.contains(e.target)) {
    filterPanel.classList.remove('open');
  }
});

function updateConflictingPills() {
  const t = pendingFilters.type;
  const z = pendingFilters.zone;
  const twoOnly   = t.has('2PT') && !t.has('3PT');
  const threeOnly = t.has('3PT') && !t.has('2PT');

  const disableMap = new Map([
    [['data-zone', 'three'], twoOnly],
    [['data-zone', 'paint'], threeOnly],
    [['data-zone', 'mid'],   threeOnly],
  ]);

  for (const [[attr, val], disabled] of disableMap) {
    const btn = document.querySelector(`#filter-panel [${attr}="${val}"]`);
    if (!btn) continue;
    btn.classList.toggle('disabled', disabled);
    btn.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    if (disabled && btn.classList.contains('active')) {
      btn.classList.remove('active');
      btn.setAttribute('aria-pressed', 'false');
      pendingFilters.zone.delete(val);
    }
  }
}

filterPanel.addEventListener('click', (e) => {
  const btn = e.target.closest('.pill-btn');
  if (!btn || btn.classList.contains('disabled')) return;
  const group = btn.parentElement.dataset.filterGroup;
  if (!group) return;
  const isActive = btn.classList.toggle('active');
  btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  if (group === 'result') {
    const key = btn.dataset.result;
    if (isActive) pendingFilters.result.add(key); else pendingFilters.result.delete(key);
    if (key === 'made') btn.classList.toggle('active-made', isActive);
    if (key === 'miss') btn.classList.toggle('active-miss', isActive);
  } else if (group === 'type') {
    const key = btn.dataset.type;
    if (isActive) pendingFilters.type.add(key); else pendingFilters.type.delete(key);
  } else if (group === 'zone') {
    const key = btn.dataset.zone;
    if (isActive) pendingFilters.zone.add(key); else pendingFilters.zone.delete(key);
  } else if (group === 'period') {
    const key = parseInt(btn.dataset.period, 10);
    if (isActive) pendingFilters.period.add(key); else pendingFilters.period.delete(key);
  }
  updateConflictingPills();
  updateApplyState();
});

const isMobileViewport = () =>
  window.matchMedia('(max-width: 720px), (max-height: 500px) and (orientation: landscape)').matches;

document.getElementById('filter-apply').addEventListener('click', (e) => {
  e.stopPropagation();
  if (document.getElementById('filter-apply').disabled) return;
  copyFiltersInto(filters, pendingFilters);
  refreshFilterSummary();
  updateApplyState();
  restartAnimation();
  if (isMobileViewport()) filterPanel.classList.remove('open');
});

document.getElementById('filter-reset').addEventListener('click', (e) => {
  e.stopPropagation();
  const defaults = DEFAULT_FILTERS();
  copyFiltersInto(pendingFilters, defaults);
  syncPillsToPending();
  if (!filtersEqual(filters, defaults)) {
    copyFiltersInto(filters, defaults);
    refreshFilterSummary();
    restartAnimation();
  }
  updateApplyState();
  if (isMobileViewport()) filterPanel.classList.remove('open');
});

function refreshFilterSummary() {
  const totalDims = 4;
  const fullDim = (d, full) => d.size === full ? 1 : 0;
  const allFull = fullDim(filters.result, 2) + fullDim(filters.type, 2) +
                  fullDim(filters.zone, 3) + fullDim(filters.period, 5);
  const summary = document.getElementById('filter-summary');
  const count   = document.getElementById('filter-count');
  const empty   = filters.result.size === 0 || filters.type.size === 0 ||
                  filters.zone.size === 0 || filters.period.size === 0;

  if (allFull === totalDims) {
    summary.textContent = 'All shots';
  } else {
    const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
    const labels = [];
    if (filters.result.size < 2) labels.push([...filters.result].map(cap).join('+'));
    if (filters.type.size < 2)   labels.push([...filters.type].join('+'));
    if (filters.zone.size < 3)   labels.push([...filters.zone].map(cap).join('+'));
    if (filters.period.size < 5) {
      const qs = [...filters.period].sort((a, b) => a - b).map(p => p === 5 ? 'OT' : `Q${p}`);
      labels.push(qs.join('+'));
    }
    summary.textContent = labels.length ? labels.join(' · ') : 'Custom';
  }
  const activeDims = totalDims - allFull;
  count.textContent = empty ? '!' : (activeDims === 0 ? '—' : `${activeDims}/4`);
  count.classList.toggle('warn', empty);
}

// ---------------------------------------------------------------------------
// Team color + player trigger
// ---------------------------------------------------------------------------
function applyTeamColor(hexColor, teamAbbr) {
  MAT_APRON.color.set(hexColor);
  const hex = '#' + hexColor.toString(16).padStart(6, '0');
  const r = (hexColor >> 16) & 0xff;
  const g = (hexColor >> 8) & 0xff;
  const b = hexColor & 0xff;
  const brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const minBrightness = 0.62;
  let tr = r, tg = g, tb = b;
  if (brightness < minBrightness) {
    const mix = (minBrightness - brightness) / (1 - brightness);
    tr = Math.round(r + (255 - r) * mix);
    tg = Math.round(g + (255 - g) * mix);
    tb = Math.round(b + (255 - b) * mix);
  }
  const hexText = '#' + tr.toString(16).padStart(2, '0') + tg.toString(16).padStart(2, '0') + tb.toString(16).padStart(2, '0');
  document.documentElement.style.setProperty('--accent', hex);
  document.documentElement.style.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);
  document.documentElement.style.setProperty('--accent-text', hexText);
  updateCrowdColors(hexColor, getTeamSecondary(teamAbbr, hexColor));
}

function setPlayerTrigger(player, loading = false) {
  const trig      = document.getElementById('player-trigger');
  const nameEl    = document.getElementById('player-trigger-name');
  const teamEl    = document.getElementById('player-trigger-team');
  const brandPlayer = document.getElementById('brand-player');
  if (loading) {
    trig.classList.add('loading');
    nameEl.textContent = player ? player.name : 'Loading…';
    return;
  }
  trig.classList.remove('loading');
  if (!player) {
    trig.classList.add('empty');
    nameEl.textContent = 'Select player';
    teamEl.style.display = 'none';
    brandPlayer.textContent = '';
    brandPlayer.classList.remove('visible');
    return;
  }
  trig.classList.remove('empty');
  nameEl.textContent = player.name;
  if (player.team) {
    teamEl.textContent = player.team;
    teamEl.style.display = 'inline-block';
  } else {
    teamEl.style.display = 'none';
  }
  brandPlayer.textContent = player.name + (player.team ? '  ·  ' + player.team : '');
  brandPlayer.classList.add('visible');
}

function fadeCanvas(on) {
  document.getElementById('transition-overlay').classList.toggle('show', on);
}

function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(resolve));
}

function resetFiltersToDefault() {
  const defaults = DEFAULT_FILTERS();
  copyFiltersInto(filters, defaults);
  copyFiltersInto(pendingFilters, defaults);
  syncPillsToPending();
  refreshFilterSummary();
  updateApplyState();
}

// ---------------------------------------------------------------------------
// Player loading
// ---------------------------------------------------------------------------
async function loadPlayer(player) {
  const token = ++playerLoadToken;
  applyTeamColor(player.color, player.team);
  setPlayerTrigger(player, true);
  setPlayButton('disabled');
  fadeCanvas(true);
  resetFiltersToDefault();
  await nextFrame();
  if (token !== playerLoadToken) return;

  try {
    if (!player.hasData) {
      currentPlayer = player;
      RAW_SHOTS = [];
      resetAll();
      setPlayerTrigger(player, false);
      setPlayButton('disabled');
      document.getElementById('stats').classList.remove('hidden');
      return;
    }

    let cached = shotCache.get(player.id);
    if (!cached) {
      try {
        const shotUrl = new URL(`../data/shots/${player.id}.js`, import.meta.url);
        shotUrl.searchParams.set('v', DATA_VERSION);
        const mod = await import(shotUrl.href);
        if (token !== playerLoadToken) return;
        cached = mod[`SHOTS_${player.id}`];
        shotCache.set(player.id, cached);
      } catch {
        cached = [];
      }
    }
    if (token !== playerLoadToken) return;

    currentPlayer = player;
    RAW_SHOTS = cached;
    prepareShots();
    resetAll();

    setPlayerTrigger(player, false);
    document.getElementById('stats').classList.remove('hidden');
    document.getElementById('progress-track').classList.add('show');

    playing = true;
    sequenceDone = false;
    setPlayButton('pause');
  } finally {
    if (token === playerLoadToken) setTimeout(() => fadeCanvas(false), 120);
  }
}

// ---------------------------------------------------------------------------
// Arena toggle
// ---------------------------------------------------------------------------
document.getElementById('chkArena').addEventListener('change', (e) => {
  if (GEO.arenaGroup) GEO.arenaGroup.visible = e.target.checked;
});

// ---------------------------------------------------------------------------
// Shot tooltip
// ---------------------------------------------------------------------------
const tooltipEl      = document.getElementById('shot-tooltip');
const _shotPickPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _shotPickRay   = new THREE.Raycaster();
const _shotPickNDC   = new THREE.Vector2();
const _shotPickHit   = new THREE.Vector3();
const _shotPickProj  = new THREE.Vector3();
let selectedShotIdx  = null;
let mouseDownPt      = null;

function periodLabel(p) { return p >= 5 ? 'OT' : `Q${p}`; }

function fillShotTooltip(idx) {
  const s = shots[idx];
  if (!s) return;
  const r = s.raw || {};
  const dist   = r.SHOT_DISTANCE != null ? `${r.SHOT_DISTANCE} ft` : '—';
  const per    = periodLabel(r.PERIOD || 1);
  const result = s.made ? 'Made' : 'Missed';
  const cls    = s.made ? 'tt-made' : 'tt-miss';
  const action = (r.ACTION_TYPE || 'Field Goal').replace(/\s+/g, ' ').trim();
  tooltipEl.innerHTML =
    `<div class="tt-head ${cls}">${result}</div>` +
    `<div class="tt-meta">${dist} · ${per}</div>` +
    `<div class="tt-action">${action}</div>`;
}

function showShotTooltip(idx) {
  selectedShotIdx = idx;
  fillShotTooltip(idx);
  tooltipEl.classList.add('show');
}

function updateShotTooltipPosition() {
  if (selectedShotIdx === null) return;
  const s = shots[selectedShotIdx];
  if (!s || !firedSet.has(selectedShotIdx) || !shotPassesFilters(s)) {
    hideShotTooltip();
    return;
  }
  _shotPickProj.set(s.floor.x, 0.2, s.floor.z).project(camera);
  if (_shotPickProj.z > 1 || _shotPickProj.z < -1) { hideShotTooltip(); return; }
  const x = (_shotPickProj.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-_shotPickProj.y * 0.5 + 0.5) * window.innerHeight;
  tooltipEl.style.left = `${x}px`;
  tooltipEl.style.top  = `${y}px`;
}

canvas.addEventListener('pointerdown', (e) => {
  mouseDownPt = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointerup', (e) => {
  if (!mouseDownPt) return;
  const dx = e.clientX - mouseDownPt.x;
  const dy = e.clientY - mouseDownPt.y;
  mouseDownPt = null;
  if (Math.hypot(dx, dy) > 4) return;
  if (document.getElementById('picker').classList.contains('visible')) return;
  const rect = canvas.getBoundingClientRect();
  _shotPickNDC.set(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1
  );
  _shotPickRay.setFromCamera(_shotPickNDC, camera);
  if (!_shotPickRay.ray.intersectPlane(_shotPickPlane, _shotPickHit)) {
    hideShotTooltip();
    return;
  }
  let bestIdx = -1, bestD2 = 0.8 * 0.8;
  for (const idx of firedSet) {
    const s = shots[idx];
    if (!s || s.heave || !shotPassesFilters(s)) continue;
    const ddx = s.floor.x - _shotPickHit.x;
    const ddz = s.floor.z - _shotPickHit.z;
    const d2 = ddx * ddx + ddz * ddz;
    if (d2 < bestD2) { bestD2 = d2; bestIdx = idx; }
  }
  if (bestIdx >= 0) showShotTooltip(bestIdx);
  else              hideShotTooltip();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Player trigger → picker
// ---------------------------------------------------------------------------
document.getElementById('player-trigger-sec').addEventListener('click', (e) => {
  e.stopPropagation();
  showPicker();
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !helpPopoverEl.hidden) { closeHelp(); return; }

  const tgt = e.target;
  const editable = tgt && (
    tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' ||
    tgt.tagName === 'SELECT' || tgt.isContentEditable
  );

  if (e.key === 'Escape' && currentPlayer) {
    const root = document.getElementById('picker');
    if (root.classList.contains('visible')) { picker.hide(); return; }
    if (selectedShotIdx !== null) { hideShotTooltip(); return; }
  }
  if (editable) return;

  if (document.getElementById('picker').classList.contains('visible')) return;
  if (!currentPlayer || shots.length === 0) return;

  if (e.code === 'Space') {
    e.preventDefault();
    document.getElementById('btnPlay').click();
  } else if (e.key === 'r' || e.key === 'R') {
    e.preventDefault();
    document.getElementById('btnReplay').click();
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    seekTo(Math.max(0, currentSeekFraction() - 0.05));
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    seekTo(Math.min(1, currentSeekFraction() + 0.05));
  }
});

// ---------------------------------------------------------------------------
// Player picker
// ---------------------------------------------------------------------------
const picker = (() => {
  const root    = document.getElementById('picker');
  const grid    = document.getElementById('picker-grid');
  const empty   = document.getElementById('picker-empty');
  const count   = document.getElementById('picker-count');
  const searchEl  = document.getElementById('picker-search');
  const teamEl    = document.getElementById('pf-team');
  const posEl     = document.getElementById('pf-pos');
  const heightEl  = document.getElementById('pf-height');
  const fgaEl     = document.getElementById('pf-fga');
  const fgpctEl   = document.getElementById('pf-fgpct');
  const ptsEl     = document.getElementById('pf-pts');
  const sortEl    = document.getElementById('pf-sort');
  let renderedOnce = false;
  let filterFrame  = 0;

  function addOption(select, value, text) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = text;
    select.appendChild(opt);
  }

  const teams = [...new Set(ROSTER.map(p => p.team).filter(Boolean))].sort();
  teamEl.replaceChildren();
  addOption(teamEl, '', 'All');
  teams.forEach(t => addOption(teamEl, t, t));

  function inchesToText(inches) {
    if (!inches) return '—';
    return `${Math.round(inches * 2.54)} cm`;
  }

  function rebuildHeightOptions() {
    const opts = [
      { v: '0',   t: 'All' },
      { v: '-72', t: '< 183 cm' },
      { v: '72',  t: '> 183 cm' },
      { v: '76',  t: '> 193 cm' },
      { v: '80',  t: '> 203 cm' },
      { v: '84',  t: '> 213 cm' },
    ];
    const prev = heightEl.value;
    heightEl.replaceChildren();
    opts.forEach(o => addOption(heightEl, o.v, o.t));
    if (prev) heightEl.value = prev;
  }

  function teamColor(p) { return '#' + (p.color || 0x445566).toString(16).padStart(6, '0'); }

  function normalizePositionLabel(playerPos) {
    if (!playerPos) return '';
    const p = String(playerPos).trim().toUpperCase();
    if (!p) return '';
    if (/^[GFC](?:-[GFC])?$/.test(p)) return p;
    const tokens = p.split(/[-/\s]+/).filter(Boolean);
    const mapped = [];
    for (const tok of tokens) {
      let m = '';
      if (tok.startsWith('GUARD')) m = 'G';
      else if (tok.startsWith('FORWARD')) m = 'F';
      else if (tok.startsWith('CENTER') || tok.startsWith('CENTRE')) m = 'C';
      else if (tok === 'G' || tok === 'F' || tok === 'C') m = tok;
      if (m && !mapped.includes(m)) mapped.push(m);
    }
    return mapped.length ? mapped.join('-') : p;
  }

  function posMatches(playerPos, filter) {
    if (!filter) return true;
    const pp = normalizePositionLabel(playerPos);
    if (!pp) return false;
    if (filter === 'G') return pp.includes('G');
    if (filter === 'F') return pp.includes('F');
    if (filter === 'C') return pp.includes('C');
    return true;
  }

  function applyFilters() {
    filterFrame = 0;
    const q        = searchEl.value.toLowerCase().trim();
    const team     = teamEl.value;
    const pos      = posEl.value;
    const hVal     = parseInt(heightEl.value, 10) || 0;
    const minFga   = parseInt(fgaEl.value, 10) || 0;
    const minFgPct = parseFloat(fgpctEl.value) || 0;
    const minPts   = parseInt(ptsEl.value, 10) || 0;
    const sortKey  = sortEl.value;

    let rows = ROSTER.filter(p => {
      if (q && !p.name.toLowerCase().includes(q)) return false;
      if (team && p.team !== team) return false;
      if (!posMatches(p.position, pos)) return false;
      if (hVal > 0 && (p.height_in || 0) < hVal) return false;
      if (hVal < 0 && (!p.height_in || p.height_in >= Math.abs(hVal))) return false;
      if (minFga && (p.fga || 0) < minFga) return false;
      if (minFgPct && (p.fg_pct || 0) < minFgPct) return false;
      if (minPts && (p.pts || 0) < minPts) return false;
      return true;
    });

    rows.sort((a, b) => {
      if (a.hasData !== b.hasData) return a.hasData ? -1 : 1;
      if (sortKey === 'name') return a.name.localeCompare(b.name);
      return (b[sortKey] || 0) - (a[sortKey] || 0);
    });

    render(rows);
  }

  function scheduleApplyFilters() {
    if (filterFrame) return;
    filterFrame = requestAnimationFrame(applyFilters);
  }

  function maxPickerHeight() {
    return window.innerHeight - (window.matchMedia('(max-width: 720px)').matches ? 20 : 80);
  }

  function measureNaturalPickerHeight(cardEl, pinnedHeight) {
    const prevTransition = cardEl.style.transition;
    cardEl.style.transition = 'none';
    cardEl.style.height = '';
    const naturalHeight = Math.min(cardEl.scrollHeight, maxPickerHeight());
    cardEl.style.height = pinnedHeight;
    cardEl.style.transition = prevTransition;
    return naturalHeight;
  }

  function render(rows) {
    const cardEl = document.getElementById('picker-card');
    const animateHeight = renderedOnce && root.classList.contains('visible');
    const fromHeight = animateHeight ? cardEl.getBoundingClientRect().height : 0;
    const pinnedHeight = `${fromHeight}px`;

    if (animateHeight) {
      cardEl.style.transition = 'none';
      cardEl.style.height = pinnedHeight;
    }

    grid.replaceChildren();
    if (rows.length === 0) {
      empty.classList.add('show');
      count.textContent = '';
    } else {
      empty.classList.remove('show');
      count.textContent = `${rows.length} player${rows.length === 1 ? '' : 's'}`;
    }

    const frag = document.createDocumentFragment();
    rows.forEach((p, i) => {
      const card = document.createElement('div');
      card.className = 'pp-card' + (p.hasData ? '' : ' no-data');
      card.style.animationDelay = Math.min(i, 22) * 20 + 'ms';
      const fgPctText = p.fg_pct ? (p.fg_pct * 100).toFixed(1) + '%' : '—';

      const teamRow = document.createElement('div');
      teamRow.className = 'pp-card-team-row';
      const dot = document.createElement('span');
      dot.className = 'pp-team-dot';
      dot.style.background = teamColor(p);
      const abbr = document.createElement('span');
      abbr.className = 'pp-team-abbr';
      abbr.textContent = p.team || '—';
      const posTag = document.createElement('span');
      posTag.className = 'pp-pos-tag';
      posTag.textContent = `${normalizePositionLabel(p.position) || 'No position'} | ${p.height_in ? inchesToText(p.height_in) : 'No height'}`;
      teamRow.append(dot, abbr, posTag);

      const name = document.createElement('div');
      name.className = 'pp-card-name';
      name.textContent = p.name;

      const stats = document.createElement('div');
      stats.className = 'pp-card-stats';
      [[p.pts || 0, 'PTS'], [p.fga || 0, 'FGA'], [fgPctText, 'FG%']].forEach(([value, label]) => {
        const stat = document.createElement('div');
        stat.className = 'pp-stat';
        const val = document.createElement('span');
        val.className = 'pp-stat-v';
        val.textContent = value;
        const lbl = document.createElement('span');
        lbl.className = 'pp-stat-l';
        lbl.textContent = label;
        stat.append(val, lbl);
        stats.appendChild(stat);
      });

      card.append(teamRow, name, stats);
      card.addEventListener('click', () => {
        if (!p.hasData) return;
        hide();
        requestAnimationFrame(() => loadPlayer(p));
      });
      frag.appendChild(card);
    });
    grid.appendChild(frag);
    renderedOnce = true;

    if (animateHeight) {
      const toHeight = measureNaturalPickerHeight(cardEl, pinnedHeight);
      if (Math.abs(toHeight - fromHeight) > 4) {
        cardEl.style.height = pinnedHeight;
        void cardEl.offsetHeight;
        cardEl.style.transition = 'height 0.24s cubic-bezier(0.4, 0, 0.2, 1)';
        cardEl.style.height = `${toHeight}px`;
        clearTimeout(cardEl._hTimer);
        cardEl._hTimer = setTimeout(() => {
          cardEl.style.transition = '';
          cardEl.style.height = `${Math.min(cardEl.scrollHeight, maxPickerHeight())}px`;
        }, 280);
      } else {
        cardEl.style.transition = '';
        cardEl.style.height = `${toHeight}px`;
      }
    }
  }

  function show() {
    root.classList.remove('hidden');
    void root.offsetHeight;
    root.classList.add('visible');
    if (!renderedOnce && !filterFrame) {
      filterFrame = requestAnimationFrame(() => {
        filterFrame = requestAnimationFrame(applyFilters);
      });
    }
    setTimeout(() => searchEl.focus(), 200);
  }

  function hide() {
    root.classList.remove('visible');
    setTimeout(() => root.classList.add('hidden'), 380);
  }

  root.addEventListener('click', (e) => {
    if (e.target === root && currentPlayer) hide();
  });

  rebuildHeightOptions();

  [searchEl, teamEl, posEl, heightEl, fgaEl, fgpctEl, ptsEl, sortEl].forEach(el => {
    el.addEventListener('input', scheduleApplyFilters);
    el.addEventListener('change', scheduleApplyFilters);
  });

  searchEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') searchEl.blur();
    if (e.key === 'Enter') {
      const first = grid.querySelector('.pp-card:not(.no-data)');
      if (first) first.click();
    }
  });

  const filtersEl     = document.getElementById('picker-filters');
  const filtersToggle = document.getElementById('picker-filters-toggle');
  if (filtersToggle && filtersEl) {
    const STORAGE_KEY = 'picker-show-more';
    let showMore = false;
    try { showMore = sessionStorage.getItem(STORAGE_KEY) === '1'; } catch {}
    const applyShowMore = () => {
      filtersEl.classList.toggle('show-more', showMore);
      filtersToggle.setAttribute('aria-expanded', showMore ? 'true' : 'false');
      filtersToggle.textContent = showMore ? 'Fewer filters ▴' : 'More filters ▾';
    };
    filtersToggle.addEventListener('click', () => {
      showMore = !showMore;
      try { sessionStorage.setItem(STORAGE_KEY, showMore ? '1' : '0'); } catch {}
      applyShowMore();
    });
    applyShowMore();
  }

  return { show, hide };
})();

function showPicker() { picker.show(); }

// ---------------------------------------------------------------------------
// Mobile progress bar docking
// ---------------------------------------------------------------------------
(function setupMobileProgressDock() {
  const stats = document.getElementById('stats');
  const track = document.getElementById('progress-track');
  if (!stats || !track) return;
  const mobileMQ = window.matchMedia('(max-width: 720px), (max-height: 500px) and (orientation: landscape)');
  const parentForDesktop = track.parentElement;
  const apply = () => {
    if (mobileMQ.matches) {
      if (track.parentElement !== stats) stats.insertBefore(track, stats.firstChild);
    } else {
      if (track.parentElement !== parentForDesktop && parentForDesktop) {
        parentForDesktop.appendChild(track);
      }
    }
  };
  apply();
  mobileMQ.addEventListener?.('change', apply);
})();

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
try {
  buildCourt();
  build3PointArc();
  buildBasket();
  shotQueue = [];
  requestAnimationFrame(tick);
  refreshFilterSummary();
  setPlayButton('disabled');
  picker.show();
  showHelpTip();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      try {
        buildArena();
        if (GEO.arenaGroup) GEO.arenaGroup.visible = document.getElementById('chkArena').checked;
      } catch (e) {
        window.onerror(e.message + '\n' + e.stack, '', 0);
      }
    });
  });
} catch (e) {
  window.onerror(e.message + '\n' + e.stack, '', 0);
}
