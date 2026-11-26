// Swap Duel client: rendering, input and HUD. Training runs the shared simulation locally; online play goes through
// the authoritative game server (client/src/net.ts): the local fighter is predicted, the opponent interpolated, and
// the camera - which is the opponent's eyes - filtered so network jitter does not shake the screen.
import * as THREE from 'three';
import { createBot, respawnBot, stepBot, type BotState } from '../../shared/bot.ts';
import {
  AMMO_INTERVAL,
  COUNTDOWN,
  MAX_FRAME_DT,
  SNOWBALL_LIFETIME,
  SNOWBALL_RADIUS,
  SPAWN_PROTECTION,
  SPAWN_GUEST,
  SPAWN_HOST,
  WIN_SCORE,
} from '../../shared/constants.ts';
import { inDitch, randomSpawnPoint } from '../../shared/arena.ts';
import { MAPS, type ArenaMap, type MapId } from '../../shared/maps.ts';
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
import { Effects } from './effects.ts';
import { Fighter, makeSinkGhost } from './fighter.ts';
import { fetchStatus, OnlineSession } from './net.ts';
import { buildArena, disposeArena, makeSnowfall, setUpSky } from './scenery.ts';
import { Sound } from './sound.ts';

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
setUpSky(scene);
const snowfall = makeSnowfall(scene);
const effects = new Effects(scene);
const sound = new Sound();

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 200);

// ---------- Arena ----------
let arenaMap: ArenaMap = MAPS.classic;
let arenaGroup = buildArena(arenaMap);
scene.add(arenaGroup);

function setArena(map: ArenaMap): void {
  if (map === arenaMap) return;
  scene.remove(arenaGroup);
  disposeArena(arenaGroup);
  arenaGroup = buildArena(map);
  scene.add(arenaGroup);
  arenaMap = map;
}

