// tslint:disable
/* eslint-disable */
/** 3D Vector. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 3D Position as a tuple. */
export type Position3D = [number, number, number];

/** Represents an object in the 3D scene. */
export interface Entity3D {
  id: string | number;
  type?: string;
  position: Vec3 | Position3D;
  rotation?: Vec3 | Position3D;
  scale?: Vec3 | Position3D;
  velocity?: Vec3;
  active?: boolean;
  [key: string]: any;
}

/** Represents a particle in a particle system. */
export interface Particle {
  id: string | number;
  position: Vec3 | Position3D;
  velocity?: Vec3 | Position3D;
  life: number;
  maxLife: number;
  color?: string;
  size?: number;
  [key: string]: any;
}

export type CharacterStyle = 'streetwear' | 'tycoon';

export interface PlayerState {
  id: number;
  name: string;
  character: CharacterStyle;
  cash: number;
  position: number;
  inJail: boolean;
  jailTurnsRemaining: number;
  justReleased: boolean;
  color: string;
  isAi: boolean;
  netWorth: number;
  propertiesCount: number;
  ownedSpaces: number[];
}

export interface PropertyOwnership {
  ownerId: number | null; // 0 for Player 1 (Streetwear), 1 for Player 2 (Tycoon), null for unowned
  upgradeLevel: number;
}

export interface CharacterCalibration {
  posX: number;
  posY: number;
  posZ: number;
  scale: number;
  rotY: number;
  rotX: number;
  rotZ: number;
  selectedAnimation: string;
  isPlayingAnimation: boolean;
  showTable: boolean;
  showChairs: boolean;
  showBuildings: boolean;
  showBoard: boolean;
  showBoundingBox: boolean;
  showAxisHelper: boolean;
}

export type CameraViewMode =
  | 'OVERVIEW'
  | 'PREPARE_ROLL'
  | 'DICE'
  | 'FOLLOW_CHARACTER'
  | 'PROPERTY'
  | 'JAIL'
  | 'CALIBRATION';

export type GameplayPhase =
  | 'WAITING_FOR_ROLL'
  | 'PREPARE_THROW'
  | 'DICE_ANIMATING'
  | 'CHARACTER_MOVING'
  | 'LANDING_EVENT'
  | 'JAIL_EVENT'
  | 'TURN_TRANSITION'
  | 'GAME_OVER';

export interface JailEventState {
  active: boolean;
  playerIndex: number;
  phase: 'INACTIVE' | 'RISING' | 'CHARACTER_INSIDE' | 'RETRACTING';
  progress: number; // 0..1
}

export interface FloatingText {
  id: string;
  text: string;
  position: [number, number, number];
  color: string;
  life: number;
}
