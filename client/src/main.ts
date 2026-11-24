// Swap Duel client: rendering, input and HUD. Training runs the shared simulation locally; online play goes through
// the authoritative game server (client/src/net.ts): the local fighter is predicted, the opponent interpolated, and
// the camera - which is the opponent's eyes - filtered so network jitter does not shake the screen.
import * as THREE from 'three';
import { createBot, respawnBot, stepBot, type BotState } from '../../shared/bot.ts';
import {
  AMMO_INTERVAL,
  ARENA_HALF,
  COUNTDOWN,
  CRATE_HALF,
  CRATE_HEIGHT,
  MAX_FRAME_DT,
  SNOWBALL_LIFETIME,
  SNOWBALL_RADIUS,
  SPAWN_PROTECTION,
  SPAWN_GUEST,
  SPAWN_HOST,
  WALL_HEIGHT,
  WALL_THICKNESS,
  WIN_SCORE,
} from '../../shared/constants.ts';
import { randomSpawnPoint } from '../../shared/arena.ts';
import { lagFromParams } from '../../shared/lag.ts';
import type { Vec2, Vec3 } from '../../shared/math.ts';
import { AngleFilter, CAMERA_POSITION_FILTER, CAMERA_YAW_FILTER, OneEuroFilter } from '../../shared/one-euro.ts';
import { eyeOf, stepPlayer, type PlayerState } from '../../shared/player.ts';
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
import {
  createThrower,
  launch,
  positionAt,
  pressFire,
  secondsToNextSnowball,
  stepSnowball,
  tickThrower,
  type Snowball,
} from '../../shared/snowball.ts';
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
  room_expired: 'The game room closed: nobody joined in time, or no rematch was agreed.',
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
// A ring on the ground under your own fighter: easier to find yourself through the opponent's eyes.
const ring = new THREE.Mesh(
  new THREE.RingGeometry(0.62, 0.8, 40),
  new THREE.MeshBasicMaterial({ color: 0x4da3ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
);
ring.rotation.x = -Math.PI / 2;
ring.position.y = 0.03;
meshA.add(ring);
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
const camYaw = new AngleFilter(CAMERA_YAW_FILTER);
const camX = new OneEuroFilter(CAMERA_POSITION_FILTER);
const camZ = new OneEuroFilter(CAMERA_POSITION_FILTER);

// score and snowballs (training only; online the server keeps them)
let myScore = 0;
let oppScore = 0;
let thrower = createThrower();
let botThrower = createThrower();

// match flow (both modes)
/** performance.now() at which the countdown ends and play starts. */
let countdownEnd = 0;
let matchOver = false;
/** Until when (performance.now()) snowballs fly through you / the opponent after a respawn; they blink meanwhile. */
let myShieldUntil = 0;
let oppShieldUntil = 0;

/** Inputs count: the start screen was clicked, the countdown is over and nobody has won yet. */
function live(): boolean {
  return playing && !matchOver && performance.now() >= countdownEnd;
}

// ---------- Input ----------
const keys: Record<string, boolean> = Object.create(null);
/** A fire press is latched until the next simulation step uses it, so a quick tap between two steps still throws. */
let firePressed = false;
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  keys[e.code] = true;
  if (e.code === 'Space' && !e.repeat) firePressed = true;
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
  if (!live()) return 0;
  let k = 0;
  if (keys['KeyW']) k |= KEY_FORWARD;
  if (keys['KeyS']) k |= KEY_BACK;
  if (keys['KeyA']) k |= KEY_LEFT;
  if (keys['KeyD']) k |= KEY_RIGHT;
  if (keys['ArrowLeft']) k |= KEY_TURN_LEFT;
  if (keys['ArrowRight']) k |= KEY_TURN_RIGHT;
  if (keys['Space'] || firePressed) k |= KEY_FIRE;
  return k;
}

/** Fire state for one simulation step; consumes a latched press. */
function takeFire(): boolean {
  const fire = !!keys['Space'] || firePressed;
  firePressed = false;
  return fire;
}

const startEl = byId('start');
let playing = false;
startEl.addEventListener('click', () => {
  playing = true;
  firePressed = false;
  // Training counts down from the click; online the server's countdown is already running.
  if (mode === 'bot') countdownEnd = performance.now() + COUNTDOWN * 1000;
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
  matchOver = false;
  clearBalls();
  startEl.classList.add('hidden');
  byId('over').classList.add('hidden');
  byId('countdown').classList.add('hidden');
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
      onStart: (you, opp, go) => startOnline(you, opp, go),
      onOver: (score, winner) => showOver(score, winner),
      onRematchWanted: () => setStatus('overStatus', 'Your opponent wants a rematch!'),
      onSnapshot: (tick, score, events) => onSnapshot(tick, score, events),
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
  matchOver = false;
  myShieldUntil = 0;
  oppShieldUntil = 0;
  updateScoreboard();
  byId('modeStatus').innerHTML = status;
  byId('lobby').classList.add('hidden');
  byId('over').classList.add('hidden');
  // A rematch goes straight to the countdown; the first match waits for a click on the start screen.
  if (!playing) startEl.classList.remove('hidden');
}

// ---------- Match over and rematch ----------
function showOver(score: [number, number], winner: 'you' | 'opp'): void {
  matchOver = true;
  [myScore, oppScore] = score;
  updateScoreboard();
  byId('overTitle').textContent = winner === 'you' ? 'You win!' : 'You lose';
  byId('overMine').textContent = String(score[0]);
  byId('overTheirs').textContent = String(score[1]);
  setStatus('overStatus', mode === 'online' ? 'Both players must ask for a rematch.' : '');
  const rematch = byId<HTMLButtonElement>('btnRematch');
  rematch.disabled = false;
  byId('over').classList.remove('hidden');
}

byId('btnRematch').onclick = () => {
  if (mode === 'bot') {
    startBot();
    countdownEnd = performance.now() + COUNTDOWN * 1000;
    return;
  }
  session?.rematch();
  byId<HTMLButtonElement>('btnRematch').disabled = true;
  setStatus('overStatus', 'Waiting for your opponent...');
};
byId('btnMenu').onclick = () => backToLobby();

function updateCountdown(): void {
  const el = byId('countdown');
  const left = countdownEnd - performance.now();
  if (!playing || matchOver || left < -700) {
    el.classList.add('hidden');
    return;
  }
  el.textContent = left > 0 ? String(Math.ceil(left / 1000)) : 'GO!';
  el.classList.remove('hidden');
}

function startBot(): void {
  mode = 'bot';
  thrower = createThrower();
  botThrower = createThrower();
  countdownEnd = Infinity; // starts at the click on the start screen
  clearBalls();
  a.pos = { x: SPAWN_HOST.x, z: SPAWN_HOST.z };
  a.yaw = SPAWN_HOST.yaw;
  b = createBot({ x: SPAWN_GUEST.x, z: SPAWN_GUEST.z }, SPAWN_GUEST.yaw);
  enterGame('Training vs bot — <span class="you">blue</span> is you, you see through <span class="enemy">red</span>\'s eyes.');
}

function startOnline(you: Pose, opp: Pose, go: number): void {
  mode = 'online';
  countdownEnd = performance.now() + go * 1000;
  tickAcc = 0;
  clearBalls();
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

// ---------- Snowballs on screen ----------
const ballGeo = new THREE.SphereGeometry(SNOWBALL_RADIUS, 14, 10);
const ballMat = new THREE.MeshStandardMaterial({ color: 0xf2f7ff, roughness: 0.8 });
const puffMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });

/** Our own snowballs (training, or predicted online): simulated here, visual only online. */
interface LocalBall {
  ball: Snowball;
  mesh: THREE.Mesh;
  /** Thrown by us, or by the training bot. */
  byBot: boolean;
}
/** The opponent's snowballs, drawn on the same delayed clock as the opponent. */
interface RemoteBall {
  id: number;
  from: Vec3;
  vel: Vec3;
  tick: number;
  splatTick: number | null;
  splatAt: Vec3 | null;
  mesh: THREE.Mesh;
}
let localBalls: LocalBall[] = [];
let remoteBalls: RemoteBall[] = [];

function ballMesh(): THREE.Mesh {
  const m = new THREE.Mesh(ballGeo, ballMat);
  scene.add(m);
  return m;
}

function removeMesh(m: THREE.Mesh): void {
  scene.remove(m);
}

function clearBalls(): void {
  for (const b of localBalls) removeMesh(b.mesh);
  for (const b of remoteBalls) removeMesh(b.mesh);
  localBalls = [];
  remoteBalls = [];
}

function puff(at: Vec3): void {
  const m = new THREE.Mesh(ballGeo, puffMat.clone());
  m.position.set(at.x, at.y, at.z);
  scene.add(m);
  const started = performance.now();
  const grow = () => {
    const k = (performance.now() - started) / 220;
    if (k >= 1) {
      scene.remove(m);
      (m.material as THREE.Material).dispose();
      return;
    }
    m.scale.setScalar(1 + k * 3);
    (m.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
    requestAnimationFrame(grow);
  };
  grow();
}

function throwLocal(from: Vec2, yaw: number, byBot = false): void {
  const start = launch(from, yaw);
  localBalls.push({ ball: { id: 0, owner: byBot ? 1 : 0, pos: start.pos, vel: start.vel, age: 0 }, mesh: ballMesh(), byBot });
}

/**
 * Moves the locally simulated snowballs. Ours fly at `opp` (the opponent as drawn), the bot's at `me`; a target that
 * is null (or shielded) is not hit. Returns which side landed a hit this frame.
 */
function updateLocalBalls(dt: number, opp: Vec2 | null, me: Vec2 | null): { mine: boolean; bots: boolean } {
  const hits = { mine: false, bots: false };
  localBalls = localBalls.filter((b) => {
    const target = b.byBot ? me : opp;
    const impact = stepSnowball(b.ball, dt, target ? [{ seat: b.byBot ? 0 : 1, pos: target }] : []);
    if (!impact) {
      b.mesh.position.set(b.ball.pos.x, b.ball.pos.y, b.ball.pos.z);
      return true;
    }
    if (impact.kind === 'target') {
      if (b.byBot) hits.bots = true;
      else hits.mine = true;
    }
    puff(impact.point);
    removeMesh(b.mesh);
    return false;
  });
  return hits;
}

function updateRemoteBalls(renderTick: number): void {
  remoteBalls = remoteBalls.filter((b) => {
    const t = (renderTick - b.tick + 1) * TICK_DT;
    if (b.splatTick !== null && renderTick >= b.splatTick) {
      if (b.splatAt) puff(b.splatAt);
      removeMesh(b.mesh);
      return false;
    }
    if (t > SNOWBALL_LIFETIME + 1) {
      removeMesh(b.mesh);
      return false;
    }
    b.mesh.visible = t >= 0;
    const p = positionAt(b.from, b.vel, Math.max(0, t));
    b.mesh.position.set(p.x, p.y, p.z);
    return true;
  });
}

function updateAmmoHud(ammo: number, next: number): void {
  byId('ammoCount').textContent = String(ammo);
  byId('ammoNext').textContent = next > 0 ? `+1 in ${Math.ceil(next)} s` : 'full';
  byId('ammoBar').style.width = `${Math.max(0, Math.min(1, 1 - next / AMMO_INTERVAL)) * 100}%`;
}

function onSnapshot(tick: number, score: [number, number], events: GameEvent[]): void {
  [myScore, oppScore] = score;
  updateScoreboard();
  for (const e of events) {
    if (e.k === 'throw' && e.by === 'opp') {
      const [fx, fy, fz] = e.from;
      const [vx, vy, vz] = e.vel;
      remoteBalls.push({
        id: e.id, from: { x: fx, y: fy, z: fz }, vel: { x: vx, y: vy, z: vz }, tick, splatTick: null, splatAt: null, mesh: ballMesh(),
      });
    } else if (e.k === 'splat') {
      const remote = remoteBalls.find((b) => b.id === e.id);
      if (remote) {
        remote.splatTick = tick;
        remote.splatAt = { x: e.at[0], y: e.at[1], z: e.at[2] };
      }
    } else if (e.k === 'hit') {
      if (e.by === 'you') showHitmark();
      else flashHit();
    } else if (e.k === 'spawn') {
      const now = performance.now();
      // The opponent is drawn on a delayed clock, so its blinking starts later too.
      if (e.who === 'you') myShieldUntil = now + SPAWN_PROTECTION * 1000;
      else oppShieldUntil = now + (SPAWN_PROTECTION + (session?.interp.delay ?? 0)) * 1000;
    }
  }
}

// ---------- Training mode ----------
function updateTraining(dt: number): void {
  if (matchOver) return;
  const now = performance.now();
  const started = now >= countdownEnd;
  if (live()) tickThrower(thrower, dt);
  if (live()) {
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
    if (pressFire(thrower, takeFire())) throwLocal(a.pos, a.yaw);
  }
  if (started) {
    const wantsThrow = stepBot(b, dt, rng, a.pos);
    if (live()) {
      tickThrower(botThrower, dt);
      if (pressFire(botThrower, wantsThrow)) throwLocal(b.pos, b.lookYaw, true);
    }
  }
  const hits = updateLocalBalls(dt, now < oppShieldUntil ? null : b.pos, now < myShieldUntil ? null : a.pos);
  if (hits.mine) {
    myScore++;
    showHitmark();
    respawnBot(b, rng);
    oppShieldUntil = now + SPAWN_PROTECTION * 1000;
  }
  if (hits.bots) {
    oppScore++;
    flashHit();
    a.pos = randomSpawnPoint(rng);
    myShieldUntil = now + SPAWN_PROTECTION * 1000;
  }
  if (hits.mine || hits.bots) {
    updateScoreboard();
    if (myScore >= WIN_SCORE || oppScore >= WIN_SCORE) showOver([myScore, oppScore], myScore >= WIN_SCORE ? 'you' : 'opp');
  }
  updateAmmoHud(thrower.ammo, secondsToNextSnowball(thrower));
  view.me = { x: a.pos.x, z: a.pos.z, yaw: a.yaw };
  view.opp = { x: b.pos.x, z: b.pos.z, yaw: b.lookYaw };
}

// ---------- Online mode ----------
function updateOnline(dt: number, s: OnlineSession): void {
  if (matchOver) return;
  tickAcc += dt;
  while (tickAcc >= TICK_DT) {
    tickAcc -= TICK_DT;
    // Our own snowball leaves the hand at once; the server decides hits and score.
    const k = keyMask();
    firePressed = false;
    if (s.tick(k, TICK_DT) && s.predictor) throwLocal(s.predictor.state.pos, s.predictor.state.yaw);
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
    updateRemoteBalls(sample.renderTick);
  }
  updateLocalBalls(dt, performance.now() < oppShieldUntil ? null : view.opp, null);
  updateAmmoHud(s.ammo, s.nextSnowball);
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
  // Shielded fighters blink.
  const now = performance.now();
  const blinkOff = Math.floor(now / 120) % 2 === 1;
  if (now < myShieldUntil && blinkOff) meshA.visible = false;
  if (now < oppShieldUntil && blinkOff) meshB.visible = false;
}

// ---------- Aim: the arc of the next snowball and where it lands ----------
const reticle = byId('reticle');
const ARC_POINTS = 200;
const arcPositions = new Float32Array(ARC_POINTS * 3);
const arcGeo = new THREE.BufferGeometry();
arcGeo.setAttribute('position', new THREE.BufferAttribute(arcPositions, 3));
const arc = new THREE.Line(arcGeo, new THREE.LineDashedMaterial({ color: 0xffb020, dashSize: 0.25, gapSize: 0.18, transparent: true, opacity: 0.55 }));
arc.frustumCulled = false;
scene.add(arc);

function updateAim(): void {
  arc.visible = mode !== null;
  if (!arc.visible) {
    reticle.style.display = 'none';
    return;
  }
  const start = launch(view.me, view.me.yaw);
  const ball: Snowball = { id: 0, owner: 0, pos: start.pos, vel: start.vel, age: 0 };
  let n = 0;
  let landing: Vec3 = { ...ball.pos };
  while (n < ARC_POINTS - 1) {
    arcPositions.set([ball.pos.x, ball.pos.y, ball.pos.z], n * 3);
    n++;
    const impact = stepSnowball(ball, 1 / 60, []);
    if (impact) {
      landing = impact.point;
      break;
    }
  }
  arcPositions.set([landing.x, landing.y, landing.z], n * 3);
  arcGeo.setDrawRange(0, n + 1);
  arcGeo.attributes['position']!.needsUpdate = true;
  arc.computeLineDistances();

  const p = toThree(landing).project(camera);
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
  updateAim();
  updateCountdown();
  renderer.render(scene, camera);
}
placeMeshes();
animate();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