// ---------- Fighters ----------
const fighterA = new Fighter(0x4da3ff); // you (local)
// A ring on the ground under your own fighter: easier to find yourself through the opponent's eyes.
const ring = new THREE.Mesh(
  new THREE.RingGeometry(0.62, 0.8, 40),
  new THREE.MeshBasicMaterial({ color: 0x4da3ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
);
ring.rotation.x = -Math.PI / 2;
ring.position.y = 0.03;
fighterA.root.add(ring);
const fighterB = new Fighter(0xff5a5a); // opponent (remote or bot)
scene.add(fighterA.root, fighterB.root);
/** Set when a fighter fell into the ditch: its next respawn jump sinks a ghost instead of a snow burst. */
const fell = { me: false, opp: false };

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
addEventListener('pointerdown', () => sound.unlock());
addEventListener('keydown', (e) => {
  sound.unlock();
  if (e.target instanceof HTMLInputElement) return;
  keys[e.code] = true;
  if (e.code === 'Space' && !e.repeat) firePressed = true;
  if (['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
  if (e.code === 'KeyV') toggleView();
  if (e.code === 'KeyM') toast(sound.toggleMute() ? 'Sound off' : 'Sound on');
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

/** The arena for training and for games this player creates (a guest plays the host's choice). */
let selectedMap: MapId = 'classic';
document.querySelectorAll<HTMLButtonElement>('#mapChoice [data-map]').forEach((btn) => {
  btn.onclick = () => {
    selectedMap = btn.dataset['map'] === 'moat' ? 'moat' : 'classic';
    document.querySelectorAll('#mapChoice [data-map]').forEach((b) => b.classList.toggle('on', b === btn));
  };
});

let toastTimer: ReturnType<typeof setTimeout> | null = null;
function toast(text: string): void {
  const el = byId('toast');
  el.textContent = text;
  el.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2200);
}

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
  effects.clear();
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
      onStart: (you, opp, go, map) => startOnline(you, opp, go, map),
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
    s.create(selectedMap);
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
  sound.over(winner === 'you');
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

let countdownShown = '';
function updateCountdown(): void {
  const el = byId('countdown');
  const left = countdownEnd - performance.now();
  if (!playing || matchOver || left < -700) {
    el.classList.add('hidden');
    countdownShown = '';
    return;
  }
  const text = left > 0 ? String(Math.ceil(left / 1000)) : 'GO!';
  if (text !== countdownShown) sound.beep(text === 'GO!');
  countdownShown = text;
  el.textContent = text;
  el.classList.remove('hidden');
}

function startBot(): void {
  mode = 'bot';
  setArena(MAPS[selectedMap]);
  thrower = createThrower();
  botThrower = createThrower();
  countdownEnd = Infinity; // starts at the click on the start screen
  clearBalls();
  a.pos = { x: SPAWN_HOST.x, z: SPAWN_HOST.z };
  a.yaw = SPAWN_HOST.yaw;
  b = createBot({ x: SPAWN_GUEST.x, z: SPAWN_GUEST.z }, SPAWN_GUEST.yaw);
  enterGame('Training vs bot — <span class="you">blue</span> is you, you see through <span class="enemy">red</span>\'s eyes.');
}

function startOnline(you: Pose, opp: Pose, go: number, map: MapId): void {
  mode = 'online';
  setArena(MAPS[map]);
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
  sound.hurt();
  flashEl.classList.add('on');
  setTimeout(() => flashEl.classList.remove('on'), 160);
}
function showHitmark(): void {
  sound.scored();
  hitmark.classList.add('on');
  setTimeout(() => hitmark.classList.remove('on'), 120);
}

// ---------- Snowballs on screen ----------
const ballGeo = new THREE.SphereGeometry(SNOWBALL_RADIUS, 14, 10);
const ballMat = new THREE.MeshStandardMaterial({ color: 0xf2f7ff, roughness: 0.8 });

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
  /** The opponent's throwing animation has played (when the ball first appears on its delayed clock). */
  shown: boolean;
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

/** A snowball splats: a puff of snow and a sound that fades with distance from the camera. */
function puff(at: Vec3): void {
  effects.burst(at);
  sound.splat(camera.position.distanceTo(toThree(at)));
}

function throwLocal(from: Vec2, yaw: number, byBot = false): void {
  const start = launch(from, yaw);
  (byBot ? fighterB : fighterA).throw();
  sound.throw(!byBot);
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
    const impact = stepSnowball(b.ball, dt, target ? [{ seat: b.byBot ? 0 : 1, pos: target }] : [], arenaMap);
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
    if (t >= 0 && !b.shown) {
      b.shown = true;
      fighterB.throw();
      sound.throw(false);
    }
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
        id: e.id, from: { x: fx, y: fy, z: fz }, vel: { x: vx, y: vy, z: vz }, tick, splatTick: null, splatAt: null, mesh: ballMesh(), shown: false,
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
    } else if (e.k === 'fall') {
      sound.fall();
      fell[e.who === 'you' ? 'me' : 'opp'] = true;
      if (e.who === 'you') {
        flashHit();
        toast('You fell into the ditch: +1 for your opponent');
      } else toast('Your opponent fell into the ditch: +1 for you');
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
      arenaMap,
    );
    if (pressFire(thrower, takeFire())) throwLocal(a.pos, a.yaw);
  }
  if (started) {
    const wantsThrow = stepBot(b, dt, rng, a.pos, arenaMap);
    if (live()) {
      tickThrower(botThrower, dt);
      if (pressFire(botThrower, wantsThrow)) throwLocal(b.pos, b.lookYaw, true);
    }
  }
  const hits = updateLocalBalls(dt, now < oppShieldUntil ? null : b.pos, now < myShieldUntil ? null : a.pos);
  if (hits.mine) {
    myScore++;
    showHitmark();
    respawnBot(b, rng, arenaMap);
    oppShieldUntil = now + SPAWN_PROTECTION * 1000;
  }
  const fellIn = inDitch(a.pos, arenaMap);
  if (hits.bots || fellIn) {
    oppScore++;
    flashHit();
    if (fellIn) {
      sound.fall();
      fell.me = true;
      toast('You fell into the ditch: +1 for your opponent');
    }
    a.pos = randomSpawnPoint(rng, arenaMap);
    myShieldUntil = now + SPAWN_PROTECTION * 1000;
  }
  if (hits.mine || hits.bots || fellIn) {
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
function placeMeshes(dt: number): void {
  for (const [f, pose, who] of [[fighterA, view.me, 'me'], [fighterB, view.opp, 'opp']] as const) {
    const from = f.update(pose.x, pose.z, pose.yaw, dt);
    if (!from) continue;
    // A respawn: where the fighter was, it either sinks into the ditch or bursts into snow.
    if (fell[who]) effects.add(makeSinkGhost(f, from));
    else effects.burst({ x: from.x, y: 1, z: from.z }, 28, 4);
    fell[who] = false;
  }
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
    fighterA.visible = true;
    fighterB.visible = false;
  } else {
    camera.position.set(view.me.x, eyeOf(view.me).y, view.me.z);
    camera.rotation.set(0, view.me.yaw, 0, 'YXZ');
    fighterA.visible = false;
    fighterB.visible = true;
  }
  // Shielded fighters blink.
  const now = performance.now();
  const blinkOff = Math.floor(now / 120) % 2 === 1;
  if (now < myShieldUntil && blinkOff) fighterA.visible = false;
  if (now < oppShieldUntil && blinkOff) fighterB.visible = false;
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
    const impact = stepSnowball(ball, 1 / 60, [], arenaMap);
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

const timer = new THREE.Timer();
function animate(now: number): void {
  requestAnimationFrame(animate);
  timer.update(now);
  const dt = Math.min(timer.getDelta(), MAX_FRAME_DT);

  if (mode === 'online' && session) updateOnline(dt, session);
  else if (mode === 'bot') updateTraining(dt);

  placeMeshes(dt);
  effects.update(dt);
  snowfall.update(dt);
  updateCamera(dt);
  updateAim();
  updateCountdown();
  renderer.render(scene, camera);
}
placeMeshes(0);
requestAnimationFrame(animate);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
