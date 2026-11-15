import type { SettingsData } from './types';

class JungleAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicInterval: number | null = null;
  private musicStep = 0;
  private settings: SettingsData = {
    soundEnabled: true,
    musicEnabled: true,
    soundVolume: 0.8,
    graphicsPreset: 'balanced',
    showTouchControls: true,
  };

  public applySettings(settings: SettingsData) {
    this.settings = { ...settings };
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(
        settings.soundEnabled ? settings.soundVolume : 0,
        this.ctx.currentTime,
        0.04
      );
    }
    if (!settings.musicEnabled || !settings.soundEnabled) {
      this.stopAmbientPulse();
    }
  }

  private ensureContext(): AudioContext | null {
    if (!this.settings.soundEnabled) return null;
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.settings.soundVolume;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public unlock() {
    this.ensureContext();
  }

  private tone(
    freq: number,
    endFreq: number,
    duration: number,
    type: OscillatorType,
    gainVal: number,
    delay = 0
  ) {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, endFreq), now + duration);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(gainVal, now + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  public playCoin(combo = 0) {
    const jitter = 0.94 + Math.random() * 0.12;
    const base = (760 + Math.min(10, combo) * 32) * jitter;
    this.tone(base, base * 1.48, 0.13, 'triangle', 0.18);
    this.tone(base * 1.5, base * 2.0, 0.11, 'sine', 0.1, 0.04);
  }

  public playRelic() {
    this.tone(523.25, 659.25, 0.18, 'triangle', 0.22, 0);
    this.tone(659.25, 783.99, 0.2, 'triangle', 0.22, 0.07);
    this.tone(783.99, 1046.5, 0.3, 'sine', 0.24, 0.14);
  }

  public playPowerup() {
    this.tone(330, 660, 0.22, 'sine', 0.2);
    this.tone(495, 990, 0.24, 'triangle', 0.16, 0.06);
  }

  public playJump() {
    const jitter = 0.94 + Math.random() * 0.12;
    this.tone(190 * jitter, 420 * jitter, 0.16, 'sine', 0.16);
  }

  public playLand() {
    this.tone(130, 58, 0.09, 'triangle', 0.14);
  }

  public playSlide() {
    this.tone(240, 110, 0.18, 'sawtooth', 0.07);
  }

  public playLaneSwitch() {
    const jitter = 0.95 + Math.random() * 0.1;
    this.tone(290 * jitter, 360 * jitter, 0.07, 'sine', 0.08);
  }

  public playAbility() {
    this.tone(220, 880, 0.35, 'sawtooth', 0.14);
    this.tone(440, 1320, 0.4, 'triangle', 0.18, 0.05);
  }

  public playHit(heavy = true) {
    this.tone(heavy ? 150 : 210, 42, heavy ? 0.28 : 0.16, 'sawtooth', heavy ? 0.26 : 0.16);
    this.tone(95, 36, 0.24, 'square', 0.12, 0.02);
  }

  public playBossTelegraph() {
    this.tone(110, 185, 0.32, 'sawtooth', 0.15);
  }

  public playPortal() {
    this.tone(392, 784, 0.25, 'sine', 0.2);
    this.tone(587.33, 1174.66, 0.35, 'triangle', 0.18, 0.08);
  }

  public playGameOver() {
    this.tone(340, 220, 0.25, 'triangle', 0.2, 0);
    this.tone(240, 120, 0.45, 'sawtooth', 0.16, 0.18);
  }

  public startAmbientPulse() {
    if (this.musicInterval !== null || !this.settings.musicEnabled || !this.settings.soundEnabled) {
      return;
    }
    const pentatonic = [196, 220, 261.63, 293.66, 329.63, 392, 440, 523.25];
    this.musicInterval = window.setInterval(() => {
      if (!this.settings.musicEnabled || !this.settings.soundEnabled) return;
      if (document.body.dataset.state !== 'playing') return;
      const idx = (this.musicStep * 3 + (this.musicStep % 2)) % pentatonic.length;
      const note = pentatonic[idx];
      // Soft marimba-like rhythmic pulse + tribal bass drum on beat 0/4
      this.tone(note, note * 0.99, 0.22, 'sine', 0.045);
      if (this.musicStep % 4 === 0) {
        this.tone(92, 48, 0.16, 'triangle', 0.065);
      }
      this.musicStep += 1;
    }, 320);
  }

  public stopAmbientPulse() {
    if (this.musicInterval !== null) {
      clearInterval(this.musicInterval);
      this.musicInterval = null;
    }
  }
}

export const audioEngine = new JungleAudioEngine();
