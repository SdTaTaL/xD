import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  type BufferGeometry,
  type Material,
} from 'three/webgpu';
import { color, float, length, saturate, uv } from 'three/tsl';
import { clamp } from '@shared/math/scalar';
import type { ViewAngles } from '@shared/player/look';
import { horizontalSpeed, type PlayerState } from '@shared/player/PlayerState';
import type { Shot } from '@shared/weapons/WeaponController';
import type { WeaponDefinition } from '@shared/weapons/WeaponDefinition';
import type { WeaponState } from '@shared/weapons/WeaponState';
import type { FrameContext, GameSystem } from '../core/GameSystem';
import type { RenderLayer } from '../rendering/GameRenderer';

/** The simulated player and weapon the model follows. */
export interface ViewModelSource {
  readonly current: PlayerState;
  readonly weapon: WeaponState;
  onShot(listener: (shot: Shot) => void): () => void;
}

export interface WeaponViewModelOptions {
  readonly source: ViewModelSource;
  readonly weapon: WeaponDefinition;
  /** The view shown this frame (for sway). */
  readonly view: { readonly view: ViewAngles };
  /** Horizontal field of view at 4:3, degrees (CS2 `viewmodel_fov`). */
  readonly fovDegrees: number;
}

/**
 * Rest pose of the weapon in view space: low on the right with the back of
 * the receiver below the screen edge, angled so the barrel converges towards
 * the crosshair (the viewer sees its left side, magazine and handguard).
 */
const REST_POSITION = { x: 0.12, y: -0.168, z: -0.3 };
const REST_PITCH = 0.075;
const REST_YAW = 0.065;

/** Muzzle flash visibility after a shot, seconds. */
const FLASH_SECONDS = 0.035;
/** Kick per shot (backwards, meters; muzzle up, radians), and how fast it settles (1/s). */
const KICK_BACK = 0.022;
const KICK_PITCH = 0.03;
const KICK_RECOVERY = 16;
/** Walking bob: cycles per meter travelled, and amplitude at full weapon speed (meters). */
const BOB_CYCLES_PER_METER = 0.55;
const BOB_AMPLITUDE = 0.0045;
/** Sway: lag behind view rotation (fraction), its limit (radians) and settling rate (1/s). */
const SWAY_FACTOR = 0.35;
const SWAY_LIMIT = 0.05;
const SWAY_RECOVERY = 9;

const TAU = Math.PI * 2;
const GOLDEN_ANGLE = 2.399963229728653;

/** Piecewise easing of the reload: tilt in, hold, tilt back out. */
function reloadTilt(progress: number): number {
  if (progress <= 0 || progress >= 1) return 0;
  const inOut = progress < 0.15 ? progress / 0.15 : progress > 0.85 ? (1 - progress) / 0.15 : 1;
  return MathUtils.smootherstep(inOut, 0, 1);
}

/** Magazine drop during a reload: out between 20 % and 35 %, back in between 50 % and 70 % (meters below its seat). */
function magazineDrop(progress: number): number {
  if (progress <= 0.2 || progress >= 0.7) return 0;
  if (progress < 0.35) return MathUtils.smoothstep(progress, 0.2, 0.35) * 0.35;
  if (progress < 0.5) return 0.35;
  return (1 - MathUtils.smoothstep(progress, 0.5, 0.7)) * 0.35;
}

/**
 * First-person weapon model: a graybox AK built from boxes and cylinders (no
 * external assets), drawn in its own layer (scene + camera) over the world,
 * so it never clips into walls and keeps CS's separate viewmodel FOV.
 *
 * Presentation only. Animations: shot kick and muzzle flash, walking bob,
 * sway behind the view, and a reload that tilts the weapon and swaps the
 * magazine.
 */
export class WeaponViewModel implements GameSystem {
  readonly name = 'weapon-view-model';
  readonly layer: RenderLayer;

  private readonly source: ViewModelSource;
  private readonly weapon: WeaponDefinition;
  private readonly view: { readonly view: ViewAngles };
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly root = new Group();
  private readonly gun = new Group();
  private readonly magazine = new Group();
  private readonly flash = new Group();
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private readonly unsubscribe: () => void;

