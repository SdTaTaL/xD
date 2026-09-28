import { actionsIn } from '@shared/input/InputAction';
import type { InputCommand } from '@shared/input/InputCommand';
import type { InputCommandSource } from '@shared/input/InputCommandBuffer';
import type { GameSystem, TickContext } from '../core/GameSystem';

export interface InputDebugDeviceState {
  readonly captured: boolean;
  readonly keys: Iterable<string>;
  readonly buttons: Iterable<string>;
}

export interface InputDebugPanelOptions {
  readonly parent: HTMLElement;
  readonly commands: InputCommandSource;
  readonly getDeviceState: () => InputDebugDeviceState;
}

const REFRESH_MS = 100;
const RATE_WINDOW_MS = 1000;
const PRESS_LOG_SIZE = 4;
const DEGREES_PER_RADIAN = 180 / Math.PI;

function signed(value: number, digits: number): string {
  const text = value.toFixed(digits);
  return text.startsWith('-') ? text : `+${text}`;
}

/**
 * TEMPORARY input debug panel, enabled with `?debug=input`. It verifies the
 * input pipeline (device state, commands, 64 Hz rate). Delete it together
 * with the player debug panel when movement tuning is done.
 *
 * It consumes commands exactly as gameplay will: `commands.get(tick)` from
 * its own `fixedUpdate`, registered after the input system.
 */
export class InputDebugPanel implements GameSystem {
  readonly name = 'input-debug';

  private readonly element: HTMLPreElement;
  private readonly commands: InputCommandSource;
  private readonly getDeviceState: () => InputDebugDeviceState;
  private readonly presses: string[] = [];

  private last: InputCommand | undefined;
  private missingCommands = 0;
  private lookTotalX = 0;
  private lookTotalY = 0;
  private wasCaptured = false;
  private rateWindowStart: number | null = null;
  private ticksInWindow = 0;
  private commandRate: number | null = null;
  private lastDraw = -Infinity;

  constructor(options: InputDebugPanelOptions) {
    this.commands = options.commands;
    this.getDeviceState = options.getDeviceState;

    this.element = document.createElement('pre');
    this.element.className = 'debug-overlay';
    this.element.dataset['panel'] = 'input';
    this.element.setAttribute('aria-hidden', 'true');
    this.element.style.left = 'auto';
    this.element.style.right = '8px';
    options.parent.append(this.element);
  }

  fixedUpdate(tick: TickContext): void {
    const command = this.commands.get(tick.tick);
    if (!command) {
      this.missingCommands++;
      return;
    }

    this.last = command;
    this.ticksInWindow++;
    this.lookTotalX += command.lookX;
    this.lookTotalY += command.lookY;
    for (const action of actionsIn(command.pressed)) this.presses.unshift(`${action}@${command.tick}`);
    this.presses.length = Math.min(this.presses.length, PRESS_LOG_SIZE);
  }

  endFrame(): void {
    const now = performance.now();
    if (this.rateWindowStart === null) {
      this.rateWindowStart = now;
      this.ticksInWindow = 0;
    } else if (now - this.rateWindowStart >= RATE_WINDOW_MS) {
      this.commandRate = (this.ticksInWindow * 1000) / (now - this.rateWindowStart);
      this.rateWindowStart = now;
      this.ticksInWindow = 0;
    }

    const device = this.getDeviceState();
    if (device.captured !== this.wasCaptured) {
      this.wasCaptured = device.captured;
      this.lookTotalX = 0;
      this.lookTotalY = 0;
    }

    if (now - this.lastDraw < REFRESH_MS) return;
    this.lastDraw = now;
    this.draw(device);
  }

  dispose(): void {
    this.element.remove();
  }

  private draw(device: InputDebugDeviceState): void {
    const command = this.last;
    const rate = this.commandRate === null ? '…' : this.commandRate.toFixed(1);
    const list = (items: Iterable<string>): string => [...items].join(' ') || '—';

    this.element.textContent = [
      'INPUT (temporary debug)',
      `Capture  ${device.captured ? 'CAPTURED · Esc releases' : 'free · click the game view to capture'}`,
      `Keys     ${list(device.keys)}`,
      `Mouse    ${list(device.buttons)}`,
      `Tick     ${command?.tick ?? '—'}  (${rate} cmd/s${this.missingCommands ? `, ${this.missingCommands} missing` : ''})`,
      `Move     x ${signed(command?.moveX ?? 0, 3)}  y ${signed(command?.moveY ?? 0, 3)}`,
      `Look     x ${signed((command?.lookX ?? 0) * DEGREES_PER_RADIAN, 4)}°  y ${signed((command?.lookY ?? 0) * DEGREES_PER_RADIAN, 4)}°  (last tick)`,
      `Look Σ   x ${signed(this.lookTotalX * DEGREES_PER_RADIAN, 2)}°  y ${signed(this.lookTotalY * DEGREES_PER_RADIAN, 2)}°  (since capture change)`,
      `Held     ${list(actionsIn(command?.held ?? 0))}`,
      `Pressed  ${list(this.presses)}`,
    ].join('\n');
  }
}
