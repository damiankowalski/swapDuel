// The winter scene: sky, light, falling snow and the arena (snow floor, icy ditch, snow-block walls, wooden crates).
// The textures were generated locally with an image model (docs/DECISIONS.md ADR-016) and are inlined in the build.
import * as THREE from 'three';
import { WALL_THICKNESS } from '../../shared/constants.ts';
import { ditchEdge, MAX_ARENA_HALF, type ArenaMap } from '../../shared/maps.ts';
import crateUrl from '../assets/crate.jpg';
import iceUrl from '../assets/ice.jpg';
import snowUrl from '../assets/snow.jpg';
import wallUrl from '../assets/wall.jpg';

const loader = new THREE.TextureLoader();

/** A texture repeated `rx` x `ry` times; mirrored repeats hide the seams of images that do not tile. */
function texture(url: string, rx: number, ry: number): THREE.Texture {
  const t = loader.load(url);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.MirroredRepeatWrapping;
  t.wrapT = THREE.MirroredRepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = 4;
  return t;
}

/** Sky, fog and light. */
export function setUpSky(scene: THREE.Scene): void {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#4f6f9a');
  grad.addColorStop(0.55, '#a9c1dc');
  grad.addColorStop(1, '#e3ecf5');
  g.fillStyle = grad;
  g.fillRect(0, 0, 2, 256);
  const sky = new THREE.CanvasTexture(c);
  sky.colorSpace = THREE.SRGBColorSpace;
  scene.background = sky;
  scene.fog = new THREE.Fog(0xc4d4e6, 22, 60);
  scene.add(new THREE.HemisphereLight(0xdfeaff, 0x5a6a80, 1.4));
  const sun = new THREE.DirectionalLight(0xfff2e0, 1.6);
  sun.position.set(6, 12, 4);
  scene.add(sun);
}

/** Gently falling snow over the whole arena. Call `update` every frame. */
export function makeSnowfall(scene: THREE.Scene): { update(dt: number): void } {
  const COUNT = 700;
  const SPAN = MAX_ARENA_HALF + 4;
  const TOP = 12;
  const pos = new Float32Array(COUNT * 3);
  const speed = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    pos[i * 3] = (Math.random() * 2 - 1) * SPAN;
    pos[i * 3 + 1] = Math.random() * TOP;
    pos[i * 3 + 2] = (Math.random() * 2 - 1) * SPAN;
    speed[i] = 0.6 + Math.random() * 0.8;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dot = document.createElement('canvas');
  dot.width = dot.height = 32;
  const d = dot.getContext('2d')!;
  const rg = d.createRadialGradient(16, 16, 0, 16, 16, 16);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  d.fillStyle = rg;
  d.fillRect(0, 0, 32, 32);
  const mat = new THREE.PointsMaterial({
    size: 0.09, map: new THREE.CanvasTexture(dot), transparent: true, depthWrite: false, opacity: 0.9,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  let time = 0;
  return {
    update(dt) {
      time += dt;
      for (let i = 0; i < COUNT; i++) {
        let y = pos[i * 3 + 1]! - speed[i]! * dt;
        if (y < -1) y += TOP + 1;
        pos[i * 3 + 1] = y;
        pos[i * 3] = pos[i * 3]! + Math.sin(time * 0.7 + i) * 0.15 * dt;
      }
      geo.attributes['position']!.needsUpdate = true;
    },
  };
}

/** Builds the arena's meshes (floor, ditch, walls, crates) for `map` into a new group. */
export function buildArena(map: ArenaMap): THREE.Group {
  const g = new THREE.Group();
  const edge = map.ditch > 0 ? ditchEdge(map) : map.half;
  const depth = map.ditchDepth;
  const TILE = 4; // metres per texture repeat on the ground

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(edge * 2, edge * 2),
    new THREE.MeshStandardMaterial({ map: texture(snowUrl, (edge * 2) / TILE, (edge * 2) / TILE), color: 0xe6eef7, roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2;
  g.add(floor);

  if (map.ditch > 0) {
    // The ditch: a lower, icy floor between the playable square and the walls, with a bright lip so the edge reads
    // well through the opponent's eyes.
    const ditchFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(map.half * 2, map.half * 2),
      new THREE.MeshStandardMaterial({
        map: texture(iceUrl, (map.half * 2) / TILE, (map.half * 2) / TILE), color: 0x8fb4d8, roughness: 0.25, metalness: 0.1,
      }),
    );
    ditchFloor.rotation.x = -Math.PI / 2;
    ditchFloor.position.y = -depth;
    g.add(ditchFloor);
    const sideMat = new THREE.MeshStandardMaterial({ map: texture(iceUrl, edge, depth / 2), color: 0x6f93b8, roughness: 0.5 });
    const lipMat = new THREE.MeshBasicMaterial({ color: 0x5fc4ff });
    for (const [w, d, x, z] of [
      [edge * 2, 0.1, 0, edge], [edge * 2, 0.1, 0, -edge], [0.1, edge * 2, edge, 0], [0.1, edge * 2, -edge, 0],
    ] as const) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(w, depth, d), sideMat);
      side.position.set(x, -depth / 2, z);
      g.add(side);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(w || 0.14, 0.04, d || 0.14), lipMat);
      lip.position.set(x, 0.02, z);
      g.add(lip);
    }
  }

  const S = map.half * 2;
  const t = WALL_THICKNESS;
  const wallH = map.wallHeight + depth;
  const wallMat = new THREE.MeshStandardMaterial({ map: texture(wallUrl, (S + t) / 3, wallH / 3), color: 0xdde7f2, roughness: 0.9 });
  const mkWall = (w: number, d: number, x: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), wallMat);
    m.position.set(x, wallH / 2 - depth, z);
    g.add(m);
  };
  mkWall(S + t, t, 0, map.half);
  mkWall(S + t, t, 0, -map.half);
  mkWall(t, S + t, map.half, 0);
  mkWall(t, S + t, -map.half, 0);

  for (const c of map.crates) {
    const crateMat = new THREE.MeshStandardMaterial({ map: texture(crateUrl, 1, c.height / (c.half * 2)), roughness: 0.8 });
    const crate = new THREE.Mesh(new THREE.BoxGeometry(c.half * 2, c.height, c.half * 2), crateMat);
    crate.position.set(c.x, c.height / 2, c.z);
    g.add(crate);
  }
  return g;
}

/** Frees the GPU memory of a group made by buildArena. */
export function disposeArena(g: THREE.Group): void {
  g.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.geometry.dispose();
    const m = o.material as THREE.MeshStandardMaterial;
    m.map?.dispose();
    m.dispose();
  });
}
