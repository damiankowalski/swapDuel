// Gameplay and arena constants, shared by the client, the headless simulation and (from P2) the server.
// Values are those of v0.1.0; changing one changes the game.

/** Half the side of the square arena (m); the arena spans -ARENA_HALF..ARENA_HALF on x and z. */
export const ARENA_HALF = 10;
export const WALL_HEIGHT = 3.2;
export const WALL_THICKNESS = 0.4;

/** The indestructible crate in the middle: half its side and its height (m). */
export const CRATE_HALF = 1.5;
export const CRATE_HEIGHT = 3.0;

/** Eye height of a fighter (m); shots start here. */
export const EYE_HEIGHT = 1.6;
/** Collision radius of a fighter against walls and the crate (m). */
export const PLAYER_RADIUS = 0.6;

/** Fighter hit shape: a vertical capsule (the body) and a sphere (the head), relative to the fighter's feet. */
export const BODY_RADIUS = 0.45;
export const BODY_SEGMENT_BOTTOM = 0.45;
export const BODY_SEGMENT_TOP = 1.35;
export const HEAD_CENTER_Y = 1.75;
export const HEAD_RADIUS = 0.3;

/** Muzzle position in the fighter's local frame (x right, y up, -z forward); only used for tracers. */
export const MUZZLE_OFFSET = { x: 0, y: 1.5, z: -1.0 } as const;

export const MOVE_SPEED = 6.0; // m/s
export const BOT_SPEED = 2.6; // m/s
export const TURN_SPEED = 2.4; // rad/s, arrow keys

/** Time between shots while fire is held (s). */
export const FIRE_INTERVAL = 0.12;
/** After a hit, further hits by the same shooter are ignored for this long (s). */
export const HIT_COOLDOWN = 0.6;
/** Length of a shot that hits nothing (m). */
export const SHOT_RANGE = 60;

/** Longest frame step the simulation accepts (s); longer frames are clamped. */
export const MAX_FRAME_DT = 0.05;
/** Interval of P2P state messages (s), about 30 per second. */
export const SEND_INTERVAL = 0.033;

/** Start positions: the host (or the solo player) and the guest (or the bot). */
export const SPAWN_HOST = { x: 0, z: 6, yaw: 0 } as const;
export const SPAWN_GUEST = { x: 0, z: -6, yaw: Math.PI } as const;
