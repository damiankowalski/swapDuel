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

export const MOVE_SPEED = 6.0; // m/s
export const BOT_SPEED = 2.6; // m/s
export const TURN_SPEED = 2.4; // rad/s, arrow keys

// ---------- Snowballs (they replaced the hit-scan laser of v0.1.0-v0.3.0) ----------

/** Snowballs each player has at the start of a match. */
export const START_AMMO = 5;
/** One more snowball every AMMO_INTERVAL seconds. */
export const AMMO_INTERVAL = 10;
/** Most snowballs a player can hold. Infinity = they keep piling up (owner's choice, ADR-013). */
export const MAX_AMMO = Infinity;
/** Shortest time between two throws (s); each throw needs a new press of the fire key. */
export const THROW_COOLDOWN = 0.3;
/** Launch speed (m/s) and angle above the horizon (rad): about 18 m of range on flat ground. */
export const SNOWBALL_SPEED = 20;
export const SNOWBALL_ELEVATION = (8 * Math.PI) / 180;
export const GRAVITY = 9.81;
export const SNOWBALL_RADIUS = 0.15;
/** Where a snowball leaves the hand, in the fighter's frame (up, forward). */
export const THROW_HEIGHT = 1.5;
export const THROW_FORWARD = 0.5;
/** A snowball older than this (s) melts away. */
export const SNOWBALL_LIFETIME = 4;
/** Physics step for flying snowballs (s): 8 cm per step at full speed, less than the ball's radius. */
export const SNOWBALL_STEP = 1 / 240;

// ---------- Match rules (ADR-014) ----------

/** The first player to this many points wins the match. */
export const WIN_SCORE = 10;
/** After a respawn, snowballs fly through the fighter for this long (s). */
export const SPAWN_PROTECTION = 1.5;
/** "3-2-1" before a match (and a rematch) starts: nobody moves or throws (s). */
export const COUNTDOWN = 3;
/** A bot throws only at targets closer than this (m), a little under the snowball's range. */
export const BOT_THROW_RANGE = 16;

/** Longest frame step the simulation accepts (s); longer frames are clamped. */
export const MAX_FRAME_DT = 0.05;
/** Interval of P2P state messages (s), about 30 per second. */
export const SEND_INTERVAL = 0.033;

/** Start positions: the host (or the solo player) and the guest (or the bot). */
export const SPAWN_HOST = { x: 0, z: 6, yaw: 0 } as const;
export const SPAWN_GUEST = { x: 0, z: -6, yaw: Math.PI } as const;
