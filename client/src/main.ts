// Swap Duel client: rendering, input, HUD and the temporary P2P online mode (PeerJS, replaced in P2).
// Movement, collisions, the bot and hit detection come from shared/, so the server and tests use the same rules.
import { Peer, type DataConnection } from 'peerjs';
import * as THREE from 'three';
import { randomSpawnPoint } from '../../shared/arena.ts';
import { createBot, respawnBot, stepBot, type BotState } from '../../shared/bot.ts';
import {
  ARENA_HALF,
  CRATE_HALF,
  CRATE_HEIGHT,
  FIRE_INTERVAL,
  HIT_COOLDOWN,
  MAX_FRAME_DT,
  SEND_INTERVAL,
  SPAWN_GUEST,
  SPAWN_HOST,
  WALL_HEIGHT,
  WALL_THICKNESS,
} from '../../shared/constants.ts';
import { aimDirection, approachAngle, lerpInPlace, type Vec2, type Vec3 } from '../../shared/math.ts';
import { parsePeerMessage, type PeerMessage } from '../../shared/p2p-protocol.ts';
import { stepPlayer, type PlayerState } from '../../shared/player.ts';
import { createRoomCode, parseRoomCode } from '../../shared/room-code.ts';
import { castShot, eyeOf, muzzleOf } from '../../shared/shot.ts';

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

const rng = Math.random;
const randomInt = (max: number): number => {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0]! % max;
};
const toThree = (v: Vec3) => new THREE.Vector3(v.x, v.y, v.z);
/** Remote peers' smoothing rate for position and yaw (1/s). */
const REMOTE_SMOOTHING = 12;
/** Peer IDs on the public PeerJS broker. */
const PEER_PREFIX = 'swapduel-';

// ---------- Scene / renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f16);
scene.fog = new THREE.Fog(0x0b0f16, 18, 42);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 200);

scene.add(new THREE.HemisphereLight(0x9fc4ff, 0x20242c, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(6, 12, 4);
scene.add(sun);

// ---------- Arena ----------
/** Walls and the crate: the reticle sticks to their surfaces. */
const aimSolids: THREE.Object3D[] = [];
function buildArena(): void {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2),
    new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const grid = new THREE.GridHelper(ARENA_HALF * 2, 20, 0x3d4653, 0x333b45);
  grid.position.y = 0.02;
  scene.add(grid);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x323b4a, roughness: 0.9 });
  const mkWall = (w: number, d: number, x: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_HEIGHT, d), wallMat);
    m.position.set(x, WALL_HEIGHT / 2, z);
    scene.add(m);
    aimSolids.push(m);
  };
  const S = ARENA_HALF * 2;
  const t = WALL_THICKNESS;
  mkWall(S + t, t, 0, ARENA_HALF);
  mkWall(S + t, t, 0, -ARENA_HALF);
  mkWall(t, S + t, ARENA_HALF, 0);
  mkWall(t, S + t, -ARENA_HALF, 0);

  const crate = new THREE.Mesh(
    new THREE.BoxGeometry(CRATE_HALF * 2, CRATE_HEIGHT, CRATE_HALF * 2),
    new THREE.MeshStandardMaterial({ color: 0xcaa23c, roughness: 0.6, metalness: 0.1 }),
  );
  crate.position.set(0, CRATE_HEIGHT / 2, 0);
  scene.add(crate);
  aimSolids.push(crate);
}
buildArena();

// ---------- Fighters ----------
function makeFighter(hex: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 0.9, 6, 12), mat);
  body.position.y = 0.9;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), mat);
  head.position.y = 1.75;
  g.add(head);
  const gun = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 0.9, 8),
    new THREE.MeshStandardMaterial({ color: 0x11151b, roughness: 0.4 }),
  );
  gun.rotation.x = Math.PI / 2;
  gun.position.set(0, 1.5, -0.6);
  g.add(gun);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), new THREE.MeshBasicMaterial({ color: hex }));
  eye.position.set(0, 1.78, -0.28);
  g.add(eye);
  scene.add(g);
  return g;
}
const meshA = makeFighter(0x4da3ff); // you (local)
const meshB = makeFighter(0xff5a5a); // opponent (remote or bot)

// ---------- State ----------
const a: PlayerState = { pos: { x: SPAWN_HOST.x, z: SPAWN_HOST.z }, yaw: SPAWN_HOST.yaw, pitch: 0 };
let b: BotState = createBot({ x: SPAWN_GUEST.x, z: SPAWN_GUEST.z }, SPAWN_GUEST.yaw);
placeMeshes();

type ViewMode = 'enemy' | 'self';
let viewMode: ViewMode = 'enemy'; // 'enemy' = through the opponent's eyes (default)
let mode: 'online' | 'bot' | null = null;
let online = false;

// network
let peer: Peer | null = null;
let conn: DataConnection | null = null;
const netPos: Vec2 = { x: SPAWN_GUEST.x, z: SPAWN_GUEST.z };
let netYaw: number = SPAWN_GUEST.yaw;

