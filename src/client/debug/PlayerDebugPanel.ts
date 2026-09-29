import { actionsIn } from '@shared/input/InputAction';
import type { InputCommand } from '@shared/input/InputCommand';
import type { PlayerMovementConfig } from '@shared/player/PlayerMovementConfig';
import { eyeHeight, horizontalSpeed, type PlayerState } from '@shared/player/PlayerState';
import type { GameSystem, TickContext } from '../core/GameSystem';

export interface PlayerDebugSource {
  readonly current: PlayerState;
  readonly command: InputCommand | undefined;
}

export interface PlayerDebugPanelOptions {
  readonly parent: HTMLElement;
  readonly player: PlayerDebugSource;
  readonly config: PlayerMovementConfig;
}

const REFRESH_MS = 100;
/** Window of the "max speed" readout, in ticks (1 s at 64 Hz). */
const SPEED_WINDOW_TICKS = 64;
const DEGREES_PER_RADIAN = 180 / Math.PI;

function signed(value: number, digits: number): string {
  const text = value.toFixed(digits);
  return text.startsWith('-') ? text : `+${text}`;
}

interface AirPhase {
  readonly apex: number;
  readonly seconds: number;
}

/**
 * TEMPORARY player movement debug panel, enabled with `?debug=player`.
 * Shows the simulated state and the command it consumed, plus measurements
 * useful for tuning feel (top speed over the last second, apex and duration
 * of the last airborne phase). Delete it once movement tuning is done.
 */
export class PlayerDebugPanel implements GameSystem {
  readonly name = 'player-debug';

  private readonly element: HTMLPreElement;
  private readonly player: PlayerDebugSource;
  private readonly config: PlayerMovementConfig;
  private readonly speeds: number[] = [];

  private tick = 0;
  private wasGrounded = true;
  private groundY = 0;
  private airTicks = 0;
  private airMaxY = 0;
  private lastAir: AirPhase | null = null;
  private lastDraw = -Infinity;

  constructor(options: PlayerDebugPanelOptions) {
    this.player = options.player;
    this.config = options.config;

    this.element = document.createElement('pre');
    this.element.className = 'debug-overlay';
    this.element.dataset['panel'] = 'player';
    this.element.setAttribute('aria-hidden', 'true');
    this.element.style.top = 'auto';
    this.element.style.bottom = '8px';
    options.parent.append(this.element);
  }

  fixedUpdate(tick: TickContext): void {
    const state = this.player.current;
    this.tick = tick.tick;

    this.speeds.push(horizontalSpeed(state));
    if (this.speeds.length > SPEED_WINDOW_TICKS) this.speeds.shift();

    if (state.grounded) {
      if (!this.wasGrounded) {
        this.lastAir = { apex: this.airMaxY - this.groundY, seconds: (this.airTicks + 1) * tick.deltaSeconds };
      }
      this.groundY = state.position.y;
    } else {
      if (this.wasGrounded) {
        this.airTicks = 0;
        this.airMaxY = state.position.y;
      }
      this.airTicks++;
      this.airMaxY = Math.max(this.airMaxY, state.position.y);
    }
    this.wasGrounded = state.grounded;
  }

  endFrame(): void {
    const now = performance.now();
    if (now - this.lastDraw < REFRESH_MS) return;
    this.lastDraw = now;
    this.draw();
  }

  dispose(): void {
    this.element.remove();
  }

  private draw(): void {
    const s = this.player.current;
    const c = this.player.command;
    const list = (mask: number): string => actionsIn(mask).join(' ') || '—';
    const stance = s.crouched ? 'crouched' : 'standing';
    const gait = s.crouched ? 'crouch' : s.walking ? 'walk' : 'run';

    this.element.textContent = [
      'PLAYER (temporary debug)',
      `Tick      ${this.tick}`,
      `Position  x ${s.position.x.toFixed(3)}  y ${s.position.y.toFixed(3)}  z ${s.position.z.toFixed(3)}`,
      `Velocity  x ${signed(s.velocity.x, 3)}  y ${signed(s.velocity.y, 3)}  z ${signed(s.velocity.z, 3)}`,
      `Speed     ${horizontalSpeed(s).toFixed(2)} m/s  (max 1 s ${Math.max(0, ...this.speeds).toFixed(2)})`,
      `State     ${s.grounded ? 'grounded' : 'airborne'}  ${stance}  ${gait}  stamina ${s.stamina.toFixed(2)}`,
      `Eye       ${eyeHeight(s, this.config).toFixed(3)} m  (crouch ${s.crouchAmount.toFixed(2)})`,
      `View      yaw ${signed(s.yaw * DEGREES_PER_RADIAN, 2)}°  pitch ${signed(s.pitch * DEGREES_PER_RADIAN, 2)}°`,
      `Command   move ${signed(c?.moveX ?? 0, 2)} ${signed(c?.moveY ?? 0, 2)}  held ${list(c?.held ?? 0)}  pressed ${list(c?.pressed ?? 0)}`,
      `Last air  ${this.lastAir ? `apex ${signed(this.lastAir.apex, 3)} m  ${this.lastAir.seconds.toFixed(3)} s` : '—'}`,
    ].join('\n');
  }
}
