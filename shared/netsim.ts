// One network tick of a fighter, identical on the server and in client prediction.
import { KEY_BACK, KEY_FORWARD, KEY_LEFT, KEY_RIGHT, KEY_TURN_LEFT, KEY_TURN_RIGHT, TICK_DT } from './protocol.ts';
import { DEFAULT_MAP, type ArenaMap } from './maps.ts';
import { wrapAngle } from './math.ts';
import { stepPlayer, type MoveInput, type PlayerState } from './player.ts';

export function keysToInput(keys: number): MoveInput {
  return {
    forward: (keys & KEY_FORWARD) !== 0,
    back: (keys & KEY_BACK) !== 0,
    left: (keys & KEY_LEFT) !== 0,
    right: (keys & KEY_RIGHT) !== 0,
    turnLeft: (keys & KEY_TURN_LEFT) !== 0,
    turnRight: (keys & KEY_TURN_RIGHT) !== 0,
  };
}

/** Advances a fighter by one tick with the given key bitmask; yaw stays in [-PI, PI]. */
export function applyInput(player: PlayerState, keys: number, dt = TICK_DT, map: ArenaMap = DEFAULT_MAP): void {
  stepPlayer(player, keysToInput(keys), dt, map);
  player.yaw = wrapAngle(player.yaw);
}
