// Snowman fighters built from simple shapes, animated in code (client/src/anim.ts has the curves). The shapes follow
// the hit volumes in shared/constants.ts: a body about 0.9 m wide up to 1.8 m and a head centred at 1.75 m.
import * as THREE from 'three';
import type { Transient } from './effects.ts';
import { HEAD_CENTER_Y, HEAD_RADIUS } from '../../shared/constants.ts';
import type { Pose } from '../../shared/protocol.ts';
import { isTeleport, POP_ANIM, popScale, sink, SINK_ANIM, STRIDE, throwArm, waddle } from './anim.ts';

// A little emissive keeps the shaded side of the snow from turning grey.
const snowMat = new THREE.MeshStandardMaterial({ color: 0xf4f8ff, roughness: 0.85, emissive: 0x27303c });
const coalMat = new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.6 });
const carrotMat = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.6 });
const stickMat = new THREE.MeshStandardMaterial({ color: 0x5b3a22, roughness: 0.9 });

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

/** An arm: a stick hinged at the shoulder, pointing down; rotating it around x swings it forward or back. */
function makeArm(side: 1 | -1): THREE.Group {
  const shoulder = new THREE.Group();
  shoulder.position.set(side * 0.36, 1.25, 0);
  shoulder.rotation.z = side * 0.55; // splayed outwards
  const stick = mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.7, 6), stickMat, 0, -0.35, 0);
  shoulder.add(stick);
  const twig = mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.2, 5), stickMat, side * 0.05, -0.62, 0);
  twig.rotation.z = side * -0.6;
  shoulder.add(twig);
  return shoulder;
}

export class Fighter {
  /** Placed by the game at the fighter's position and yaw. */
  readonly root = new THREE.Group();
  /** Animated inside the root: waddle and pop scale. */
  private readonly body = new THREE.Group();
  private readonly armL: THREE.Group;
  private readonly armR: THREE.Group;
  private phase = 0;
  private speed = 0;
  private last: Pose | null = null;
  private throwAt = -Infinity;
  private popAt = -Infinity;
  private time = 0;

  constructor(color: number) {
    const team = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
    const b = this.body;
    b.add(mesh(new THREE.SphereGeometry(0.5, 20, 14), snowMat, 0, 0.47, 0));
    b.add(mesh(new THREE.SphereGeometry(0.4, 20, 14), snowMat, 0, 1.15, 0));
    b.add(mesh(new THREE.SphereGeometry(HEAD_RADIUS, 18, 12), snowMat, 0, HEAD_CENTER_Y, 0));
    // Forward is -z (see shared/math.ts forwardOf): face, buttons and the carrot point that way.
    for (const [x, y] of [[-0.1, 1.82], [0.1, 1.82]] as const) {
      b.add(mesh(new THREE.SphereGeometry(0.04, 8, 6), coalMat, x, y, -0.27));
    }
    for (const y of [1.3, 1.12, 0.94]) b.add(mesh(new THREE.SphereGeometry(0.045, 8, 6), coalMat, 0, y, -0.39));
    const nose = mesh(new THREE.ConeGeometry(0.05, 0.28, 10), carrotMat, 0, 1.74, -0.4);
    nose.rotation.x = -Math.PI / 2;
    b.add(nose);
    // Team colours: a scarf and a bobble hat, so blue and red read from far away.
    const scarf = mesh(new THREE.TorusGeometry(0.29, 0.07, 8, 20), team, 0, 1.48, 0);
    scarf.rotation.x = Math.PI / 2;
    b.add(scarf);
    const tail = mesh(new THREE.BoxGeometry(0.12, 0.35, 0.05), team, 0.17, 1.32, 0.26);
    tail.rotation.z = 0.2;
    b.add(tail);
    b.add(mesh(new THREE.CylinderGeometry(0.22, 0.29, 0.22, 16), team, 0, 1.98, 0));
    b.add(mesh(new THREE.SphereGeometry(0.08, 10, 8), snowMat, 0, 2.14, 0));
    this.armL = makeArm(-1);
    this.armR = makeArm(1);
    b.add(this.armL, this.armR);
    this.root.add(b);
  }

  /** Starts the throwing-arm swing. */
  throw(): void {
    this.throwAt = this.time;
  }

  /**
   * Places the fighter and advances its animations. A jump further than a step is a respawn: the fighter pops back
   * in, and the pose it jumped from is returned so the caller can leave an effect there; otherwise null.
   */
  update(x: number, z: number, yaw: number, dt: number): Pose | null {
    this.time += dt;
    let from: Pose | null = null;
    if (this.last && isTeleport(this.last.x, this.last.z, x, z)) {
      // Rendering between two ticks can split one respawn into two jumps: count it once.
      if (this.time - this.popAt > POP_ANIM / 2) from = { ...this.last };
      this.popAt = this.time;
      this.speed = 0;
    } else if (this.last && dt > 0) {
      const d = Math.hypot(x - this.last.x, z - this.last.z);
      this.phase += (d / STRIDE) * Math.PI * 2;
      // Smoothed 0..1 "is walking" amount, from metres per second.
      const target = Math.min(1, d / dt / 3);
      this.speed += (target - this.speed) * Math.min(1, dt * 10);
    }
    this.last = { x, z, yaw };
    this.root.position.set(x, 0, z);
    this.root.rotation.y = yaw;

    const w = waddle(this.phase, this.speed);
    this.body.rotation.z = w.roll;
    this.body.position.y = w.hop;
    this.body.scale.setScalar(popScale(this.time - this.popAt));
    this.armL.rotation.x = -w.arm;
    const thr = throwArm(this.time - this.throwAt);
    // A raised arm swings forward (towards -z), which is a negative rotation around x.
    this.armR.rotation.x = thr !== 0 ? -thr : w.arm;
    return from;
  }

  set visible(v: boolean) {
    this.root.visible = v;
  }
}

/** A see-through copy that sinks into the ditch where a fighter fell. */
export function makeSinkGhost(f: Fighter, at: Pose): Transient {
  const obj = f.root.clone(true);
  obj.visible = true;
  obj.children[0]?.scale.setScalar(1); // the body: undo the respawn pop that has just started
  obj.position.set(at.x, 0, at.z);
  obj.rotation.y = at.yaw;
  obj.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      const m = (o.material as THREE.MeshStandardMaterial).clone();
      m.transparent = true;
      o.material = m;
    }
  });
  return {
    obj,
    update(t) {
      const s = sink(t);
      obj.position.y = -s.drop;
      obj.scale.setScalar(s.scale);
      obj.traverse((o) => {
        if (o instanceof THREE.Mesh) (o.material as THREE.MeshStandardMaterial).opacity = s.scale;
      });
      if (t < SINK_ANIM) return true;
      obj.traverse((o) => {
        if (o instanceof THREE.Mesh) (o.material as THREE.Material).dispose();
      });
      return false;
    },
  };
}