  private kick = 0;
  private sinceShot = Infinity;
  /** A shot happened since the last frame: show it fully once before it starts fading. */
  private freshShot = false;
  private bobPhase = 0;
  private swayYaw = 0;
  private swayPitch = 0;
  private lastView: ViewAngles | null = null;
  private disposed = false;

  constructor(options: WeaponViewModelOptions) {
    this.source = options.source;
    this.weapon = options.weapon;
    this.view = options.view;

    const verticalFov = MathUtils.radToDeg(2 * Math.atan(Math.tan(MathUtils.degToRad(options.fovDegrees) / 2) * (3 / 4)));
    this.camera = new PerspectiveCamera(verticalFov, 16 / 9, 0.01, 5);
    this.layer = { scene: this.scene, camera: this.camera };

    this.scene.name = 'view-model';
    // Fill from the sky, key light from above and behind the viewer: the faces the player sees are lit.
    const sky = new HemisphereLight(0xdfeaf5, 0x4a4238, 1.6);
    const key = new DirectionalLight(0xfff1dc, 2.4);
    key.position.set(-0.5, 1, 0.8);
    this.scene.add(sky, key, this.camera);

    this.buildGun();
    this.buildFlash();
    this.root.add(this.gun);
    this.camera.add(this.root);

    this.unsubscribe = this.source.onShot((shot) => {
      this.kick = Math.min(this.kick + 1, 1.6);
      this.freshShot = true;
      this.flash.rotation.z = (shot.tick * GOLDEN_ANGLE) % TAU;
      this.flash.scale.setScalar(0.85 + ((shot.tick * 0.37) % 0.3));
    });
    this.place(0);
  }

  update(frame: FrameContext): void {
    this.place(frame.deltaSeconds);
  }

