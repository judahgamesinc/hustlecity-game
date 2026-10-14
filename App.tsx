// tslint:disable
/* eslint-disable */
import React, { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import {
  BOARD_SPACES,
  BoardSpaceConfig,
  DISTRICT_RENTS,
  OPPORTUNITY_CARDS,
  CHEST_CARDS,
  getConfig,
} from './constants';
import GameScene from './Game';
import {
  PlayerState,
  PropertyOwnership,
  CameraViewMode,
  FloatingText,
  GameplayPhase,
  JailEventState,
  CharacterCalibration,
} from './types';
import {
  gameAudio,
  MenuOverlay,
  Overlay,
  useIsMobile,
} from './utils';
import BackgroundMusic from './utils/BackgroundMusic';
import { usePlayground, usePlaygroundGameLifecycle } from './utils/usePlayground';
import {
  Zap,
  RotateCw,
  Trophy,
  Volume2,
  VolumeX,
  Play,
  Info,
  Home,
  Gamepad,
  ShieldAlert,
  Building2,
  Camera,
  Settings,
  Sliders,
  Eye,
  EyeOff,
  Check,
  RefreshCw,
} from 'lucide-react';

interface GameState {
  status: 'START' | 'PLAYING' | 'PAUSED' | 'GAME_OVER' | 'VICTORY';
  score: number;
  level: number;
}

const DEFAULT_CALIBRATION: CharacterCalibration = {
  posX: -0.4,
  posY: -3.1,
  posZ: 16.3,
  scale: 11.6,
  rotY: 2.05840734641021,
  rotX: 0,
  rotZ: 0,
  selectedAnimation: '',
  isPlayingAnimation: true,
  showTable: true,
  showChairs: true,
  showBuildings: true,
  showBoard: true,
  showBoundingBox: false,
  showAxisHelper: false,
};

function loadSavedCalibration(): CharacterCalibration {
  if (typeof window === 'undefined') return DEFAULT_CALIBRATION;
  try {
    const raw = localStorage.getItem('hustlecity_character_calibration_v2');
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_CALIBRATION, ...parsed };
    }
    // Clean up outdated v1 key
    localStorage.removeItem('hustlecity_character_calibration');
  } catch (e) {
    console.warn('Could not load saved calibration', e);
  }
  return DEFAULT_CALIBRATION;
}

