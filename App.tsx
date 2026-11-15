import { useCallback, useEffect, useRef, useState } from 'react';
import { GameHud } from './components/GameHud';
import { GameOverModal } from './components/GameOverModal';
import { MetaModals } from './components/MetaModals';
import { PauseModal } from './components/PauseModal';
import { TitleOverlay, type MetaModalTab } from './components/TitleOverlay';
import { JungleEngine } from './game/JungleEngine';
import { audioEngine } from './game/audio';
import { BIOMES, CHARACTERS, MISSIONS } from './game/catalog';
import { getTodayKey, loadSaveData, persistSaveData, showOptionalRewardedAd } from './game/monetization';
import {
  canWatchRewardedAd,
  claimMissionReward,
  unlockOrSelectCharacter,
  unlockOrSelectCostume,
  updateMissionProgress,
} from './game/rules';
import {
  MYSTERY_CHAPTERS,
  applyMysteryCompletion,
  isMysteryUnlocked,
  submitCodexDecipher,
} from './game/mysteries';
import type {
  BiomeId,
  CharacterId,
  GameScreenState,
  RuneSymbolId,
  RunHudSnapshot,
  RunOutcomeSnapshot,
  SaveData,
} from './game/types';

const INITIAL_HUD: RunHudSnapshot = {
  score: 0,
  distance: 0,
  runCoins: 0,
  runRelics: 0,
  combo: 0,
  hearts: 3,
  maxHearts: 3,
  shieldActive: false,
  magnetRemaining: 0,
  multiplierRemaining: 0,
  abilityCharge: 35,
  abilityActive: false,
  biomeId: 'emerald-canopy',
  biomeName: BIOMES['emerald-canopy'].name,
  inSecretRoom: false,
  bossActive: false,
  bossHp: 0,
  bossMaxHp: 3,
  bossTelegraphLane: null,
  activeMissionTitle: MISSIONS[0].title,
  activeMissionCurrent: 0,
  activeMissionTarget: MISSIONS[0].target,
  speed: 16,
  mysteryId: MYSTERY_CHAPTERS[0].id,
  mysteryTitle: MYSTERY_CHAPTERS[0].title,
  mysterySequence: MYSTERY_CHAPTERS[0].sequence,
  mysteryStepIndex: 0,
  mysteryBannerText: null,
};

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<JungleEngine | null>(null);

  const [save, setSave] = useState<SaveData>(() => loadSaveData());
  const saveRef = useRef<SaveData>(save);
  const [gameState, setGameState] = useState<GameScreenState>('title');
  const [hud, setHud] = useState<RunHudSnapshot>(INITIAL_HUD);
  const [outcome, setOutcome] = useState<RunOutcomeSnapshot | null>(null);
  const [metaModal, setMetaModal] = useState<MetaModalTab>(null);

  const commitSave = useCallback((next: SaveData) => {
    saveRef.current = next;
    setSave(next);
    persistSaveData(next);
    audioEngine.applySettings(next.settings);
    engineRef.current?.updateSaveData(next);
  }, []);

  useEffect(() => {
    audioEngine.applySettings(saveRef.current.settings);
  }, []);

  // Mount Three.js JungleEngine once
  useEffect(() => {
    const mountEl = canvasMountRef.current;
    if (!mountEl) return;

    const engine = new JungleEngine(mountEl, saveRef.current, {
      onHudUpdate: (nextHud) => {
        setHud(nextHud);
      },
      onStateRequest: (nextState) => {
        engine.setGameState(nextState);
        setGameState(nextState);
      },
      onMissionIncrement: (increments) => {
        const updated = updateMissionProgress(saveRef.current, increments);
        saveRef.current = updated;
        setSave(updated);
        persistSaveData(updated);
      },
      onMysterySolved: (chapterId) => {
        const result = applyMysteryCompletion(saveRef.current, chapterId);
        saveRef.current = result.save;
        setSave(result.save);
        persistSaveData(result.save);
        engine.updateSaveData(result.save);
      },
      onGameOver: (runOutcome) => {
        const current = saveRef.current;
        const unlockedBiomes = [...current.unlockedBiomes];
        for (const id of ['sunken-temple', 'underground-city', 'lost-world'] as BiomeId[]) {
          if (runOutcome.distance >= BIOMES[id].unlockDistance && !unlockedBiomes.includes(id)) {
            unlockedBiomes.push(id);
          }
        }
        const nextSave: SaveData = {
          ...current,
          totalCoins: current.totalCoins + runOutcome.coinsCollected,
          totalRelics: current.totalRelics + runOutcome.relicsCollected,
          bestScore: Math.max(current.bestScore, runOutcome.score),
          bestDistance: Math.max(current.bestDistance, runOutcome.distance),
          unlockedBiomes,
        };
        saveRef.current = nextSave;
        setSave(nextSave);
        persistSaveData(nextSave);
        engine.updateSaveData(nextSave);
        setOutcome(runOutcome);
        setGameState('gameover');
      },
    });

    engineRef.current = engine;

    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      setGameState('playing');
      engine.startNewRun();
    } else {
      document.body.dataset.state = 'title';
    }

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const handleStartRun = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setMetaModal(null);
    setOutcome(null);
    setGameState('playing');
    engineRef.current?.startNewRun();
  }, []);

  const handleReturnTitle = useCallback(() => {
    setOutcome(null);
    setGameState('title');
    engineRef.current?.setGameState('title');
  }, []);

  const handlePause = useCallback(() => {
    setGameState('paused');
    engineRef.current?.setGameState('paused');
  }, []);

  const handleResume = useCallback(() => {
    setMetaModal(null);
    setGameState('playing');
    engineRef.current?.setGameState('playing');
  }, []);

  const handleToggleMute = useCallback(() => {
    const next: SaveData = {
      ...saveRef.current,
      settings: {
        ...saveRef.current.settings,
        soundEnabled: !saveRef.current.settings.soundEnabled,
      },
    };
    commitSave(next);
  }, [commitSave]);

  // Title screen Enter/Space start handshake + global Mute [M]
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'KeyM') {
        handleToggleMute();
        return;
      }
      if (
        gameState === 'title' &&
        metaModal === null &&
        (e.code === 'Enter' || e.code === 'Space')
      ) {
        e.preventDefault();
        handleStartRun();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [gameState, metaModal, handleStartRun, handleToggleMute]);

  const handleSelectOrUnlockChar = (charId: CharacterId) => {
    const res = unlockOrSelectCharacter(saveRef.current, charId);
    if (res.ok) commitSave(res.save);
  };

  const handleSelectOrUnlockCostume = (charId: CharacterId, costumeId: string) => {
    const res = unlockOrSelectCostume(saveRef.current, charId, costumeId);
    if (res.ok) commitSave(res.save);
  };

  const handleSelectBiome = (id: BiomeId) => {
    if (!saveRef.current.unlockedBiomes.includes(id)) return;
    commitSave({ ...saveRef.current, selectedStartBiome: id });
  };

  const handleClaimMission = (missionId: string) => {
    const res = claimMissionReward(saveRef.current, missionId);
    if (res.reward > 0) {
      audioEngine.playRelic();
      commitSave(res.save);
    }
  };

  const handleSelectMystery = (chapterId: string) => {
    if (!isMysteryUnlocked(saveRef.current, chapterId)) return;
    commitSave({ ...saveRef.current, activeMysteryId: chapterId });
  };

  const handleDecipherLore = (chapterId: string, attempt: RuneSymbolId[]): boolean => {
    const res = submitCodexDecipher(saveRef.current, chapterId, attempt);
    if (res.ok) {
      audioEngine.playRelic();
      commitSave(res.save);
      return true;
    }
    audioEngine.playLaneSwitch();
    return false;
  };

  const handleWatchRewardedCoins = async (onTick: (sec: number) => void) => {
    const res = await showOptionalRewardedAd(saveRef.current, onTick);
    if (res.granted) {
      audioEngine.playRelic();
      commitSave(res.updatedSave);
    }
  };

  const handleWatchRewardedRevive = async (onTick: (sec: number) => void) => {
    const res = await showOptionalRewardedAd(saveRef.current, onTick);
    if (res.granted) {
      commitSave(res.updatedSave);
      setOutcome(null);
      setGameState('playing');
      engineRef.current?.reviveRun();
    }
  };

  const handleUpdateSettings = (partial: Partial<SaveData['settings']>) => {
    commitSave({
      ...saveRef.current,
      settings: {
        ...saveRef.current.settings,
        ...partial,
      },
    });
  };

  const todayKey = getTodayKey();
  const activeChar = CHARACTERS[save.selectedCharacter];

  return (
    <main className="relative w-full h-full overflow-hidden">
      {/* Isolated WebGL Canvas Container */}
      <div
        ref={canvasMountRef}
        data-testid="game-canvas-container"
        className="absolute inset-0 w-full h-full"
      />

      {/* Screen-State Overlays */}
      {gameState === 'title' && (
        <TitleOverlay
          save={save}
          onStart={handleStartRun}
          onOpenModal={(tab) => setMetaModal(tab)}
          onToggleMute={handleToggleMute}
        />
      )}

      {gameState === 'playing' && (
        <GameHud
          hud={hud}
          soundEnabled={save.settings.soundEnabled}
          showTouchControls={save.settings.showTouchControls}
          abilityName={activeChar.abilityName}
          onMoveLeft={() => engineRef.current?.moveLeft()}
          onMoveRight={() => engineRef.current?.moveRight()}
          onJump={() => engineRef.current?.jump()}
          onSlide={() => engineRef.current?.slide()}
          onAbility={() => engineRef.current?.triggerSpecialAbility()}
          onPause={handlePause}
          onToggleMute={handleToggleMute}
        />
      )}

      {gameState === 'paused' && metaModal === null && (
        <PauseModal
          distance={hud.distance}
          score={hud.score}
          onResume={handleResume}
          onRestart={handleStartRun}
          onOpenSettings={() => setMetaModal('settings')}
          onReturnTitle={handleReturnTitle}
        />
      )}

      {gameState === 'gameover' && outcome && metaModal === null && (
        <GameOverModal
          outcome={outcome}
          canWatchAd={canWatchRewardedAd(save, todayKey)}
          onRetry={handleStartRun}
          onReturnTitle={handleReturnTitle}
          onWatchRewardedRevive={handleWatchRewardedRevive}
          onWatchRewardedCoins={handleWatchRewardedCoins}
        />
      )}

      {metaModal !== null && (
        <MetaModals
          activeTab={metaModal}
          save={save}
          todayKey={todayKey}
          onClose={() => setMetaModal(null)}
          onSwitchTab={(tab) => setMetaModal(tab)}
          onSelectOrUnlockChar={handleSelectOrUnlockChar}
          onSelectOrUnlockCostume={handleSelectOrUnlockCostume}
          onSelectBiome={handleSelectBiome}
          onClaimMission={handleClaimMission}
          onSelectMystery={handleSelectMystery}
          onDecipherLore={handleDecipherLore}
          onWatchRewardedAd={handleWatchRewardedCoins}
          onUpdateSettings={handleUpdateSettings}
        />
      )}
    </main>
  );
}
