/**
 * Digital gameplay actions carried by input commands.
 *
 * The position in this list is the action's bit in an {@link ActionMask}, which
 * makes it part of the network format: append new actions, never reorder or
 * remove existing ones.
 */
export const INPUT_ACTIONS = ['jump', 'crouch', 'walk', 'fire', 'aim', 'reload'] as const;

export type InputAction = (typeof INPUT_ACTIONS)[number];

/** Bit set of {@link InputAction}s. */
export type ActionMask = number;

export const NO_ACTIONS: ActionMask = 0;

const ACTION_BITS: Readonly<Record<InputAction, number>> = Object.freeze(
  Object.fromEntries(INPUT_ACTIONS.map((action, index) => [action, 1 << index])) as Record<InputAction, number>,
);

/** All bits that correspond to a known action. */
export const ALL_ACTIONS_MASK: ActionMask = (1 << INPUT_ACTIONS.length) - 1;

export function actionBit(action: InputAction): number {
  return ACTION_BITS[action];
}

export function hasAction(mask: ActionMask, action: InputAction): boolean {
  return (mask & ACTION_BITS[action]) !== 0;
}

/** Actions contained in `mask`, in canonical order. */
export function actionsIn(mask: ActionMask): InputAction[] {
  return INPUT_ACTIONS.filter((action) => (mask & ACTION_BITS[action]) !== 0);
}
