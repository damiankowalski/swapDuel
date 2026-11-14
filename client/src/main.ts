// Swap Duel client: rendering, input and HUD. Training runs the shared simulation locally; online play goes through
// the authoritative game server (client/src/net.ts): the local fighter is predicted, the opponent interpolated, and
// the camera - which is the opponent's eyes - filtered so network jitter does not shake the screen.
import * as THREE from 'three';
import { createBot, respawnBot, stepBot, type BotState } from '../../shared/bot.ts';
import {
  ARENA_HALF,
  CRATE_HALF,
  CRATE_HEIGHT,
  FIRE_INTERVAL,
  HIT_COOLDOWN,
  MAX_FRAME_DT,
  SPAWN_GUEST,
  SPAWN_HOST,
  WALL_HEIGHT,
  WALL_THICKNESS,
} from '../../shared/constants.ts';
import { lagFromParams } from '../../shared/lag.ts';
import { aimDirection, type Vec3 } from '../../shared/math.ts';
import { AngleFilter, CAMERA_POSITION_FILTER, CAMERA_YAW_FILTER, OneEuroFilter } from '../../shared/one-euro.ts';
import { stepPlayer, type PlayerState } from '../../shared/player.ts';
import {
  KEY_BACK,
  KEY_FIRE,
  KEY_FORWARD,
  KEY_LEFT,
  KEY_RIGHT,
  KEY_TURN_LEFT,
  KEY_TURN_RIGHT,
  TICK_DT,
  type EndReason,
  type GameEvent,
  type Pose,
  type RejectReason,
} from '../../shared/protocol.ts';
import { parseRoomCode } from '../../shared/room-code.ts';
import { castShot, eyeOf, muzzleOf } from '../../shared/shot.ts';
import { fetchStatus, OnlineSession } from './net.ts';

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

const rng = Math.random;
const toThree = (v: Vec3) => new THREE.Vector3(v.x, v.y, v.z);
const params = new URLSearchParams(location.search);
/** Simulated network conditions, development builds only: ?lag=150&jitter=30&stall=0.02 */
const lag = import.meta.env.DEV ? lagFromParams((k) => params.get(k)) : null;
const showNetStats = import.meta.env.DEV && (params.has('debug') || lag !== null);

const REJECT_TEXT: Record<RejectReason, string> = {
  busy: 'A match is in progress — try again in a few minutes.',
  full: 'That game is already full.',
  bad_code: 'No game with that code.',
  version: 'A new version is available — reload the page.',
  timeout: 'The connection timed out — try again.',
  protocol: 'The server refused the connection.',
};
const END_TEXT: Record<EndReason, string> = {
  opponent_left: 'Your opponent left the match.',
  time_limit: 'Time is up: matches last at most 20 minutes.',
  idle: 'You were idle for too long.',
  room_expired: 'Nobody joined in time. Create a new game to try again.',
  server_shutdown: 'The server is restarting. Try again in a moment.',
};

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
/** Training mode: the local fighter and the bot, simulated here. */
const a: PlayerState = { pos: { x: SPAWN_HOST.x, z: SPAWN_HOST.z }, yaw: SPAWN_HOST.yaw, pitch: 0 };
let b: BotState = createBot({ x: SPAWN_GUEST.x, z: SPAWN_GUEST.z }, SPAWN_GUEST.yaw);

/** What is drawn this frame (both modes). */
const view = { me: { x: a.pos.x, z: a.pos.z, yaw: a.yaw } as Pose, opp: { x: b.pos.x, z: b.pos.z, yaw: b.lookYaw } as Pose };

type ViewMode = 'enemy' | 'self';
let viewMode: ViewMode = 'enemy'; // 'enemy' = through the opponent's eyes (default)
let mode: 'online' | 'bot' | null = null;