export default function App() {
  const { sdk } = usePlayground();
  const isMobile = useIsMobile();

  // Core Lifecycle
  const [gameState, setGameState] = useState<GameState>({
    status: 'START',
    score: 5000,
    level: 1,
  });
  usePlaygroundGameLifecycle(gameState, sdk);

  // Settings & Overlays
  const [isGameMenuOpen, setIsGameMenuOpen] = useState(false);
  const [isHowToPlayOpen, setIsHowToPlayOpen] = useState(false);
  const [isCalibrationOpen, setIsCalibrationOpen] = useState(false);
  const [isMusicMuted, setIsMusicMuted] = useState(false);
  const [isSfxMuted, setIsSfxMuted] = useState(false);
  // Intro audio plays once when a new game is started; gameplay music waits until it ends.
  const introAudioRef = useRef<HTMLAudioElement | null>(null);
  const [introFinished, setIntroFinished] = useState(false);

  // Character Calibration State
  const [calibration, setCalibration] = useState<CharacterCalibration>(loadSavedCalibration);
  const [modelDiagnosticInfo, setModelDiagnosticInfo] = useState<{
    status: 'loaded' | 'error' | 'loading';
    animations: string[];
    meshCount: number;
    rawBox: { x: number; y: number; z: number };
    center: { x: number; y: number; z: number };
    materialInfo?: string;
  }>({
    status: 'loading',
    animations: [],
    meshCount: 0,
    rawBox: { x: 0, y: 0, z: 0 },
    center: { x: 0, y: 0, z: 0 },
    materialInfo: '',
  });

  // Strict Two-Character State
  const [players, setPlayers] = useState<PlayerState[]>([
    {
      id: 0,
      name: 'Entrepreneur',
      character: 'streetwear',
      cash: 5000,
      position: 0,
      inJail: false,
      jailTurnsRemaining: 0,
      justReleased: false,
      color: '#38bdf8',
      isAi: false,
      netWorth: 5000,
      propertiesCount: 0,
      ownedSpaces: [],
    },
    {
      id: 1,
      name: 'Tycoon AI',
      character: 'tycoon',
      cash: 5000,
      position: 16,
      inJail: false,
      jailTurnsRemaining: 0,
      justReleased: false,
      color: '#fbbf24',
      isAi: true,
      netWorth: 5000,
      propertiesCount: 0,
      ownedSpaces: [],
    },
  ]);

  const [currentPlayerIndex, setCurrentPlayerIndex] = useState(0);
  const [properties, setProperties] = useState<Record<number, PropertyOwnership>>({});
  const [selectedSpaceIndex, setSelectedSpaceIndex] = useState(0);
  const [cameraMode, setCameraMode] = useState<CameraViewMode>('OVERVIEW');
  const [phase, setPhase] = useState<GameplayPhase>('WAITING_FOR_ROLL');
  const [turnHistory, setTurnHistory] = useState<string[]>([
    'Welcome to Hustle City 3D! Roll the dice to claim properties and beware the Tycoon Chaser.',
  ]);

  // Dice State
  const [diceRoll, setDiceRoll] = useState({
    d1: 1,
    d2: 1,
    total: 2,
    rollId: 0,
    isRolling: false,
  });
  const [throwProgress, setThrowProgress] = useState(0);

  // Pop-Up Jail Building Event State Machine
  const [jailEvent, setJailEvent] = useState<JailEventState>({
    active: false,
    playerIndex: 0,
    phase: 'INACTIVE',
    progress: 0,
  });

  // Modal & Notification Banners
  const [cardModal, setCardModal] = useState<{ title: string; text: string; type: 'opportunity' | 'chest' } | null>(null);
  const [notificationBanner, setNotificationBanner] = useState<string | null>(null);
  const [floatingTexts, setFloatingTexts] = useState<FloatingText[]>([]);

  // Timer Ref for movement intervals to prevent memory leaks or duplicate steps
  const moveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const turnTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jailAnimIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sync window back key handler
  useEffect(() => {
    (window as unknown as Record<string, unknown>).canHandleBackKey = ['PLAYING', 'PAUSED'].includes(gameState.status);
  }, [gameState.status]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (moveIntervalRef.current) clearInterval(moveIntervalRef.current);
      if (turnTimeoutRef.current) clearTimeout(turnTimeoutRef.current);
      if (jailAnimIntervalRef.current) clearInterval(jailAnimIntervalRef.current);
      gameAudio.stopHipHopBeat();
    };
  }, []);

  // Add 3D Floating text notification
  const addFloatingText = (text: string, pos: [number, number, number], color = '#22c55e') => {
    const id = Math.random().toString();
    setFloatingTexts((prev) => [...prev, { id, text, position: pos, color, life: 2.0 }]);
    setTimeout(() => {
      setFloatingTexts((prev) => prev.filter((ft) => ft.id !== id));
    }, 2000);
  };

  const addHistory = (msg: string) => {
    setTurnHistory((prev) => [msg, ...prev.slice(0, 20)]);
  };

  const showBanner = (text: string, durationMs = 2200) => {
    setNotificationBanner(text);
    setTimeout(() => {
      setNotificationBanner((prev) => (prev === text ? null : prev));
    }, durationMs);
  };

  // Save Calibration to LocalStorage
  const handleSaveCalibration = () => {
    try {
      localStorage.setItem('hustlecity_character_calibration_v2', JSON.stringify(calibration));
      showBanner('✅ Character Placement Saved to Storage!', 2000);
      gameAudio.playConfirmSelect();
    } catch (e) {
      console.warn('Failed to save to localStorage', e);
    }
  };

  const handleResetCalibration = () => {
    setCalibration(DEFAULT_CALIBRATION);
    try {
      localStorage.removeItem('hustlecity_character_calibration_v2');
      localStorage.removeItem('hustlecity_character_calibration');
    } catch (e) {}
    showBanner('Placement Reset to Scale 1.0 & Default Seat', 1500);
    gameAudio.playCrispClick();
  };

  // Recalculate Net Worth
  const updateNetWorths = useCallback(
    (curPlayers: PlayerState[], curProps: Record<number, PropertyOwnership>) => {
      return curPlayers.map((p) => {
        let assetVal = 0;
        const owned: number[] = [];
        Object.entries(curProps).forEach(([sId, own]) => {
          if (own.ownerId === p.id) {
            const space = BOARD_SPACES[Number(sId)];
            assetVal += space.price || 300;
            owned.push(Number(sId));
          }
        });
        return {
          ...p,
          netWorth: p.cash + assetVal,
          propertiesCount: owned.length,
          ownedSpaces: owned,
        };
      });
    },
    []
  );

  // Initialize a new game
  const handleStartGame = () => {
    if (moveIntervalRef.current) clearInterval(moveIntervalRef.current);
    if (turnTimeoutRef.current) clearTimeout(turnTimeoutRef.current);
    if (jailAnimIntervalRef.current) clearInterval(jailAnimIntervalRef.current);

    const startCash = getConfig('startingCash');
    setPlayers([
      {
        id: 0,
        name: 'Entrepreneur',
        character: 'streetwear',
        cash: startCash,
        position: 0,
        inJail: false,
        jailTurnsRemaining: 0,
        justReleased: false,
        color: '#38bdf8',
        isAi: false,
        netWorth: startCash,
        propertiesCount: 0,
        ownedSpaces: [],
      },
      {
        id: 1,
        name: 'Tycoon AI',
        character: 'tycoon',
        cash: startCash,
        position: 16,
        inJail: false,
        jailTurnsRemaining: 0,
        justReleased: false,
        color: '#fbbf24',
        isAi: true,
        netWorth: startCash,
        propertiesCount: 0,
        ownedSpaces: [],
      },
    ]);
    setProperties({});
    setCurrentPlayerIndex(0);
    setSelectedSpaceIndex(0);
    setCameraMode('OVERVIEW');
    setPhase('WAITING_FOR_ROLL');
    setJailEvent({ active: false, playerIndex: 0, phase: 'INACTIVE', progress: 0 });
    setIntroFinished(false);
    const introAudio = introAudioRef.current;
    if (introAudio) {
      introAudio.pause();
      introAudio.currentTime = 0;
      introAudio.play().catch(() => {
        // If playback is blocked or the file is unavailable, continue to gameplay music.
        setIntroFinished(true);
      });
    } else {
      setIntroFinished(true);
    }
    setGameState({ status: 'PLAYING', score: startCash, level: 1 });
    setIsGameMenuOpen(false);
    setIsHowToPlayOpen(false);
    setIsCalibrationOpen(false);
    addHistory('Game started! Roll dice to start building your empire.');
    gameAudio.playConfirmSelect();
    gameAudio.stopHipHopBeat();
    sdk.startGame();
  };

  const handleResetCamera = () => {
    setCameraMode('OVERVIEW');
    setSelectedSpaceIndex(players[currentPlayerIndex].position);
    gameAudio.playCrispClick();
    showBanner('Camera Reset to Side Overview', 1200);
  };

  // Trigger Dice Roll
  const handleRollDice = () => {
    if (phase !== 'WAITING_FOR_ROLL' || gameState.status !== 'PLAYING') return;

    const curPlayer = players[currentPlayerIndex];

    if (curPlayer.inJail) {
      showBanner(`${curPlayer.name} served 1 turn in jail and is released!`, 2500);
      addHistory(`${curPlayer.name} is released from jail.`);
      gameAudio.playLevelUpStinger();
      setPlayers((prev) =>
        prev.map((p, idx) =>
          idx === currentPlayerIndex
            ? { ...p, inJail: false, jailTurnsRemaining: 0, justReleased: true }
            : p
        )
      );

      setPhase('TURN_TRANSITION');
      turnTimeoutRef.current = setTimeout(() => {
        concludeTurn();
      }, 1500);
      return;
    }

    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;
    const total = d1 + d2;

    setDiceRoll({
      d1,
      d2,
      total,
      rollId: Date.now(),
      isRolling: true,
    });
    setThrowProgress(0);
    setPhase('PREPARE_THROW');
    setCameraMode('PREPARE_ROLL');
    gameAudio.playCrispClick();
    addHistory(`${curPlayer.name} preparing physical dice throw...`);

    const startT = Date.now();
    const throwDuration = 800;
    const throwInterval = setInterval(() => {
      const elapsed = Date.now() - startT;
      const progress = Math.min(1.0, elapsed / throwDuration);
      setThrowProgress(progress);

      if (progress >= 0.45) {
        setCameraMode('DICE');
      }

      if (progress >= 1.0) {
        clearInterval(throwInterval);
        setPhase('DICE_ANIMATING');
      }
    }, 25);
  };

  const handleDiceSettled = useCallback(() => {
    if (phase !== 'DICE_ANIMATING') return;

    const total = diceRoll.total;
    addHistory(`Dice settled: ${diceRoll.d1} + ${diceRoll.d2} = ${total}!`);
    showBanner(`Rolled ${diceRoll.d1} + ${diceRoll.d2} = ${total}!`, 1200);

    turnTimeoutRef.current = setTimeout(() => {
      setCameraMode('FOLLOW_CHARACTER');
      setPhase('CHARACTER_MOVING');

      let step = 0;
      const curPIndex = currentPlayerIndex;
      let curPos = players[curPIndex].position;

      moveIntervalRef.current = setInterval(() => {
        step += 1;
        curPos = (curPos + 1) % 32;

        if (curPos === 0 && step < total) {
          const passBonus = getConfig('passGoReward');
          setPlayers((prev) =>
            prev.map((p, idx) =>
              idx === curPIndex ? { ...p, cash: p.cash + passBonus } : p
            )
          );
          addFloatingText(`+$${passBonus} Passed Start!`, [0, 2.5, 8.8], '#22c55e');
          gameAudio.playCoinPickup();
          addHistory(`${players[curPIndex].name} passed START THE HUSTLE (+$${passBonus})!`);
        }

        setPlayers((prev) =>
          prev.map((p, idx) => (idx === curPIndex ? { ...p, position: curPos } : p))
        );
        setSelectedSpaceIndex(curPos);
        gameAudio.playJumpLandingThud();

        if (step >= total) {
          if (moveIntervalRef.current) clearInterval(moveIntervalRef.current);
          turnTimeoutRef.current = setTimeout(() => {
            handleLandOnSpace(curPos);
          }, 650);
        }
      }, 620);
    }, 900);
  }, [phase, diceRoll, currentPlayerIndex, players]);

  const handleLandOnSpace = (landIndex: number) => {
    const space = BOARD_SPACES[landIndex];
    const curPlayer = players[currentPlayerIndex];
    const opponentIndex = (currentPlayerIndex + 1) % 2;
    const opponent = players[opponentIndex];

    setSelectedSpaceIndex(landIndex);
    setCameraMode('PROPERTY');
    setPhase('LANDING_EVENT');
    addHistory(`${curPlayer.name} landed on ${space.name} [${space.district}].`);

    if (curPlayer.isAi && landIndex === opponent.position && !opponent.inJail && !opponent.justReleased) {
      gameAudio.playErrorBuzz();
      showBanner('🚨 CAUGHT BY TYCOON CHASER! GO TO JAIL!', 2500);
      addHistory(`🚨 ${opponent.name} was caught by ${curPlayer.name} and sent to NYC Jail!`);
      triggerJailCinematic(opponentIndex);
      return;
    }

    if (space.id === 0) {
      const bonus = getConfig('passGoReward');
      setPlayers((prev) =>
        prev.map((p, idx) =>
          idx === currentPlayerIndex ? { ...p, cash: p.cash + bonus } : p
        )
      );
      addFloatingText(`+$${bonus} Stipend!`, [0, 2.5, 8.8], '#22c55e');
      gameAudio.playLevelUpStinger();
      showBanner(`Landed on START THE HUSTLE! (+$${bonus})`);
      finishTurnResolution(1500);
      return;
    }

    if (space.id === 24) {
      addHistory(`${curPlayer.name} stepped on GO TO JAIL!`);
      showBanner('ARRESTED! SENT TO NYC JAIL', 2200);
      gameAudio.playErrorBuzz();
      triggerJailCinematic(currentPlayerIndex);
      return;
    }

    if (space.type === 'tax') {
      const taxFee = space.price || 150;
      setPlayers((prev) =>
        prev.map((p, idx) =>
          idx === currentPlayerIndex ? { ...p, cash: Math.max(0, p.cash - taxFee) } : p
        )
      );
      addFloatingText(`-$${taxFee} Tax`, [0, 2.5, 0], '#ef4444');
      gameAudio.playErrorBuzz();
      showBanner(`City Tax Levy: Paid $${taxFee}`);
      addHistory(`${curPlayer.name} paid $${taxFee} city surcharge.`);
      finishTurnResolution(1500);
      return;
    }

    if (space.type === 'opportunity') {
      const card = OPPORTUNITY_CARDS[Math.floor(Math.random() * OPPORTUNITY_CARDS.length)];
      setCardModal({ title: card.title, text: card.text, type: 'opportunity' });
      gameAudio.playPowerupChime();
      if (card.cash) {
        setPlayers((prev) =>
          prev.map((p, idx) =>
            idx === currentPlayerIndex ? { ...p, cash: Math.max(0, p.cash + card.cash!) } : p
          )
        );
        addFloatingText(
          `${card.cash > 0 ? '+' : ''}$${card.cash}`,
          [0, 2.5, 0],
          card.cash > 0 ? '#22c55e' : '#ef4444'
        );
      }
      return;
    }

    if (space.type === 'chest') {
      const card = CHEST_CARDS[Math.floor(Math.random() * CHEST_CARDS.length)];
      setCardModal({ title: card.title, text: card.text, type: 'chest' });
      gameAudio.playPowerupChime();
      if (card.cash) {
        setPlayers((prev) =>
          prev.map((p, idx) =>
            idx === currentPlayerIndex ? { ...p, cash: Math.max(0, p.cash + card.cash!) } : p
          )
        );
        addFloatingText(
          `${card.cash > 0 ? '+' : ''}$${card.cash}`,
          [0, 2.5, 0],
          card.cash > 0 ? '#22c55e' : '#ef4444'
        );
      }
      return;
    }

    if (space.type === 'corner') {
      showBanner(`Visiting ${space.name}`);
      finishTurnResolution(1200);
      return;
    }

    if (space.type === 'property' || space.type === 'transit') {
      const ownership = properties[landIndex];

      if (!ownership || ownership.ownerId === null) {
        const newProps = {
          ...properties,
          [landIndex]: { ownerId: currentPlayerIndex, upgradeLevel: 0 },
        };
        setProperties(newProps);
        setPlayers((prev) => updateNetWorths(prev, newProps));

        gameAudio.playConfirmSelect();
        addFloatingText(`CLAIMED ${space.name}!`, [0, 2.5, 0], curPlayer.color);
        showBanner(`Property Claimed: ${space.name}!`);
        addHistory(`${curPlayer.name} automatically claimed ${space.name} [${space.district}]!`);
        finishTurnResolution(1500);
        return;
      }

      if (ownership.ownerId === opponentIndex) {
        const districtRent = DISTRICT_RENTS[space.district] || space.baseRent || 150;
        const actualRent = Math.min(curPlayer.cash, districtRent);

        setPlayers((prev) =>
          prev.map((p, idx) => {
            if (idx === currentPlayerIndex) return { ...p, cash: p.cash - actualRent };
            if (idx === opponentIndex) return { ...p, cash: p.cash + actualRent };
            return p;
          })
        );

        gameAudio.playCoinPickup();
        addFloatingText(`-$${actualRent} Rent Paid`, [0, 2.5, 0], '#ef4444');
        showBanner(`Rent Paid: -$${actualRent} to ${opponent.name}`);
        addHistory(`${curPlayer.name} paid $${actualRent} rent to ${opponent.name} at ${space.name}!`);

        if (curPlayer.cash - actualRent <= 0) {
          turnTimeoutRef.current = setTimeout(() => {
            handleCheckEndGame();
          }, 1000);
          return;
        }

        finishTurnResolution(1600);
        return;
      }

      if (ownership.ownerId === currentPlayerIndex) {
        showBanner(`Visiting your own property: ${space.name}`);
        finishTurnResolution(1000);
        return;
      }
    }
  };

  const triggerJailCinematic = (playerIdx: number) => {
    if (jailAnimIntervalRef.current) clearInterval(jailAnimIntervalRef.current);

    setPhase('JAIL_EVENT');
    setCameraMode('JAIL');
    setPlayers((prev) =>
      prev.map((p, idx) =>
        idx === playerIdx
          ? { ...p, position: 8, inJail: true, jailTurnsRemaining: 1, justReleased: false }
          : p
      )
    );
    setSelectedSpaceIndex(8);

    setJailEvent({
      active: true,
      playerIndex: playerIdx,
      phase: 'RISING',
      progress: 0,
    });

    const riseStartTime = Date.now();
    const riseDuration = 900;

    jailAnimIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - riseStartTime;
      const progress = Math.min(1.0, elapsed / riseDuration);
      setJailEvent((prev) => ({ ...prev, progress }));

      if (progress >= 1.0) {
        if (jailAnimIntervalRef.current) clearInterval(jailAnimIntervalRef.current);

        gameAudio.playShieldBlock();
        showBanner('🚨 SENT TO JAIL!', 2600);
        addHistory(`🚨 ${players[playerIdx].name} locked behind NYC Jail bars!`);
        setJailEvent((prev) => ({ ...prev, phase: 'CHARACTER_INSIDE', progress: 1.0 }));

        turnTimeoutRef.current = setTimeout(() => {
          setJailEvent((prev) => ({ ...prev, phase: 'RETRACTING' }));

          const retractStartTime = Date.now();
          const retractDuration = 700;

          jailAnimIntervalRef.current = setInterval(() => {
            const rElapsed = Date.now() - retractStartTime;
            const rProgress = Math.max(0.0, 1.0 - rElapsed / retractDuration);
            setJailEvent((prev) => ({ ...prev, progress: rProgress }));

            if (rProgress <= 0.0) {
              if (jailAnimIntervalRef.current) clearInterval(jailAnimIntervalRef.current);
              setJailEvent({ active: false, playerIndex: 0, phase: 'INACTIVE', progress: 0 });
              setCameraMode('OVERVIEW');
              concludeTurn();
            }
          }, 25);
        }, 2400);
      }
    }, 25);
  };

  const handleCloseCardModal = () => {
    setCardModal(null);
    finishTurnResolution(300);
  };

  const finishTurnResolution = (delay = 800) => {
    turnTimeoutRef.current = setTimeout(() => {
      setCameraMode('OVERVIEW');
      concludeTurn();
    }, delay);
  };

  const concludeTurn = () => {
    setPhase('TURN_TRANSITION');
    setPlayers((prev) => prev.map((p) => ({ ...p, justReleased: false })));

    const updated = updateNetWorths(players, properties);
    setPlayers(updated);

    const p1 = updated[0];
    const p2 = updated[1];

    setGameState((g) => ({ ...g, score: Math.max(0, p1.netWorth) }));

    if (p1.cash <= 0 && p1.propertiesCount === 0) {
      setGameState((g) => ({ ...g, status: 'GAME_OVER' }));
      gameAudio.playDefeatMotif();
      return;
    }
    if (p2.cash <= 0 && p2.propertiesCount === 0) {
      setGameState((g) => ({ ...g, status: 'VICTORY' }));
      gameAudio.playVictoryFanfare();
      return;
    }

    const winNW = getConfig('targetNetWorthToWin');
    if (p1.netWorth >= winNW) {
      setGameState((g) => ({ ...g, status: 'VICTORY' }));
      gameAudio.playVictoryFanfare();
      return;
    }
    if (p2.netWorth >= winNW) {
      setGameState((g) => ({ ...g, status: 'GAME_OVER' }));
      gameAudio.playDefeatMotif();
      return;
    }

    const nextPlayer = (currentPlayerIndex + 1) % 2;
    setCurrentPlayerIndex(nextPlayer);
    setPhase('WAITING_FOR_ROLL');
    setGameState((g) => ({ ...g, level: g.level + 1 }));
    addHistory(`--- Turn ${gameState.level + 1}: ${updated[nextPlayer].name} ---`);

    if (updated[nextPlayer].isAi) {
      turnTimeoutRef.current = setTimeout(() => {
        if (updated[nextPlayer].inJail) {
          showBanner(`${updated[nextPlayer].name} served 1 turn in jail and is released!`, 2200);
          addHistory(`${updated[nextPlayer].name} is released from jail.`);
          setPlayers((prev) =>
            prev.map((p, idx) =>
              idx === nextPlayer
                ? { ...p, inJail: false, jailTurnsRemaining: 0, justReleased: true }
                : p
            )
          );
          turnTimeoutRef.current = setTimeout(() => {
            concludeTurn();
          }, 1400);
          return;
        }

        const d1 = Math.floor(Math.random() * 6) + 1;
        const d2 = Math.floor(Math.random() * 6) + 1;
        setDiceRoll({
          d1,
          d2,
          total: d1 + d2,
          rollId: Date.now(),
          isRolling: true,
        });
        setThrowProgress(0);
        setPhase('PREPARE_THROW');
        setCameraMode('PREPARE_ROLL');
        gameAudio.playCrispClick();
        addHistory(`${updated[nextPlayer].name} throwing dice across the table...`);

        const startT = Date.now();
        const throwDuration = 800;
        const throwInterval = setInterval(() => {
          const elapsed = Date.now() - startT;
          const progress = Math.min(1.0, elapsed / throwDuration);
          setThrowProgress(progress);

          if (progress >= 0.45) {
            setCameraMode('DICE');
          }

          if (progress >= 1.0) {
            clearInterval(throwInterval);
            setPhase('DICE_ANIMATING');
          }
        }, 25);
      }, 1200);
    }
  };

  const handleCheckEndGame = () => {
    const p1 = players[0];
    const p2 = players[1];
    if (p1.cash <= 0) {
      setGameState((g) => ({ ...g, status: 'GAME_OVER' }));
      gameAudio.playDefeatMotif();
    } else if (p2.cash <= 0) {
      setGameState((g) => ({ ...g, status: 'VICTORY' }));
      gameAudio.playVictoryFanfare();
    }
  };

  // Keyboard shortcut Space/Enter to roll
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsGameMenuOpen((prev) => !prev);
      }
      if (
        (e.key === ' ' || e.key === 'Enter') &&
        phase === 'WAITING_FOR_ROLL' &&
        gameState.status === 'PLAYING' &&
        !players[currentPlayerIndex].isAi &&
        !isCalibrationOpen
      ) {
        handleRollDice();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [phase, gameState.status, currentPlayerIndex, players, isCalibrationOpen]);

  const curPlayer = players[currentPlayerIndex];
  const isMyTurn = !curPlayer.isAi && phase === 'WAITING_FOR_ROLL';
  const humanPlayer = players[0];
  const aiPlayer = players[1];
  const activeSpace = BOARD_SPACES[selectedSpaceIndex];
  const activeOwnership = properties[selectedSpaceIndex];

  return (
    <div className="fixed inset-0 overflow-hidden touch-none flex flex-col bg-zinc-950 text-white font-sans select-none">
      <audio
        ref={introAudioRef}
        src="/audio/intro.effect.mp3"
        preload="auto"
        onEnded={() => setIntroFinished(true)}
        onError={() => setIntroFinished(true)}
      />
      <BackgroundMusic
        url={getConfig('backgroundMusicUrl')}
        isPlaying={gameState.status === 'PLAYING' && introFinished}
        isMuted={isMusicMuted}
        volume={0.3}
      />

      {/* TOP HEADER HUD */}
      <header className="w-full bg-gradient-to-r from-zinc-950 via-zinc-900 to-zinc-950 border-b border-amber-500/40 px-3 py-1.5 flex items-center justify-between z-20 shadow-xl backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-gradient-to-r from-amber-500 to-yellow-400 text-black px-2.5 py-1 rounded font-black tracking-wider text-xs shadow-md">
            <Trophy className="w-3.5 h-3.5" />
            <span>HUSTLE CITY 3D</span>
          </div>
          <span className="text-[11px] text-zinc-400 font-mono hidden sm:inline">
            Turn {gameState.level} | Target Net Worth: ${getConfig('targetNetWorthToWin').toLocaleString()}
          </span>
        </div>

        {/* Turn Status Pill */}
        <div className="flex items-center gap-2">
          <span
            className={`text-xs font-black px-2.5 py-0.5 rounded-full border ${
              curPlayer.isAi
                ? 'bg-amber-950/80 border-amber-500 text-amber-300'
                : 'bg-sky-950/80 border-sky-400 text-sky-300 animate-pulse'
            }`}
          >
            {curPlayer.isAi ? "🤖 Computer's Turn" : "👑 Player's Turn"}
          </span>
        </div>

        {/* Action & Menu Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsCalibrationOpen(true)}
            title="Open Character Calibration Panel"
            className="min-w-[40px] min-h-[40px] bg-sky-900/80 hover:bg-sky-800 border border-sky-400/60 rounded px-2.5 py-1 text-xs font-bold text-sky-200 flex items-center gap-1 transition shadow"
          >
            <Sliders className="w-3.5 h-3.5 text-sky-300" />
            <span className="hidden sm:inline">CALIBRATE</span>
          </button>

          <button
            onClick={handleResetCamera}
            title="Reset to default side view overview"
            className="min-w-[40px] min-h-[40px] bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 rounded px-2.5 py-1 text-xs font-bold text-zinc-200 flex items-center gap-1 transition shadow"
          >
            <Camera className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">RESET CAM</span>
          </button>

          <button
            onClick={() => setIsGameMenuOpen(true)}
            data-testid="menu-button"
            className="min-w-[44px] min-h-[40px] bg-zinc-800 hover:bg-zinc-700 border border-amber-500/40 rounded px-3 py-1 text-xs font-bold text-amber-400 flex items-center justify-center gap-1 transition shadow"
          >
            <span>≡ MENU</span>
          </button>
        </div>
      </header>

      {/* MAIN VIEWPORT WITH PERSISTENT DUAL-SIDEBAR PANELS */}
      <div className="flex-1 w-full min-h-0 relative flex overflow-hidden">
        {/* PERSISTENT LEFT PANEL: HUMAN PLAYER STATS */}
        <aside className="w-64 max-w-[220px] sm:max-w-[250px] bg-zinc-950/90 border-r border-amber-500/30 p-2.5 z-10 flex flex-col justify-between backdrop-blur-md overflow-y-auto hidden md:flex shadow-2xl">
          <div className="space-y-2.5">
            <div className="p-2 rounded-lg bg-sky-950/60 border border-sky-500/50">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-sky-400 flex items-center gap-1">
                  <div className="w-2.5 h-2.5 rounded-full bg-sky-400" />
                  {humanPlayer.name} (YOU)
                </span>
                {humanPlayer.inJail ? (
                  <span className="text-[10px] bg-red-900 text-red-200 px-1.5 py-0.5 rounded font-bold flex items-center gap-1">
                    <ShieldAlert className="w-3 h-3" /> IN JAIL
                  </span>
                ) : (
                  <span className="text-[10px] bg-emerald-950 text-emerald-300 px-1.5 py-0.5 rounded font-bold">
                    Active
                  </span>
                )}
              </div>
              <div className="mt-1.5 flex items-baseline justify-between">
                <span className="text-lg font-black text-emerald-400">
                  ${humanPlayer.cash.toLocaleString()}
                </span>
                <span className="text-[11px] text-zinc-400 font-mono">
                  NW: ${humanPlayer.netWorth.toLocaleString()}
                </span>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between text-[11px] text-zinc-400 font-bold mb-1 px-1">
                <span className="flex items-center gap-1">
                  <Building2 className="w-3 h-3 text-amber-400" />
                  Properties ({humanPlayer.propertiesCount})
                </span>
              </div>
              <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                {humanPlayer.ownedSpaces.length === 0 ? (
                  <div className="text-[11px] text-zinc-500 italic p-2 bg-zinc-900/50 rounded border border-zinc-800">
                    No properties claimed yet. Roll and land on properties to claim them automatically!
                  </div>
                ) : (
                  humanPlayer.ownedSpaces.map((sId) => {
                    const sp = BOARD_SPACES[sId];
                    const rent = DISTRICT_RENTS[sp.district] || sp.baseRent || 150;
                    return (
                      <div
                        key={`h-prop-${sId}`}
                        onClick={() => {
                          setSelectedSpaceIndex(sId);
                          setCameraMode('PROPERTY');
                        }}
                        className="flex items-center justify-between p-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/60 cursor-pointer transition text-[11px]"
                      >
                        <div className="flex items-center gap-1.5 truncate">
                          <div
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: sp.color }}
                          />
                          <span className="font-bold truncate max-w-[110px]">{sp.name}</span>
                        </div>
                        <span className="text-amber-400 font-mono font-bold">${rent}/mo</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          <div className="p-2 rounded bg-amber-950/40 border border-amber-500/30 text-[10px] text-amber-200">
            <span className="font-bold text-amber-400 flex items-center gap-1 mb-0.5">
              <Zap className="w-3 h-3 text-amber-400" /> HUSTLE TIP
            </span>
            <span>Use CALIBRATE anytime to test your GLB sitting position in real time!</span>
          </div>
        </aside>

        {/* 3D WEBGL CANVAS VIEWPORT */}
        <div className="flex-1 w-full h-full relative bg-slate-950 overflow-hidden">
          <Canvas
            shadows
            camera={{ position: [-22.0, 11.0, 0.0], fov: getConfig('fov') }}
            className="w-full h-full block"
          >
            <Suspense fallback={null}>
              <GameScene
                players={players}
                currentPlayerIndex={currentPlayerIndex}
                properties={properties}
                selectedSpaceIndex={selectedSpaceIndex}
                onSelectSpace={(idx) => {
                  setSelectedSpaceIndex(idx);
                  setCameraMode('PROPERTY');
                  gameAudio.playCrispClick();
                }}
                diceRoll={diceRoll}
                onDiceSettled={handleDiceSettled}
                cameraMode={cameraMode}
                floatingTexts={floatingTexts}
                isMovingCharacter={phase === 'CHARACTER_MOVING'}
                throwProgress={throwProgress}
                jailEvent={jailEvent}
                calibration={calibration}
                onModelDiagnostic={(info) => {
                  setModelDiagnosticInfo(info);
                }}
              />
            </Suspense>
          </Canvas>

          {/* NOTIFICATION BANNER */}
          {notificationBanner && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-amber-600 via-yellow-500 to-amber-600 text-black font-black text-sm px-5 py-2 rounded-xl shadow-2xl border border-amber-300 z-30 animate-bounce text-center tracking-wide">
              {notificationBanner}
            </div>
          )}

          {/* MOBILE HUD OVERLAY */}
          <div className="md:hidden absolute top-2 left-2 right-2 flex justify-between gap-1 z-10 pointer-events-none">
            <div className="bg-zinc-900/90 border border-sky-500/50 p-1.5 rounded text-[10px] pointer-events-auto shadow">
              <span className="text-sky-400 font-bold block">{humanPlayer.name}</span>
              <span className="text-emerald-400 font-black">${humanPlayer.cash}</span> | {humanPlayer.propertiesCount} 🏢
            </div>
            <div className="bg-zinc-900/90 border border-amber-500/50 p-1.5 rounded text-[10px] pointer-events-auto shadow">
              <span className="text-amber-400 font-bold block">{aiPlayer.name}</span>
              <span className="text-emerald-400 font-black">${aiPlayer.cash}</span> | {aiPlayer.propertiesCount} 🏢
            </div>
          </div>

          {/* BOTTOM CONTROLS & HUD BAR */}
          <div className="absolute bottom-2 left-2 right-2 flex flex-col sm:flex-row items-end sm:items-center justify-between pointer-events-none gap-2 z-20">
            {/* Selected Tile Info Card */}
            <div className="bg-zinc-950/95 border border-zinc-700 p-2.5 rounded-xl shadow-2xl backdrop-blur max-w-xs w-full pointer-events-auto flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span
                  className="text-[11px] font-bold px-1.5 py-0.5 rounded text-white"
                  style={{ backgroundColor: activeSpace.color }}
                >
                  {activeSpace.district}
                </span>
                <span className="text-[10px] text-zinc-400 font-mono">Space #{activeSpace.id}</span>
              </div>
              <div className="text-xs font-black truncate">{activeSpace.name}</div>
              <div className="text-[10px] text-zinc-300 font-mono">
                {activeSpace.type === 'property' || activeSpace.type === 'transit' ? (
                  <>
                    Rent: <span className="text-amber-400 font-bold">${DISTRICT_RENTS[activeSpace.district] || activeSpace.baseRent}</span> | Owner:{' '}
                    {activeOwnership && activeOwnership.ownerId !== null
                      ? `${players[activeOwnership.ownerId].name}`
                      : 'Unowned (Claimable!)'}
                  </>
                ) : (
                  <span>{activeSpace.desc}</span>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2 pointer-events-auto">
              <button
                onClick={handleResetCamera}
                className="min-w-[48px] min-h-[48px] bg-zinc-800/90 hover:bg-zinc-700 border border-zinc-600 px-3 py-1.5 rounded-xl text-xs font-bold text-zinc-200 flex items-center justify-center gap-1 shadow-lg transition"
              >
                <Camera className="w-4 h-4 text-amber-400" />
                <span className="hidden sm:inline">Side View</span>
              </button>

              {/* Main Roll Dice Button */}
              <button
                onClick={handleRollDice}
                disabled={!isMyTurn || phase !== 'WAITING_FOR_ROLL'}
                className={`min-w-[48px] min-h-[48px] px-6 py-3 rounded-xl font-black text-sm tracking-wide flex items-center justify-center gap-2 shadow-2xl transition-all ${
                  isMyTurn && phase === 'WAITING_FOR_ROLL'
                    ? 'bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-500 text-black hover:scale-105 hover:shadow-amber-500/50 cursor-pointer animate-pulse'
                    : 'bg-zinc-800 text-zinc-500 border border-zinc-700 cursor-not-allowed'
                }`}
              >
                <Gamepad className="w-5 h-5" />
                <span>
                  {phase === 'DICE_ANIMATING'
                    ? `ROLLING: ${diceRoll.d1} + ${diceRoll.d2}...`
                    : phase === 'CHARACTER_MOVING'
                    ? 'WALKING...'
                    : phase === 'JAIL_EVENT'
                    ? 'JAIL LOCKUP...'
                    : phase === 'LANDING_EVENT'
                    ? 'RESOLVING TILE...'
                    : 'ROLL DICE (SPACE)'}
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* PERSISTENT RIGHT PANEL: COMPUTER AI STATS */}
        <aside className="w-64 max-w-[220px] sm:max-w-[250px] bg-zinc-950/90 border-l border-amber-500/30 p-2.5 z-10 flex flex-col justify-between backdrop-blur-md overflow-y-auto hidden md:flex shadow-2xl">
          <div className="space-y-2.5">
            <div className="p-2 rounded-lg bg-amber-950/60 border border-amber-500/50">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-amber-400 flex items-center gap-1">
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                  {aiPlayer.name} (RIVAL)
                </span>
                {aiPlayer.inJail ? (
                  <span className="text-[10px] bg-red-900 text-red-200 px-1.5 py-0.5 rounded font-bold flex items-center gap-1">
                    <ShieldAlert className="w-3 h-3" /> IN JAIL
                  </span>
                ) : (
                  <span className="text-[10px] bg-emerald-950 text-emerald-300 px-1.5 py-0.5 rounded font-bold">
                    Active
                  </span>
                )}
              </div>
              <div className="mt-1.5 flex items-baseline justify-between">
                <span className="text-lg font-black text-emerald-400">
                  ${aiPlayer.cash.toLocaleString()}
                </span>
                <span className="text-[11px] text-zinc-400 font-mono">
                  NW: ${aiPlayer.netWorth.toLocaleString()}
                </span>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between text-[11px] text-zinc-400 font-bold mb-1 px-1">
                <span className="flex items-center gap-1">
                  <Building2 className="w-3 h-3 text-amber-400" />
                  Properties ({aiPlayer.propertiesCount})
                </span>
              </div>
              <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                {aiPlayer.ownedSpaces.length === 0 ? (
                  <div className="text-[11px] text-zinc-500 italic p-2 bg-zinc-900/50 rounded border border-zinc-800">
                    No properties claimed yet.
                  </div>
                ) : (
                  aiPlayer.ownedSpaces.map((sId) => {
                    const sp = BOARD_SPACES[sId];
                    const rent = DISTRICT_RENTS[sp.district] || sp.baseRent || 150;
                    return (
                      <div
                        key={`ai-prop-${sId}`}
                        onClick={() => {
                          setSelectedSpaceIndex(sId);
                          setCameraMode('PROPERTY');
                        }}
                        className="flex items-center justify-between p-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/60 cursor-pointer transition text-[11px]"
                      >
                        <div className="flex items-center gap-1.5 truncate">
                          <div
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: sp.color }}
                          />
                          <span className="font-bold truncate max-w-[110px]">{sp.name}</span>
                        </div>
                        <span className="text-amber-400 font-mono font-bold">${rent}/mo</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          <div className="p-2 rounded bg-zinc-900/80 border border-zinc-800 text-[10px] space-y-1">
            <span className="font-bold text-amber-400 block border-b border-zinc-700 pb-0.5">
              Live Game Activity:
            </span>
            <div className="max-h-24 overflow-y-auto text-zinc-300 font-mono space-y-0.5">
              {turnHistory.slice(0, 5).map((log, i) => (
                <div key={`log-${i}`} className="leading-tight">
                  • {log}
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {/* ========================================================= */}
      {/* DEVELOPER CHARACTER CALIBRATION PANEL MODAL */}
      {/* ========================================================= */}
      {isCalibrationOpen && (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-3 sm:p-5">
          <div className="w-full max-w-xl bg-zinc-900 border-2 border-sky-400/80 rounded-2xl p-5 shadow-2xl flex flex-col gap-4 text-xs max-h-[92vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-zinc-700 pb-2.5">
              <div className="flex items-center gap-2">
                <Sliders className="w-5 h-5 text-sky-400" />
                <h2 className="text-base font-black text-sky-300">MrTalkofNY Calibration & Diagnostics</h2>
              </div>
              <button
                onClick={() => setIsCalibrationOpen(false)}
                className="text-zinc-400 hover:text-white font-bold px-2 py-1 bg-zinc-800 rounded border border-zinc-700"
              >
                ✕ CLOSE
              </button>
            </div>

            {/* Model Load & Skinned Mesh Status */}
            <div className="p-3 bg-zinc-950/80 rounded-xl border border-zinc-800 space-y-1 font-mono text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">GLB Status:</span>
                <span
                  className={`font-bold ${
                    modelDiagnosticInfo.status === 'loaded' ? 'text-emerald-400' : 'text-amber-400'
                  }`}
                >
                  {modelDiagnosticInfo.status === 'loaded'
                    ? `✓ Loaded (${modelDiagnosticInfo.meshCount} Skinned Meshes)`
                    : 'Loading / Stylized Fallback Active'}
                </span>
              </div>
              {modelDiagnosticInfo.materialInfo && (
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Materials:</span>
                  <span className="text-emerald-300 font-bold">{modelDiagnosticInfo.materialInfo}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Model BBox (XYZ):</span>
                <span className="text-zinc-200">
                  [{modelDiagnosticInfo.rawBox.x.toFixed(2)}, {modelDiagnosticInfo.rawBox.y.toFixed(2)},{' '}
                  {modelDiagnosticInfo.rawBox.z.toFixed(2)}]
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Chair Target:</span>
                <span className="text-amber-300 font-bold">Seat Y = -3.10 | Z = 14.60</span>
              </div>
            </div>

            {/* Quick Action Buttons */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button
                onClick={() => {
                  setCameraMode('CALIBRATION');
                  gameAudio.playCrispClick();
                }}
                className="bg-sky-700 hover:bg-sky-600 text-white font-black py-2 px-2 rounded-lg text-center flex items-center justify-center gap-1 shadow"
              >
                <Camera className="w-3.5 h-3.5" /> FOCUS MODEL
              </button>

              <button
                onClick={() => {
                  setCalibration((prev) => ({ ...prev, isPlayingAnimation: !prev.isPlayingAnimation }));
                  gameAudio.playCrispClick();
                }}
                className="bg-zinc-800 hover:bg-zinc-700 text-amber-300 font-bold py-2 px-2 rounded-lg border border-zinc-700 flex items-center justify-center gap-1"
              >
                <RotateCw className="w-3.5 h-3.5" />
                {calibration.isPlayingAnimation ? 'PAUSE ANIM' : 'PLAY ANIM'}
              </button>

              <button
                onClick={() => {
                  setCalibration((prev) => ({
                    ...prev,
                    showBoundingBox: !prev.showBoundingBox,
                    showAxisHelper: !prev.showAxisHelper,
                  }));
                  gameAudio.playCrispClick();
                }}
                className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold py-2 px-2 rounded-lg border border-zinc-700 flex items-center justify-center gap-1"
              >
                <Eye className="w-3.5 h-3.5" />
                {calibration.showBoundingBox ? 'HIDE HELPERS' : 'SHOW HELPERS'}
              </button>

              <button
                onClick={handleResetCalibration}
                className="bg-zinc-800 hover:bg-red-900/60 text-zinc-300 font-bold py-2 px-2 rounded-lg border border-zinc-700 flex items-center justify-center gap-1"
              >
                <RefreshCw className="w-3.5 h-3.5" /> RESET DEFAULTS
              </button>
            </div>

            {/* Animation Selector */}
            {modelDiagnosticInfo.animations.length > 0 && (
              <div className="p-2.5 bg-zinc-950/80 rounded-xl border border-zinc-800 space-y-1.5">
                <span className="font-bold text-sky-400 block">Active Skeletal Animation:</span>
                <div className="flex flex-wrap gap-1.5">
                  {modelDiagnosticInfo.animations.map((animName) => (
                    <button
                      key={animName}
                      onClick={() => {
                        setCalibration((prev) => ({
                          ...prev,
                          selectedAnimation: animName,
                          isPlayingAnimation: true,
                        }));
                        gameAudio.playCrispClick();
                      }}
                      className={`px-2.5 py-1 rounded text-[11px] font-bold transition border ${
                        calibration.selectedAnimation === animName ||
                        (!calibration.selectedAnimation && animName === modelDiagnosticInfo.animations[0])
                          ? 'bg-sky-600 border-sky-300 text-white'
                          : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white'
                      }`}
                    >
                      {animName}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Transform Sliders */}
            <div className="space-y-2.5 p-3 bg-zinc-950/80 rounded-xl border border-zinc-800">
              <span className="font-bold text-amber-400 block text-xs border-b border-zinc-800 pb-1">
                Parent Group Transform Calibration (Does not modify bones):
              </span>

              {/* Uniform Scale */}
              <div className="space-y-1">
                <div className="flex justify-between font-mono text-[11px]">
                  <span>Uniform Scale:</span>
                  <span className="text-amber-400 font-bold">{calibration.scale.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="20.0"
                  step="0.1"
                  value={calibration.scale}
                  onChange={(e) =>
                    setCalibration((prev) => ({ ...prev, scale: parseFloat(e.target.value) }))
                  }
                  className="w-full accent-amber-400 cursor-pointer"
                />
              </div>

              {/* Position Y (Height) */}
              <div className="space-y-1">
                <div className="flex justify-between font-mono text-[11px]">
                  <span>Position Y (Height Alignment):</span>
                  <span className="text-sky-400 font-bold">{calibration.posY.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="-10.0"
                  max="5.0"
                  step="0.05"
                  value={calibration.posY}
                  onChange={(e) =>
                    setCalibration((prev) => ({ ...prev, posY: parseFloat(e.target.value) }))
                  }
                  className="w-full accent-sky-400 cursor-pointer"
                />
              </div>

              {/* Position Z (Forward/Back) */}
              <div className="space-y-1">
                <div className="flex justify-between font-mono text-[11px]">
                  <span>Position Z (Chair Depth):</span>
                  <span className="text-sky-400 font-bold">{calibration.posZ.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="5.0"
                  max="20.0"
                  step="0.05"
                  value={calibration.posZ}
                  onChange={(e) =>
                    setCalibration((prev) => ({ ...prev, posZ: parseFloat(e.target.value) }))
                  }
                  className="w-full accent-sky-400 cursor-pointer"
                />
              </div>

              {/* Position X (Left/Right) */}
              <div className="space-y-1">
                <div className="flex justify-between font-mono text-[11px]">
                  <span>Position X (Horizontal Center):</span>
                  <span className="text-sky-400 font-bold">{calibration.posX.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="-5.0"
                  max="5.0"
                  step="0.05"
                  value={calibration.posX}
                  onChange={(e) =>
                    setCalibration((prev) => ({ ...prev, posX: parseFloat(e.target.value) }))
                  }
                  className="w-full accent-sky-400 cursor-pointer"
                />
              </div>

              {/* Rotation Y */}
              <div className="space-y-1">
                <div className="flex justify-between font-mono text-[11px]">
                  <span>Rotation Y (Facing Angle):</span>
                  <span className="text-zinc-300 font-bold">{((calibration.rotY * 180) / Math.PI).toFixed(0)}°</span>
                </div>
                <input
                  type="range"
                  min={-Math.PI}
                  max={Math.PI}
                  step="0.05"
                  value={calibration.rotY}
                  onChange={(e) =>
                    setCalibration((prev) => ({ ...prev, rotY: parseFloat(e.target.value) }))
                  }
                  className="w-full accent-zinc-400 cursor-pointer"
                />
              </div>
            </div>

            {/* Visibility Toggles to Clear View of Model */}
            <div className="p-3 bg-zinc-950/80 rounded-xl border border-zinc-800 space-y-2">
              <span className="font-bold text-zinc-300 block">Scene Visibility Toggles:</span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                <button
                  onClick={() =>
                    setCalibration((prev) => ({ ...prev, showTable: !prev.showTable }))
                  }
                  className={`p-2 rounded border font-bold flex items-center justify-center gap-1 ${
                    calibration.showTable ? 'bg-zinc-800 border-zinc-700 text-white' : 'bg-red-950/60 border-red-800 text-red-300'
                  }`}
                >
                  Table: {calibration.showTable ? 'Visible' : 'Hidden'}
                </button>

                <button
                  onClick={() =>
                    setCalibration((prev) => ({ ...prev, showChairs: !prev.showChairs }))
                  }
                  className={`p-2 rounded border font-bold flex items-center justify-center gap-1 ${
                    calibration.showChairs ? 'bg-zinc-800 border-zinc-700 text-white' : 'bg-red-950/60 border-red-800 text-red-300'
                  }`}
                >
                  Chairs: {calibration.showChairs ? 'Visible' : 'Hidden'}
                </button>

                <button
                  onClick={() =>
                    setCalibration((prev) => ({ ...prev, showBuildings: !prev.showBuildings }))
                  }
                  className={`p-2 rounded border font-bold flex items-center justify-center gap-1 ${
                    calibration.showBuildings ? 'bg-zinc-800 border-zinc-700 text-white' : 'bg-red-950/60 border-red-800 text-red-300'
                  }`}
                >
                  City Buildings: {calibration.showBuildings ? 'Visible' : 'Hidden'}
                </button>

                <button
                  onClick={() =>
                    setCalibration((prev) => ({ ...prev, showBoard: !prev.showBoard }))
                  }
                  className={`p-2 rounded border font-bold flex items-center justify-center gap-1 ${
                    calibration.showBoard ? 'bg-zinc-800 border-zinc-700 text-white' : 'bg-red-950/60 border-red-800 text-red-300'
                  }`}
                >
                  Board Tiles: {calibration.showBoard ? 'Visible' : 'Hidden'}
                </button>
              </div>
            </div>

            {/* Save Placement Button */}
            <button
              onClick={handleSaveCalibration}
              className="w-full bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black py-3 rounded-xl shadow-xl flex items-center justify-center gap-2 text-sm transition tracking-wider"
            >
              <Check className="w-4 h-4" />
              SAVE PLACEMENT (PERSISTS ON LAUNCH)
            </button>
          </div>
        </div>
      )}

      {/* CARD EVENT POPUP MODAL */}
      {cardModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-sm bg-gradient-to-b from-zinc-900 to-zinc-950 border-2 border-amber-400 rounded-2xl p-6 shadow-2xl flex flex-col items-center text-center gap-3">
            <span
              className={`px-3 py-1 rounded-full text-xs font-black tracking-widest ${
                cardModal.type === 'opportunity' ? 'bg-pink-600 text-white' : 'bg-amber-500 text-black'
              }`}
            >
              {cardModal.type === 'opportunity' ? 'HUSTLE OPPORTUNITY' : 'COMMUNITY CHEST'}
            </span>
            <h3 className="text-xl font-black text-amber-300">{cardModal.title}</h3>
            <p className="text-sm text-zinc-300">{cardModal.text}</p>
            <button
              onClick={handleCloseCardModal}
              autoFocus
              className="min-w-[48px] min-h-[48px] mt-2 w-full bg-amber-400 hover:bg-amber-300 text-black font-black py-2.5 rounded-xl transition"
            >
              COLLECT & CONTINUE
            </button>
          </div>
        </div>
      )}

      {/* START SCREEN OVERLAY */}
      {gameState.status === 'START' && (
        <Overlay
          title="HUSTLE CITY 3D"
          description="Conquer the streets of miniature New York! Roll realistic 3D dice, claim properties automatically, collect rent from your rival, and outrun the Tycoon Chaser patrolling the board!"
          actionLabel="START THE HUSTLE"
          onAction={handleStartGame}
          icon={<Play className="w-6 h-6" />}
          tone="neutral"
          autoFocus
        />
      )}

      {/* GAME OVER OVERLAY */}
      {gameState.status === 'GAME_OVER' && (
        <Overlay
          title="BANKRUPT!"
          description={`You ran out of capital in Hustle City. The rival tycoon has claimed the crown. Final Net Worth: $${humanPlayer.netWorth.toLocaleString()}`}
          actionLabel="PLAY AGAIN"
          onAction={handleStartGame}
          icon={<RotateCw className="w-6 h-6" />}
          tone="danger"
          autoFocus
        />
      )}

      {/* VICTORY OVERLAY */}
      {gameState.status === 'VICTORY' && (
        <Overlay
          title="EMPIRE TYCOON!"
          description={`You have conquered Hustle City with an outstanding Net Worth of $${humanPlayer.netWorth.toLocaleString()}!`}
          actionLabel="PLAY AGAIN"
          onAction={handleStartGame}
          icon={<Trophy className="w-6 h-6" />}
          tone="victory"
          autoFocus
        />
      )}

      {/* GAME MENU OVERLAY */}
      {isGameMenuOpen && (
        <MenuOverlay tone="neutral" zIndex={1000}>
          <div className="w-full max-w-md flex flex-col items-center bg-zinc-900 border-2 border-amber-500/50 rounded-2xl p-6 m-4 shadow-2xl gap-4">
            <h2 className="text-2xl font-black text-amber-400">GAME MENU</h2>

            <button
              onClick={() => setIsGameMenuOpen(false)}
              autoFocus
              className="min-w-[48px] min-h-[48px] w-full bg-amber-400 hover:bg-yellow-300 text-black font-black py-3 rounded-xl transition flex items-center justify-center gap-2"
            >
              <Play className="w-5 h-5" />
              RESUME GAME
            </button>

            {/* Calibration Shortcut in Menu */}
            <button
              onClick={() => {
                setIsGameMenuOpen(false);
                setIsCalibrationOpen(true);
              }}
              className="min-w-[48px] min-h-[48px] w-full bg-sky-900/80 hover:bg-sky-800 border border-sky-400/60 py-3 rounded-xl text-xs font-bold text-sky-200 transition flex items-center justify-center gap-2"
            >
              <Sliders className="w-4 h-4 text-sky-300" />
              CHARACTER CALIBRATION (DEV)
            </button>

            <div className="grid grid-cols-2 gap-3 w-full">
              <button
                onClick={() => {
                  const muted = gameAudio.toggleMute();
                  setIsSfxMuted(muted);
                }}
                className="min-w-[48px] min-h-[48px] bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 rounded-xl py-2 px-3 flex items-center justify-center gap-2 text-xs font-bold transition"
              >
                {isSfxMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
                SFX: {isSfxMuted ? 'OFF' : 'ON'}
              </button>

              <button
                onClick={() => setIsMusicMuted((prev) => !prev)}
                className="min-w-[48px] min-h-[48px] bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 rounded-xl py-2 px-3 flex items-center justify-center gap-2 text-xs font-bold transition"
              >
                {isMusicMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
                Music: {isMusicMuted ? 'OFF' : 'ON'}
              </button>
            </div>

            <button
              onClick={() => setIsHowToPlayOpen(true)}
              className="min-w-[48px] min-h-[48px] w-full bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 py-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2"
            >
              <Info className="w-4 h-4 text-sky-400" />
              HOW TO PLAY
            </button>

            <button
              onClick={handleStartGame}
              className="min-w-[48px] min-h-[48px] w-full bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 py-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2"
            >
              <RotateCw className="w-4 h-4 text-amber-400" />
              RESTART GAME
            </button>

            <button
              onClick={() => {
                setIsGameMenuOpen(false);
                setGameState((g) => ({ ...g, status: 'START' }));
              }}
              className="min-w-[48px] min-h-[48px] w-full bg-zinc-800 hover:bg-red-900/60 border border-zinc-600 py-3 rounded-xl text-xs font-bold text-red-300 transition flex items-center justify-center gap-2"
            >
              <Home className="w-4 h-4" />
              QUIT TO TITLE
            </button>
          </div>
        </MenuOverlay>
      )}

      {/* HOW TO PLAY SCREEN */}
      {isHowToPlayOpen && (
        <div
          className="fixed inset-0 bg-black/90 flex items-center justify-center p-4"
          style={{ zIndex: 1001 }}
        >
          <div className="w-full max-w-lg bg-zinc-900 border-2 border-amber-400 rounded-2xl p-6 shadow-2xl flex flex-col gap-4 text-left max-h-[85vh] overflow-y-auto">
            <h2 className="text-2xl font-black text-amber-400 text-center">HOW TO PLAY</h2>
            <div className="space-y-3 text-xs text-zinc-300 leading-relaxed">
              <div className="p-3 bg-zinc-800/80 rounded-xl border border-zinc-700">
                <span className="font-bold text-amber-300 block mb-1">1. Rolling & Movement:</span>
                Press <span className="text-yellow-400 font-bold">ROLL DICE</span> or Spacebar. The camera smoothly focuses on the falling dice, then follows your character as they walk clockwise around the 32-tile board.
              </div>
              <div className="p-3 bg-zinc-800/80 rounded-xl border border-zinc-700">
                <span className="font-bold text-amber-300 block mb-1">2. Simple Automatic Properties:</span>
                The first player to land on an unowned property claims it automatically for free! When an opponent visits your property, they pay rent directly to you based on the district value.
              </div>
              <div className="p-3 bg-zinc-800/80 rounded-xl border border-zinc-700">
                <span className="font-bold text-amber-300 block mb-1">3. Pop-Up Jail & Chaser Mechanics:</span>
                If the Tycoon reaches or lands on your space, you are <span className="text-red-400 font-bold">CAUGHT</span>! A 3D miniature jail rises from the flat jail square, locking you behind iron bars before retracting back.
              </div>
              <div className="p-3 bg-zinc-800/80 rounded-xl border border-zinc-700">
                <span className="font-bold text-amber-300 block mb-1">4. Winning the Empire:</span>
                Collect <span className="text-emerald-400 font-bold">$200</span> whenever passing START THE HUSTLE. Reach a Net Worth of <span className="text-amber-400 font-bold">${getConfig('targetNetWorthToWin').toLocaleString()}</span> or bankrupt the rival tycoon to win!
              </div>
            </div>

            <button
              onClick={() => setIsHowToPlayOpen(false)}
              autoFocus
              className="min-w-[48px] min-h-[48px] w-full bg-amber-400 hover:bg-amber-300 text-black font-black py-3 rounded-xl transition mt-2"
            >
              CLOSE GUIDE
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
