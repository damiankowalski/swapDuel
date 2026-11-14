// Room codes for the P2P online mode (v0.1.0 format: 5 characters, a-z and 0-9).

export const ROOM_CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
export const ROOM_CODE_LENGTH = 5;

/** Returns an integer in [0, max). The browser passes a crypto.getRandomValues-based function. */
export type RandomInt = (max: number) => number;

export function createRoomCode(randomInt: RandomInt): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  return code;
}

/** Normalises what a player typed; returns null unless it is a well-formed code. */
export function parseRoomCode(input: string): string | null {
  const code = input.trim().toLowerCase();
  return /^[a-z0-9]{5}$/.test(code) ? code : null;
}
