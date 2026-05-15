import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HOOP_Z } from './constants.js';

const canvas = document.getElementById('canvas');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
} catch {
  document.body.innerHTML = '<p style="color:#fff;padding:2rem">WebGL not supported.</p>';
  throw new Error('WebGL unavailable');
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 2.2;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1018);
scene.fog = new THREE.Fog(0x0d1018, 80, 155);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 300);
camera.position.set(0, 22, -82);
camera.lookAt(0, 4, HOOP_Z);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 4, HOOP_Z);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 10;
controls.maxDistance = 90;
controls.maxPolarAngle = Math.PI / 2 - 0.04;

scene.add(new THREE.HemisphereLight(0xfff8f0, 0x10183a, 1.4));

function addSpot(x, y, z, intensity, tx, tz) {
  const spot = new THREE.SpotLight(0xfff8e0, intensity, 90, Math.PI / 7, 0.42, 1.1);
  spot.position.set(x, y, z);
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.bias = -0.001;
  spot.target.position.set(tx ?? x, 0, tz ?? z);
  scene.add(spot, spot.target);
}
addSpot(-16, 40,  -6, 6.0,  -3, -18);
addSpot( 16, 40,  -6, 6.0,   3, -18);
addSpot(-16, 40, -40, 5.5,  -3, -30);
addSpot( 16, 40, -40, 5.5,   3, -30);
addSpot(-14, 38, -24, 4.8,   0, -24);
addSpot( 14, 38, -24, 4.8,   0, -24);

const basketFill = new THREE.PointLight(0xffeedd, 2.8, 32, 1.5);
basketFill.position.set(0, 20, HOOP_Z);
scene.add(basketFill);

const fillDir = new THREE.DirectionalLight(0xd0e8ff, 0.9);
fillDir.position.set(0, 30, -50);
fillDir.target.position.set(0, 0, -23.5);
scene.add(fillDir, fillDir.target);

export { renderer, scene, camera, controls };
