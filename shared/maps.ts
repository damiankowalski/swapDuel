// Arenas. Every rule that depends on the arena (walls, crates, ditch, spawn points, snowball collisions) takes one of
// these; the classic arena is the default everywhere, so code written before P4b keeps its behaviour.
import { ARENA_HALF, CRATE_HALF, CRATE_HEIGHT, WALL_HEIGHT } from './constants.ts';

export type MapId = 'classic' | 'moat';

export interface Crate {
  x: number;
  z: number;
  /** Half the side (m). */
  half: number;
  height: number;
}

export interface ArenaMap {
  id: MapId;
  /** Shown in the menu. */
  name: string;
  /** The arena spans -half..half on x and z (wall centre lines). */
  half: number;
  wallHeight: number;
  crates: readonly Crate[];
  /** Width of the ditch along the walls (m); 0 = no ditch. */
  ditch: number;
  /** How deep the ditch floor is (m). */
  ditchDepth: number;
}

export const MAPS: Readonly<Record<MapId, ArenaMap>> = {
  classic: {
    id: 'classic',
    name: 'Classic',
    half: ARENA_HALF,
    wallHeight: WALL_HEIGHT,
    crates: [{ x: 0, z: 0, half: CRATE_HALF, height: CRATE_HEIGHT }],
    ditch: 0,
    ditchDepth: 0,
  },
  moat: {
    id: 'moat',
    name: 'Frozen moat',
    half: 14,
    wallHeight: WALL_HEIGHT,
    crates: [
      { x: 0, z: 0, half: 1.2, height: 2.4 },
      { x: -6, z: 5, half: 0.9, height: 1.8 },
      { x: 6, z: -5, half: 0.9, height: 1.8 },
    ],
    ditch: 1.6,
    ditchDepth: 1.2,
  },
};

export const MAP_IDS: readonly MapId[] = ['classic', 'moat'];
export const DEFAULT_MAP = MAPS.classic;
/** The largest arena half: bounds for validating positions in the protocol. */
export const MAX_ARENA_HALF = Math.max(...MAP_IDS.map((id) => MAPS[id].half));

export function isMapId(v: unknown): v is MapId {
  return typeof v === 'string' && (MAP_IDS as readonly string[]).includes(v);
}

/** Where the playable floor ends and the ditch begins (|x| or |z| beyond this is over the ditch). */
export function ditchEdge(map: ArenaMap): number {
  return map.half - map.ditch;
}
