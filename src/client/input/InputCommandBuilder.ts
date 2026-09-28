import { createInputCommand, quantizeLook, type InputCommand } from '@shared/input/InputCommand';
import type { InputSample } from './InputState';

/**
 * Turns per-tick input samples into immutable, quantized input commands.
 *
 * Look rotation is quantized with error carry: the sub-quantum remainder of
 * each tick is added to the next one, so no mouse movement is ever lost to
 * rounding, however slow or low-sensitivity it is. The builder is
 * deterministic: the same samples in the same order always yield identical
 * commands.
 */
export class InputCommandBuilder {
  private lookCarryX = 0;
  private lookCarryY = 0;

  build(tick: number, sample: InputSample): InputCommand {
    const totalLookX = sample.lookX + this.lookCarryX;
    const totalLookY = sample.lookY + this.lookCarryY;
    const lookX = quantizeLook(totalLookX);
    const lookY = quantizeLook(totalLookY);
    this.lookCarryX = Number.isFinite(totalLookX) ? totalLookX - lookX : 0;
    this.lookCarryY = Number.isFinite(totalLookY) ? totalLookY - lookY : 0;

    return createInputCommand({
      tick,
      moveX: sample.moveX,
      moveY: sample.moveY,
      lookX,
      lookY,
      held: sample.held,
      pressed: sample.pressed,
    });
  }

  /** Drops the carried look remainder. */
  reset(): void {
    this.lookCarryX = 0;
    this.lookCarryY = 0;
  }
}
