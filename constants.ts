import {MusicTrack} from './utils/helper';

export interface BoardSpaceConfig {
  id: number;
  name: string;
  district: string;
  type: 'property' | 'corner' | 'opportunity' | 'chest' | 'tax' | 'transit';
  baseRent?: number;
  price?: number;
  color: string;
  desc?: string;
}

export const DISTRICT_RENTS: Record<string, number> = {
  'THE BLOCK': 100,
  'THE MARKET': 150,
  'THE STRIP': 200,
  'ENTERTAINMENT': 250,
  'INDUSTRIAL': 300,
  'DOWNTOWN': 350,
  'BUSINESS': 400,
  'LUXURY HEIGHTS': 500,
  'TRANSIT': 200,
};

export const BOARD_SPACES: BoardSpaceConfig[] = [
  // Bottom row (0 to 7): moving from Corner 0 to Corner 8 (+X direction, Z = +8.8)
  { id: 0, name: 'START THE HUSTLE', district: 'CORNER', type: 'corner', color: '#10b981', desc: 'Collect $200 stipend whenever you pass or land here.' },
  { id: 1, name: '125th Brownstone', district: 'THE BLOCK', type: 'property', baseRent: 100, price: 200, color: '#8b4513' },
  { id: 2, name: 'Community Chest', district: 'SPECIAL', type: 'chest', color: '#f59e0b', desc: 'Draw a neighborhood windfall or grant!' },
  { id: 3, name: 'Lenox Ave Bodega', district: 'THE BLOCK', type: 'property', baseRent: 100, price: 240, color: '#8b4513' },
  { id: 4, name: 'City Tax Levy', district: 'SPECIAL', type: 'tax', price: 150, color: '#ef4444', desc: 'Pay $150 municipal business surcharge.' },
  { id: 5, name: 'Metro Express Line', district: 'TRANSIT', type: 'transit', baseRent: 200, price: 300, color: '#64748b' },
  { id: 6, name: 'Canal St Storefront', district: 'DOWNTOWN', type: 'property', baseRent: 350, price: 320, color: '#0ea5e9' },
  { id: 7, name: 'Hustle Opportunity', district: 'SPECIAL', type: 'opportunity', color: '#ec4899', desc: 'High stakes business pitch or lucky reward!' },

  // Right column (8 to 15): moving (-Z direction, X = +8.8)
  { id: 8, name: 'NYC JAIL & COURT', district: 'JAIL', type: 'corner', color: '#64748b', desc: 'NYC Correctional Facility. Jailed players miss 1 turn.' },
  { id: 9, name: 'Fulton Street Mall', district: 'DOWNTOWN', type: 'property', baseRent: 350, price: 360, color: '#0ea5e9' },
  { id: 10, name: 'Apollo Recording Studio', district: 'ENTERTAINMENT', type: 'property', baseRent: 250, price: 420, color: '#8b5cf6' },
  { id: 11, name: 'Community Chest', district: 'SPECIAL', type: 'chest', color: '#f59e0b', desc: 'Draw a local hustle windfall.' },
  { id: 12, name: 'Apollo Live Theater', district: 'ENTERTAINMENT', type: 'property', baseRent: 250, price: 480, color: '#8b5cf6' },
  { id: 13, name: 'Grand Central Hub', district: 'TRANSIT', type: 'transit', baseRent: 200, price: 300, color: '#64748b' },
  { id: 14, name: 'Sunset Strip Lounge', district: 'THE STRIP', type: 'property', baseRent: 200, price: 520, color: '#f97316' },
  { id: 15, name: 'Neon Boulevard Club', district: 'THE STRIP', type: 'property', baseRent: 200, price: 560, color: '#f97316' },

  // Top row (16 to 23): moving (-X direction, Z = -8.8)
  { id: 16, name: 'CITY BREAK', district: 'CORNER', type: 'corner', color: '#06b6d4', desc: 'Free rooftop parking & skyline lounge.' },
  { id: 17, name: 'Red Hook Warehouse', district: 'INDUSTRIAL', type: 'property', baseRent: 300, price: 600, color: '#eab308' },
  { id: 18, name: 'Hustle Opportunity', district: 'SPECIAL', type: 'opportunity', color: '#ec4899', desc: 'Take a venture gamble or score big!' },
  { id: 19, name: 'Foundry Depot & Gas', district: 'INDUSTRIAL', type: 'property', baseRent: 300, price: 640, color: '#eab308' },
  { id: 20, name: 'Crosstown Subway', district: 'TRANSIT', type: 'transit', baseRent: 200, price: 300, color: '#64748b' },
  { id: 21, name: 'Chelsea Flea Market', district: 'THE MARKET', type: 'property', baseRent: 150, price: 680, color: '#14b8a6' },
  { id: 22, name: 'Union Square Bazaar', district: 'THE MARKET', type: 'property', baseRent: 150, price: 720, color: '#14b8a6' },
  { id: 23, name: 'Luxury Sales Tax', district: 'SPECIAL', type: 'tax', price: 200, color: '#ef4444', desc: 'Pay $200 luxury surcharge.' },

  // Left column (24 to 31): moving (+Z direction, X = -8.8)
  { id: 24, name: 'GO TO JAIL', district: 'CORNER', type: 'corner', color: '#dc2626', desc: 'Audited & arrested! Sent directly behind jail bars.' },
  { id: 25, name: 'Wall St Banking Plaza', district: 'BUSINESS', type: 'property', baseRent: 400, price: 760, color: '#3b82f6' },
  { id: 26, name: 'Empire Financial Tower', district: 'BUSINESS', type: 'property', baseRent: 400, price: 800, color: '#3b82f6' },
  { id: 27, name: 'Community Chest', district: 'SPECIAL', type: 'chest', color: '#f59e0b', desc: 'Draw a city investment grant.' },
  { id: 28, name: 'Skyline Heliport', district: 'TRANSIT', type: 'transit', baseRent: 200, price: 300, color: '#64748b' },
  { id: 29, name: 'Hustle Opportunity', district: 'SPECIAL', type: 'opportunity', color: '#ec4899', desc: 'Draw an urban entrepreneur card.' },
  { id: 30, name: 'Park Ave Penthouse', district: 'LUXURY HEIGHTS', type: 'property', baseRent: 500, price: 900, color: '#a855f7' },
  { id: 31, name: 'Billionaires Row Estate', district: 'LUXURY HEIGHTS', type: 'property', baseRent: 500, price: 1000, color: '#a855f7' },
];