// score
let myScore = 0;
let oppScore = 0;
let hitCooldown = 0; // brief immunity against counting one burst as several hits
let sendAcc = 0;
let fireCd = 0;

function placeMeshes(): void {
  meshA.position.set(a.pos.x, 0, a.pos.z);
  meshA.rotation.y = a.yaw;
  meshB.position.set(b.pos.x, 0, b.pos.z);
  meshB.rotation.y = b.lookYaw;
}

// ---------- Input ----------
const keys: Record<string, boolean> = Object.create(null);
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
  if (e.code === 'KeyV') toggleView();
});
addEventListener('keyup', (e) => {
  keys[e.code] = false;
});

const startEl = byId('start');
let playing = false;
startEl.addEventListener('click', () => {
  playing = true;
  startEl.classList.add('hidden');
});

function toggleView(): void {
  viewMode = viewMode === 'enemy' ? 'self' : 'enemy';
}

// ---------- Network (PeerJS) ----------
function netSend(msg: PeerMessage): void {
  if (conn && conn.open) conn.send(msg);
}

function handleData(raw: unknown): void {
  const msg = parsePeerMessage(raw);
  if (!msg) return;
  if (msg.t === 's') {
    netPos.x = msg.x;
    netPos.z = msg.z;
    netYaw = msg.y;
  } else if (msg.t === 'shot') {
    tracer(new THREE.Vector3(msg.ox, msg.oy, msg.oz), new THREE.Vector3(msg.ex, msg.ey, msg.ez));
  } else if (msg.t === 'hit') {
    // We were hit.
    oppScore++;
    updateScoreboard();
    flashHit();
    a.pos = randomSpawnPoint(rng); // respawn at a random point
  }
}

function hostGame(): void {
  showPanel('hostPanel');
  const code = createRoomCode(randomInt);
  byId('hostCode').textContent = code.toUpperCase();
  setStatus('hostStatus', 'Creating room...');
  peer = new Peer(PEER_PREFIX + code);
  peer.on('open', () => setStatus('hostStatus', 'Waiting for a player...'));
  peer.on('error', (e) => setStatus('hostStatus', 'Error: ' + e.type));
  peer.on('connection', (c) => {
    conn = c;
    c.on('open', () => {
      setStatus('hostStatus', 'Connected!');
      startMode('online', true);
    });
    c.on('data', handleData);
    c.on('close', () => setStatus('hostStatus', 'Disconnected.'));
  });
}

function joinGame(): void {
  const code = parseRoomCode(byId<HTMLInputElement>('joinCode').value || '');
  if (!code) {
    setStatus('joinStatus', 'Enter the 5-character code.');
    return;
  }
  setStatus('joinStatus', 'Connecting...');
  const p = new Peer();
  peer = p;
  p.on('open', () => {
    const c = p.connect(PEER_PREFIX + code);
    conn = c;
    c.on('open', () => {
      setStatus('joinStatus', 'Connected!');
      startMode('online', false);
    });
    c.on('data', handleData);
    c.on('error', () => setStatus('joinStatus', 'Connection error.'));
    c.on('close', () => setStatus('joinStatus', 'Disconnected.'));
  });
  p.on('error', (e) => setStatus('joinStatus', 'Error: ' + e.type + ' (wrong code?)'));
}

function setStatus(id: string, text: string): void {
  byId(id).textContent = text;
}

function showPanel(id: string): void {
  byId('choice').classList.add('hidden');
  byId('hostPanel').classList.add('hidden');
  byId('joinPanel').classList.add('hidden');
  byId(id).classList.remove('hidden');
}

function backToChoice(): void {
  if (peer) {
    try {
      peer.destroy();
    } catch {
      // already closed
    }
  }
  peer = null;
  conn = null;
  byId('hostPanel').classList.add('hidden');
  byId('joinPanel').classList.add('hidden');
  byId('choice').classList.remove('hidden');
}

byId('btnHost').onclick = hostGame;
byId('btnJoin').onclick = () => showPanel('joinPanel');
byId('btnBot').onclick = () => startMode('bot', false);
byId('doJoin').onclick = joinGame;
document.querySelectorAll<HTMLElement>('[data-back]').forEach((el) => (el.onclick = backToChoice));

// ---------- Starting a match ----------
function startMode(m: 'online' | 'bot', host: boolean): void {
  mode = m;
  online = m === 'online';
  myScore = 0;
  oppScore = 0;
  updateScoreboard();

  const mine = online && !host ? SPAWN_GUEST : SPAWN_HOST;
  const theirs = online && !host ? SPAWN_HOST : SPAWN_GUEST;
  a.pos = { x: mine.x, z: mine.z };
  a.yaw = mine.yaw;
  b = createBot({ x: theirs.x, z: theirs.z }, theirs.yaw);

  if (online) {
    netPos.x = b.pos.x;
    netPos.z = b.pos.z;
    netYaw = b.lookYaw;
    byId('modeStatus').innerHTML =
      'Online — you steer <span class="you">blue</span>, you see through <span class="enemy">red</span>\'s eyes.';
  } else {
    byId('modeStatus').innerHTML =
      'Training vs bot — <span class="you">blue</span> is you, you see through <span class="enemy">red</span>\'s eyes.';
  }
  placeMeshes();

  byId('lobby').classList.add('hidden');
  startEl.classList.remove('hidden');
}