let session: OnlineSession | null = null;
let tickAcc = 0;
let localFireCd = 0;
const camYaw = new AngleFilter(CAMERA_YAW_FILTER);
const camX = new OneEuroFilter(CAMERA_POSITION_FILTER);
const camZ = new OneEuroFilter(CAMERA_POSITION_FILTER);

// score (training only; online the server keeps it)
let myScore = 0;
let oppScore = 0;
let hitCooldown = 0;
let fireCd = 0;

// ---------- Input ----------
const keys: Record<string, boolean> = Object.create(null);
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  keys[e.code] = true;
  if (['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
  if (e.code === 'KeyV') toggleView();
});
addEventListener('keyup', (e) => {
  keys[e.code] = false;
});
addEventListener('blur', () => {
  for (const k of Object.keys(keys)) keys[k] = false;
});

function keyMask(): number {
  if (!playing) return 0;
  let k = 0;
  if (keys['KeyW']) k |= KEY_FORWARD;
  if (keys['KeyS']) k |= KEY_BACK;
  if (keys['KeyA']) k |= KEY_LEFT;
  if (keys['KeyD']) k |= KEY_RIGHT;
  if (keys['ArrowLeft']) k |= KEY_TURN_LEFT;
  if (keys['ArrowRight']) k |= KEY_TURN_RIGHT;
  if (keys['Space']) k |= KEY_FIRE;
  return k;
}

const startEl = byId('start');
let playing = false;
startEl.addEventListener('click', () => {
  playing = true;
  startEl.classList.add('hidden');
});

function toggleView(): void {
  viewMode = viewMode === 'enemy' ? 'self' : 'enemy';
}

// ---------- Lobby ----------
const btnHost = byId<HTMLButtonElement>('btnHost');
const btnJoin = byId<HTMLButtonElement>('btnJoin');

function setStatus(id: string, text: string): void {
  byId(id).textContent = text;
}

function showPanel(id: 'choice' | 'hostPanel' | 'joinPanel'): void {
  for (const p of ['choice', 'hostPanel', 'joinPanel']) byId(p).classList.toggle('hidden', p !== id);
}

async function refreshServerStatus(): Promise<void> {
  if (byId('lobby').classList.contains('hidden')) return;
  const status = await fetchStatus();
  if (!status) {
    btnHost.disabled = true;
    btnJoin.disabled = true;
    setStatus('serverStatus', 'Online play is not available here. Training works offline.');
  } else {
    btnHost.disabled = status.state === 'busy';
    btnJoin.disabled = false;
    setStatus('serverStatus', status.state === 'busy' ? REJECT_TEXT.busy + ' (You can still join with a code.)' : '');
  }
}
void refreshServerStatus();
setInterval(() => void refreshServerStatus(), 5000);

function backToLobby(message = ''): void {
  session?.leave();
  session = null;
  mode = null;
  playing = false;
  startEl.classList.add('hidden');
  byId('netStats').classList.add('hidden');
  byId('lobby').classList.remove('hidden');
  showPanel('choice');
  setStatus('serverStatus', message);
  void refreshServerStatus().then(() => {
    if (message) setStatus('serverStatus', message);
  });
}

async function openSession(panel: 'hostStatus' | 'joinStatus'): Promise<OnlineSession | null> {
  setStatus(panel, 'Connecting...');
  const s = new OnlineSession(
    {
      onRoom: (code, seat) => {
        if (seat === 0) {
          byId('hostCode').textContent = code;
          setStatus('hostStatus', 'Waiting for a player...');
        } else setStatus('joinStatus', 'Joined!');
      },
      onStart: (you, opp) => startOnline(you, opp),
      onSnapshot: (score, events) => onSnapshot(score, events),
      onReject: (reason) => {
        setStatus(panel, REJECT_TEXT[reason]);
        if (reason !== 'bad_code') {
          s.leave();
          if (session === s) session = null;
        }
      },
      onEnd: (reason) => backToLobby(END_TEXT[reason]),
      onClosed: () => backToLobby('Connection to the server lost.'),
    },
    lag,
  );
  session = s;
  if (!(await s.connect())) {
    if (session === s) session = null;
    setStatus(panel, 'Could not reach the game server.');
    return null;
  }
  return s;
}

