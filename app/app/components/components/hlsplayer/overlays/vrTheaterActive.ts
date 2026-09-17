/**
 * Whether the 3D room currently owns the player surface.
 *
 * A flag rather than a DOM marker so that when the room is off it leaves
 * nothing behind: no attribute in the tree, and no query on the wheel path.
 * There is one global player, so one flag covers it.
 */
let active = false;

export function setVrTheaterActive(value: boolean) {
  active = value;
}

export function isVrTheaterActive() {
  return active;
}