function updateScoreboard(): void {
  byId('myScore').textContent = String(myScore);
  byId('oppScore').textContent = String(oppScore);
}

// ---------- Shooting ----------
const hitmark = byId('hitmark');
const flashEl = byId('flash');
function flashHit(): void {
  flashEl.classList.add('on');
  setTimeout(() => flashEl.classList.remove('on'), 160);
}

function shoot(): void {
  const shot = castShot(eyeOf(a.pos), aimDirection(a.yaw, a.pitch), b.pos);
  const muzzle = muzzleOf(a.pos, a.yaw);
  tracer(toThree(muzzle), toThree(shot.point));
  if (online) {
    netSend({ t: 'shot', ox: muzzle.x, oy: muzzle.y, oz: muzzle.z, ex: shot.point.x, ey: shot.point.y, ez: shot.point.z });
  }

  if (shot.hit === 'target' && hitCooldown <= 0) {
    hitCooldown = HIT_COOLDOWN;
    myScore++;
    updateScoreboard();
    hitmark.classList.add('on');
    setTimeout(() => hitmark.classList.remove('on'), 120);
    if (online) netSend({ t: 'hit' }); // the victim respawns itself
    else respawnBot(b, rng);
  }
}

const tracerMat = new THREE.LineBasicMaterial({ color: 0xffe08a });
function tracer(from: THREE.Vector3, to: THREE.Vector3): void {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const line = new THREE.Line(geo, tracerMat);
  scene.add(line);
  setTimeout(() => {
    scene.remove(line);
    geo.dispose();
  }, 90);
}

// ---------- Update ----------
function updatePlayer(dt: number): void {
  stepPlayer(
    a,
    {
      forward: !!keys['KeyW'],
      back: !!keys['KeyS'],
      left: !!keys['KeyA'],
      right: !!keys['KeyD'],
      turnLeft: !!keys['ArrowLeft'],
      turnRight: !!keys['ArrowRight'],
    },
    dt,
  );
}

function updateCamera(): void {
  if (viewMode === 'enemy') {
    camera.position.set(b.pos.x, eyeOf(b.pos).y, b.pos.z);
    camera.rotation.set(0, b.lookYaw, 0, 'YXZ'); // you see where the opponent looks
    meshA.visible = true;
    meshB.visible = false;
  } else {
    camera.position.set(a.pos.x, eyeOf(a.pos).y, a.pos.z);
    camera.rotation.set(0, a.yaw, 0, 'YXZ');
    meshA.visible = false;
    meshB.visible = true;
  }
}

const reticle = byId('reticle');
const aimRay = new THREE.Raycaster();
function updateReticle(): void {
  const origin = toThree(eyeOf(a.pos));
  const dir = toThree(aimDirection(a.yaw, a.pitch));
  aimRay.set(origin, dir);
  const hit = aimRay.intersectObjects(aimSolids, false)[0];
  const point = hit ? hit.point.clone() : origin.clone().add(dir.multiplyScalar(50));
  const p = point.project(camera);
  if (p.z > 1 || p.z < -1) {
    reticle.style.display = 'none';
    return;
  }
  reticle.style.display = 'block';
  reticle.style.left = (p.x * 0.5 + 0.5) * innerWidth + 'px';
  reticle.style.top = (-p.y * 0.5 + 0.5) * innerHeight + 'px';
}

const clock = new THREE.Clock();
function animate(): void {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), MAX_FRAME_DT);

  if (playing) {
    updatePlayer(dt);
    hitCooldown -= dt;
    if (keys['Space']) {
      fireCd -= dt;
      if (fireCd <= 0) {
        shoot();
        fireCd = FIRE_INTERVAL;
      }
    } else fireCd = 0;
  }

  if (online) {
    lerpInPlace(b.pos, netPos, Math.min(1, dt * REMOTE_SMOOTHING));
    b.lookYaw = approachAngle(b.lookYaw, netYaw, dt * REMOTE_SMOOTHING);
    sendAcc += dt;
    if (sendAcc >= SEND_INTERVAL) {
      sendAcc = 0;
      netSend({ t: 's', x: a.pos.x, z: a.pos.z, y: a.yaw });
    }
  } else if (mode === 'bot') {
    stepBot(b, dt, rng);
  }

  placeMeshes();
  updateCamera();
  updateReticle();
  renderer.render(scene, camera);
}
animate();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