btnHost.onclick = async () => {
  showPanel('hostPanel');
  byId('hostCode').textContent = '—';
  const s = await openSession('hostStatus');
  if (s) {
    setStatus('hostStatus', 'Creating room...');
    s.create();
  }
};
btnJoin.onclick = () => {
  showPanel('joinPanel');
  byId<HTMLInputElement>('joinCode').focus();
};
byId('doJoin').onclick = async () => {
  const code = parseRoomCode(byId<HTMLInputElement>('joinCode').value || '');
  if (!code) {
    setStatus('joinStatus', 'Enter the 5-character code.');
    return;
  }
  const s = session ?? (await openSession('joinStatus'));
  if (s) {
    setStatus('joinStatus', 'Joining...');
    s.join(code);
  }
};
byId('btnBot').onclick = () => startBot();
document.querySelectorAll<HTMLElement>('[data-back]').forEach((el) => (el.onclick = () => backToLobby()));

// ---------- Starting a match ----------
function enterGame(status: string): void {
  myScore = 0;
  oppScore = 0;
  updateScoreboard();
  byId('modeStatus').innerHTML = status;
  byId('lobby').classList.add('hidden');
  startEl.classList.remove('hidden');
}

function startBot(): void {
  mode = 'bot';
  a.pos = { x: SPAWN_HOST.x, z: SPAWN_HOST.z };
  a.yaw = SPAWN_HOST.yaw;
  b = createBot({ x: SPAWN_GUEST.x, z: SPAWN_GUEST.z }, SPAWN_GUEST.yaw);
  enterGame('Training vs bot — <span class="you">blue</span> is you, you see through <span class="enemy">red</span>\'s eyes.');
}

function startOnline(you: Pose, opp: Pose): void {
  mode = 'online';
  tickAcc = 0;
  localFireCd = 0;
  view.me = { ...you };
  view.opp = { ...opp };
  camYaw.reset();
  camX.reset();
  camZ.reset();
  if (showNetStats) byId('netStats').classList.remove('hidden');
  enterGame('Online — you steer <span class="you">blue</span>, you see through <span class="enemy">red</span>\'s eyes.');
}

function updateScoreboard(): void {
  byId('myScore').textContent = String(myScore);
  byId('oppScore').textContent = String(oppScore);
}

