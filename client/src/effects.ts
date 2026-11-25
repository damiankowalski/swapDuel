// Short-lived effects: snow bursts where snowballs splat or a fighter is hit, and anything else that animates for a
// moment and then removes itself. Everything advances from the game loop (`update`), not from its own timers.
import * as THREE from 'three';
import type { Vec3 } from '../../shared/math.ts';
import { BURST_ANIM, burstFade } from './anim.ts';

const GRAVITY = 9;
const flakeGeo = new THREE.SphereGeometry(1, 6, 4);
const flakeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

interface Particle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  age: number;
  size: number;
}

/** Anything that animates for a while: `update(t)` gets seconds since it started and returns false when done. */
export interface Transient {
  obj: THREE.Object3D;
  update(t: number): boolean;
}

export class Effects {
  private particles: Particle[] = [];
  private transients: Array<{ t: Transient; age: number }> = [];

  private readonly scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** A puff of snow at `at`: `count` chunks fly out, fall and shrink away. */
  burst(at: Vec3, count = 10, power = 2.5): void {
    for (let i = 0; i < count; i++) {
      const size = 0.04 + Math.random() * 0.06;
      const mesh = new THREE.Mesh(flakeGeo, flakeMat);
      mesh.scale.setScalar(size);
      mesh.position.set(at.x, Math.max(0.05, at.y), at.z);
      const a = Math.random() * Math.PI * 2;
      const up = 0.5 + Math.random();
      const v = power * (0.4 + Math.random() * 0.6);
      this.scene.add(mesh);
      this.particles.push({ mesh, vel: new THREE.Vector3(Math.cos(a) * v, up * v, Math.sin(a) * v), age: 0, size });
    }
  }

  add(t: Transient): void {
    this.scene.add(t.obj);
    this.transients.push({ t, age: 0 });
  }

  update(dt: number): void {
    this.particles = this.particles.filter((p) => {
      p.age += dt;
      p.vel.y -= GRAVITY * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.mesh.position.y < 0.03) {
        p.mesh.position.y = 0.03;
        p.vel.set(0, 0, 0);
      }
      const k = burstFade(p.age);
      p.mesh.scale.setScalar(p.size * (0.4 + 0.6 * k));
      if (p.age < BURST_ANIM) return true;
      this.scene.remove(p.mesh);
      return false;
    });
    this.transients = this.transients.filter((e) => {
      e.age += dt;
      if (e.t.update(e.age)) return true;
      this.scene.remove(e.t.obj);
      return false;
    });
  }

  clear(): void {
    for (const p of this.particles) this.scene.remove(p.mesh);
    for (const e of this.transients) this.scene.remove(e.t.obj);
    this.particles = [];
    this.transients = [];
  }
}