  /** Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.scene.clear();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
  }

  private place(dt: number): void {
    const player = this.source.current;
    const weaponState = this.source.weapon;

    // Kick and flash. A shot fired during this frame's ticks is drawn at full
    // strength first, however long the frame was (at 20 FPS a 35 ms flash
    // would otherwise never be seen).
    if (this.freshShot) {
      this.freshShot = false;
      this.sinceShot = 0;
    } else {
      this.kick *= Math.exp(-KICK_RECOVERY * dt);
      this.sinceShot += dt;
    }
    this.flash.visible = this.sinceShot < FLASH_SECONDS;

    // Bob with the distance walked on the ground.
    const speed = player.grounded ? horizontalSpeed(player) : 0;
    const speedFraction = clamp(speed / this.weapon.maxSpeed, 0, 1);
    this.bobPhase = (this.bobPhase + speed * dt * BOB_CYCLES_PER_METER * TAU) % TAU;
    const bobX = Math.sin(this.bobPhase) * BOB_AMPLITUDE * speedFraction;
    const bobY = -Math.abs(Math.cos(this.bobPhase)) * BOB_AMPLITUDE * speedFraction;

    // Sway: lag behind the view's rotation, then settle.
    const view = this.view.view;
    if (this.lastView) {
      this.swayYaw = clamp(this.swayYaw - (view.yaw - this.lastView.yaw) * SWAY_FACTOR, -SWAY_LIMIT, SWAY_LIMIT);
      this.swayPitch = clamp(this.swayPitch - (view.pitch - this.lastView.pitch) * SWAY_FACTOR, -SWAY_LIMIT, SWAY_LIMIT);
    }
    this.lastView = view;
    const settle = Math.exp(-SWAY_RECOVERY * dt);
    this.swayYaw *= settle;
    this.swayPitch *= settle;

    // Reload.
    const progress = weaponState.reloadRemaining > 0 ? 1 - weaponState.reloadRemaining / this.weapon.reloadSeconds : 0;
    const tilt = reloadTilt(progress);
    this.magazine.position.y = -magazineDrop(progress);
    this.magazine.visible = magazineDrop(progress) < 0.3;

    this.root.position.set(
      REST_POSITION.x + bobX,
      REST_POSITION.y + bobY - tilt * 0.035 + (player.grounded ? 0 : clamp(-player.velocity.y * 0.002, -0.012, 0.012)),
      REST_POSITION.z + this.kick * KICK_BACK,
    );
    this.root.rotation.set(REST_PITCH + this.kick * KICK_PITCH - tilt * 0.25 - this.swayPitch, REST_YAW - this.swayYaw, tilt * 0.45, 'YXZ');
  }

  private material(hex: number, roughness: number, metalness: number): MeshStandardNodeMaterial {
    const material = new MeshStandardNodeMaterial({ roughness, metalness });
    material.colorNode = color(new Color(hex));
    this.materials.push(material);
    return material;
  }

  private part(parent: Group, geometry: BufferGeometry, material: Material, x: number, y: number, z: number, rotationX = 0): Mesh {
    this.geometries.push(geometry);
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.rotation.x = rotationX;
    parent.add(mesh);
    return mesh;
  }

  /** AK silhouette in gun space: origin at the pistol grip, barrel towards −Z. Real proportions, meters. */
  private buildGun(): void {
    // Graybox colours; metalness stays low because there is no environment map to reflect.
    const steel = this.material(0x6c7076, 0.55, 0.05);
    const darkSteel = this.material(0x4b4e53, 0.6, 0.05);
    const wood = this.material(0x9a5428, 0.7, 0);
    const box = (w: number, h: number, d: number): BoxGeometry => new BoxGeometry(w, h, d);
    const barrel = (radius: number, length: number): CylinderGeometry => new CylinderGeometry(radius, radius, length, 12);

    this.part(this.gun, box(0.046, 0.068, 0.34), steel, 0, 0, -0.12); // receiver
    this.part(this.gun, box(0.04, 0.014, 0.3), darkSteel, 0, 0.04, -0.11); // dust cover
    this.part(this.gun, box(0.03, 0.022, 0.04), darkSteel, 0, 0.05, -0.28); // rear sight block
    this.part(this.gun, box(0.054, 0.058, 0.22), wood, 0, -0.004, -0.4); // lower handguard
    this.part(this.gun, box(0.036, 0.03, 0.2), wood, 0, 0.044, -0.39); // gas tube cover
    this.part(this.gun, barrel(0.0105, 0.3), darkSteel, 0, 0.01, -0.64, Math.PI / 2); // barrel
    this.part(this.gun, barrel(0.008, 0.16), darkSteel, 0, 0.044, -0.56, Math.PI / 2); // gas tube
    this.part(this.gun, box(0.018, 0.05, 0.028), darkSteel, 0, 0.034, -0.72); // front sight
    this.part(this.gun, barrel(0.0145, 0.05), darkSteel, 0, 0.01, -0.8, Math.PI / 2); // muzzle brake
    this.part(this.gun, box(0.034, 0.1, 0.045), wood, 0, -0.07, 0.02, -0.3); // pistol grip
    this.part(this.gun, box(0.008, 0.012, 0.075), darkSteel, 0, -0.042, -0.04); // trigger guard
    this.part(this.gun, box(0.04, 0.07, 0.26), wood, 0, -0.035, 0.17, -0.12); // stock

    // Curved magazine: three segments bending forward.
    this.part(this.magazine, box(0.032, 0.09, 0.07), steel, 0, -0.075, -0.16, 0.12);
    this.part(this.magazine, box(0.032, 0.085, 0.07), steel, 0, -0.155, -0.18, 0.3);
    this.part(this.magazine, box(0.032, 0.08, 0.068), steel, 0, -0.227, -0.215, 0.48);
    this.gun.add(this.magazine);
  }

  /** Three crossed additive quads at the muzzle, bright in the centre and fading out. */
  private buildFlash(): void {
    const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide });
    const falloff = saturate(float(1).sub(length(uv().sub(0.5)).mul(2)));
    material.colorNode = color(new Color(1, 0.72, 0.32)).mul(falloff.pow(1.5).mul(2.2));
    material.opacityNode = falloff;
    this.materials.push(material);

    const quad = new PlaneGeometry(0.15, 0.15);
    this.geometries.push(quad);
    const facing = new Mesh(quad, material);
    const side = new Mesh(quad, material);
    side.rotation.y = Math.PI / 2;
    side.scale.set(1.6, 0.55, 1);
    const top = new Mesh(quad, material);
    top.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    top.scale.set(1.6, 0.55, 1);
    this.flash.add(facing, side, top);
    this.flash.position.set(0, 0.01, -0.86);
    this.flash.visible = false;
    this.gun.add(this.flash);
  }
}