// ---------- Effects ----------
const hitmark = byId('hitmark');
const flashEl = byId('flash');
function flashHit(): void {
  flashEl.classList.add('on');
  setTimeout(() => flashEl.classList.remove('on'), 160);
}
function showHitmark(): void {
  hitmark.classList.add('on');
  setTimeout(() => hitmark.classList.remove('on'), 120);
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

function onSnapshot(score: [number, number], events: GameEvent[]): void {
  [myScore, oppScore] = score;
  updateScoreboard();
  for (const e of events) {
    if (e.k === 'shot' && e.by === 'opp') tracer(new THREE.Vector3(...e.from), new THREE.Vector3(...e.to));
    else if (e.k === 'hit') {
      if (e.by === 'you') showHitmark();
      else flashHit();
    }
  }
}

// ---------- Training mode ----------
function shootTraining(): void {
  const shot = castShot(eyeOf(a.pos), aimDirection(a.yaw, a.pitch), b.pos);
  tracer(toThree(muzzleOf(a.pos, a.yaw)), toThree(shot.point));
  if (shot.hit === 'target' && hitCooldown <= 0) {
    hitCooldown = HIT_COOLDOWN;
    myScore++;
    updateScoreboard();
    showHitmark();
    respawnBot(b, rng);
  }
}

function updateTraining(dt: number): void {
  if (playing) {
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
    hitCooldown -= dt;
    if (keys['Space']) {
      fireCd -= dt;
      if (fireCd <= 0) {
        shootTraining();
        fireCd = FIRE_INTERVAL;
      }
    } else fireCd = 0;
  }
  stepBot(b, dt, rng);
  view.me = { x: a.pos.x, z: a.pos.z, yaw: a.yaw };
  view.opp = { x: b.pos.x, z: b.pos.z, yaw: b.lookYaw };
}

// ---------- Online mode ----------
function updateOnline(dt: number, s: OnlineSession): void {
  tickAcc += dt;
  while (tickAcc >= TICK_DT) {
    tickAcc -= TICK_DT;
    const k = keyMask();
    s.tick(k);
    // Draw our own tracer at once; the server decides hits and score.
    if (k & KEY_FIRE) {
      localFireCd -= TICK_DT;
      if (localFireCd <= 0 && s.predictor) {
        localFireCd = FIRE_INTERVAL;
        const me = s.predictor.state;
        const shot = castShot(eyeOf(me.pos), aimDirection(me.yaw, 0), view.opp);
        tracer(toThree(muzzleOf(me.pos, me.yaw)), toThree(shot.point));
      }
    } else localFireCd = 0;
  }
  if (s.predictor) view.me = s.predictor.render(tickAcc / TICK_DT, dt);
  const sample = s.interp.sample(performance.now() / 1000);
  if (sample) {
    if (sample.cut) {
      camYaw.reset();
      camX.reset();
      camZ.reset();
    }
    view.opp = sample.pose;
  }
  if (showNetStats) {
    const st = s.stats;
    byId('netStats').textContent =
      `rtt ${st.rttMs.toFixed(0)} ms   delay ${st.delayMs.toFixed(0)} ms   jitter ${st.jitterMs.toFixed(0)} ms\n` +
      `starvations ${st.starvations}   corrections ${st.corrections} (last ${st.lastCorrection.toFixed(2)} m)` +
      (lag ? `\nsimulated: ${lag.delayMs} ms +- ${lag.jitterMs} ms, stalls ${lag.stallChance}` : '');
  }
}

// ---------- Rendering ----------
function placeMeshes(): void {
  meshA.position.set(view.me.x, 0, view.me.z);
  meshA.rotation.y = view.me.yaw;
  meshB.position.set(view.opp.x, 0, view.opp.z);
  meshB.rotation.y = view.opp.yaw;
}

function updateCamera(dt: number): void {
  if (viewMode === 'enemy') {
    // The camera is the opponent: online it is filtered so network jitter does not shake the screen.
    const filtered = mode === 'online';
    const x = filtered ? camX.filter(view.opp.x, dt) : view.opp.x;
    const z = filtered ? camZ.filter(view.opp.z, dt) : view.opp.z;
    const yaw = filtered ? camYaw.filter(view.opp.yaw, dt) : view.opp.yaw;
    camera.position.set(x, eyeOf(view.opp).y, z);
    camera.rotation.set(0, yaw, 0, 'YXZ'); // you see where the opponent looks
    meshA.visible = true;
    meshB.visible = false;
  } else {
    camera.position.set(view.me.x, eyeOf(view.me).y, view.me.z);
    camera.rotation.set(0, view.me.yaw, 0, 'YXZ');
    meshA.visible = false;
    meshB.visible = true;
  }
}

const reticle = byId('reticle');
const aimRay = new THREE.Raycaster();
function updateReticle(): void {
  const origin = toThree(eyeOf(view.me));
  const dir = toThree(aimDirection(view.me.yaw, 0));
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

  if (mode === 'online' && session) updateOnline(dt, session);
  else if (mode === 'bot') updateTraining(dt);

  placeMeshes();
  updateCamera(dt);
  updateReticle();
  renderer.render(scene, camera);
}
placeMeshes();
animate();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