export const OPPORTUNITY_CARDS = [
  { title: 'Viral Music Drop', text: 'Your studio single goes multi-platinum! Collect $350 royalties.', cash: 350 },
  { title: 'Building Code Violation', text: 'Fire escape maintenance required. Pay $150 city fee.', cash: -150 },
  { title: 'Angel Investment', text: 'A private equity venture funds your label. Collect $450.', cash: 450 },
  { title: 'VIP Nightclub Takeover', text: 'Sellout weekend crowd on the strip! Collect $250.', cash: 250 },
  { title: 'City Renovation Grant', text: 'Municipal revitalization award approved! Collect $300.', cash: 300 },
];

export const CHEST_CARDS = [
  { title: 'Tax Refund Windfall', text: 'State revenue department sends overpayment check. Collect $250.', cash: 250 },
  { title: 'Block Party Merch Sales', text: 'Pop-up truck cleans up on 125th St! Collect $200.', cash: 200 },
  { title: 'Plumbing Repair Bill', text: 'Brownstone boiler maintenance overhead. Pay $120.', cash: -120 },
  { title: 'Community Leadership Award', text: 'Harlem business council honors your hustle. Collect $200.', cash: 200 },
];

/** Game configuration schema. */
export const CONFIG = {
  // --- Game ---
  title: {
    value: 'HUSTLE CITY 3D',
    type: 'string',
    label: 'Game Title',
    group: 'Game',
  },
  startingCash: {
    value: 5000,
    type: 'number',
    label: 'Starting Cash ($)',
    group: 'Rules',
    min: 2000,
    max: 10000,
    step: 500,
  },
  passGoReward: {
    value: 200,
    type: 'number',
    label: 'Pass Go Reward ($)',
    group: 'Rules',
    min: 100,
    max: 500,
    step: 50,
  },
  targetNetWorthToWin: {
    value: 25000,
    type: 'number',
    label: 'Win Net Worth ($)',
    group: 'Rules',
    min: 15000,
    max: 50000,
    step: 2500,
  },

  // --- Camera ---
  fov: {
    value: 45,
    type: 'number',
    label: 'Field of View',
    group: 'Camera',
    min: 30,
    max: 75,
    step: 1,
  },
  cameraX: {
    value: -21.5,
    type: 'number',
    label: 'Default Camera X (Side View)',
    group: 'Camera',
  },
  cameraY: {
    value: 12.0,
    type: 'number',
    label: 'Default Camera Y',
    group: 'Camera',
  },
  cameraZ: {
    value: 0.0,
    type: 'number',
    label: 'Default Camera Z',
    group: 'Camera',
  },

  // --- Visuals ---
  characterModelUrl: {
    value: 'https://judahgamesinc.github.io/hustlecity-assets/MrTalkofNY_Sitting_Animated_ScaleFixed.glb',
    type: 'string',
    label: 'Human Character Model GLB',
    group: 'Visuals',
  },
  backgroundColor: {
    value: '#0b1329',
    type: 'color',
    label: 'Sky / Background',
    group: 'Visuals',
  },
  ambientColor: {
    value: '#fff1e6',
    type: 'color',
    label: 'Ambient Light Color',
    group: 'Visuals',
  },
  ambientIntensity: {
    value: 1.9,
    type: 'number',
    label: 'Ambient Intensity',
    group: 'Visuals',
    min: 0.5,
    max: 4.0,
    step: 0.1,
  },
  sunColor: {
    value: '#ffedd5',
    type: 'color',
    label: 'Sun Light Color',
    group: 'Visuals',
  },
  sunIntensity: {
    value: 4.8,
    type: 'number',
    label: 'Sun Intensity',
    group: 'Visuals',
    min: 1.0,
    max: 8.0,
    step: 0.2,
  },
  hemiSkyColor: {
    value: '#fed7aa',
    type: 'color',
    label: 'Hemisphere Sky Color',
    group: 'Visuals',
  },
  hemiGroundColor: {
    value: '#78350f',
    type: 'color',
    label: 'Hemisphere Ground Color',
    group: 'Visuals',
  },
  hemiIntensity: {
    value: 1.5,
    type: 'number',
    label: 'Hemisphere Intensity',
    group: 'Visuals',
    min: 0.2,
    max: 3.0,
    step: 0.1,
  },

  // --- Physics ---
  gravity: {
    value: -26.0,
    type: 'number',
    label: 'Dice Gravity',
    group: 'Physics',
    min: -40,
    max: -10,
    step: 1,
  },

  // --- System ---
  targetFPS: {
    value: 60,
    type: 'number',
    label: 'Target FPS',
    group: 'System',
  },
  stepMs: {
    value: 1000 / 60,
    type: 'number',
    label: 'Step MS',
    group: 'System',
  },
  maxSubSteps: {
    value: 5,
    type: 'number',
    label: 'Max Sub Steps',
    group: 'System',
  },

  // --- Audio ---
  backgroundMusicUrl: {
    value: '/audio/background.instrumental.effect.mp3',
    type: 'string',
    label: 'Background Music URL',
    group: 'Audio',
  },
};

// Merge customized config values if present (injected by Playground)
const {playgroundConfig} = globalThis as {
  playgroundConfig?: Record<string, unknown>;
};
if (playgroundConfig) {
  for (const [key, value] of Object.entries(playgroundConfig)) {
    if (key in CONFIG) {
      Object.assign(CONFIG[key as keyof typeof CONFIG], {value});
    }
  }
}

/** Type helper for reading values in game code. */
export type ConfigKey = keyof typeof CONFIG;

/**
 * Gets a configuration value by key.
 * @param key The configuration key.
 * @return The configuration value.
 */
export function getConfig<K extends ConfigKey>(
  key: K,
): (typeof CONFIG)[K]['value'] {
  return CONFIG[key].value;
}

export const PRESETS = {};

/** Background music tracks available for the game to use. */
export const AVAILABLE_MUSIC_TRACKS: readonly MusicTrack[] = [
  {
    name: 'background_instrumental',
    url: '/audio/background.instrumental.effect.mp3',
    description: 'User-provided gameplay background instrumental.',
  },
];
