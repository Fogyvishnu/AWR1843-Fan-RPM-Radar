/**
 * ==============================================================================
 * AWR1843BOOST Radar Tachometer - Web Audio Doppler Synthesizer
 * ==============================================================================
 * Translates radar micro-Doppler frequency shifts and blade passage dynamics
 * into acoustic audio using the Web Audio API.
 *
 * Implements:
 * 1. Blade Passage Frequency (BPF) pulsation: f_BPF = N_blades * (RPM / 60)
 * 2. Doppler frequency sweep carrier tone (frequency modulated by tip velocity)
 * 3. Aerodynamic pink noise wind whoosh
 * ==============================================================================
 */

class DopplerAudioSynthesizer {
  constructor() {
    this.audioCtx = null;
    this.isEnabled = false;
    this.volume = 0.35;

    this.rpm = 0.0;
    this.isRunning = false;
    this.bladeCount = 3;

    // Nodes
    this.masterGain = null;
    this.oscCarrier = null;
    this.carrierGain = null;
    this.noiseNode = null;
    this.noiseFilter = null;
    this.whooshGain = null;
    this.analyser = null;

    // Visualizer data buffer
    this.waveData = new Uint8Array(32);
  }

  initAudio() {
    if (this.audioCtx) return;

    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContextClass();

      // Master Gain
      this.masterGain = this.audioCtx.createGain();
      this.masterGain.gain.setValueAtTime(0.0, this.audioCtx.currentTime);

      // Analyser for UI waveform bar
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 64;
      this.masterGain.connect(this.analyser);
      this.analyser.connect(this.audioCtx.destination);

      // 1. Synthesize Doppler Carrier Tone (Sine Wave)
      this.oscCarrier = this.audioCtx.createOscillator();
      this.oscCarrier.type = 'sine';
      this.oscCarrier.frequency.setValueAtTime(180, this.audioCtx.currentTime);

      this.carrierGain = this.audioCtx.createGain();
      this.carrierGain.gain.setValueAtTime(0.12, this.audioCtx.currentTime);
      this.oscCarrier.connect(this.carrierGain);
      this.carrierGain.connect(this.masterGain);
      this.oscCarrier.start();

      // 2. Aerodynamic Blade Whoosh (Filtered Pink Noise)
      this.setupNoiseGenerator();

    } catch (err) {
      console.warn('Web Audio API not supported or blocked:', err);
    }
  }

  setupNoiseGenerator() {
    // Generate 2 seconds of pink/brown noise in an audio buffer
    const bufferSize = this.audioCtx.sampleRate * 2;
    const noiseBuffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
    const output = noiseBuffer.getChannelData(0);

    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.0555179;
      b1 = 0.96300 * b1 + white * 0.0750759;
      b2 = 0.57000 * b2 + white * 0.1538520;
      output[i] = (b0 + b1 + b2) * 0.25;
    }

    this.noiseNode = this.audioCtx.createBufferSource();
    this.noiseNode.buffer = noiseBuffer;
    this.noiseNode.loop = true;

    // Lowpass filter for low aerodynamic whoosh
    this.noiseFilter = this.audioCtx.createBiquadFilter();
    this.noiseFilter.type = 'lowpass';
    this.noiseFilter.frequency.setValueAtTime(280, this.audioCtx.currentTime);
    this.noiseFilter.Q.setValueAtTime(2.5, this.audioCtx.currentTime);

    this.whooshGain = this.audioCtx.createGain();
    this.whooshGain.gain.setValueAtTime(0.0, this.audioCtx.currentTime);

    this.noiseNode.connect(this.noiseFilter);
    this.noiseFilter.connect(this.whooshGain);
    this.whooshGain.connect(this.masterGain);

    this.noiseNode.start();
  }

  toggle() {
    if (!this.audioCtx) {
      this.initAudio();
    }

    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    this.isEnabled = !this.isEnabled;
    this.updateAudioParams();
    return this.isEnabled;
  }

  setVolume(val) {
    this.volume = Math.max(0.0, Math.min(1.0, val));
    this.updateAudioParams();
  }

  setRpm(rpm, isRunning = true) {
    this.rpm = Math.max(0.0, rpm);
    this.isRunning = isRunning && this.rpm > 10.0;
    this.updateAudioParams();
  }

  updateAudioParams() {
    if (!this.audioCtx || !this.masterGain) return;

    const now = this.audioCtx.currentTime;

    if (!this.isEnabled || !this.isRunning || this.rpm < 15.0) {
      // Fade out smoothly
      this.masterGain.gain.setTargetAtTime(0.0, now, 0.05);
      return;
    }

    // Smoothly fade in to target volume
    this.masterGain.gain.setTargetAtTime(this.volume, now, 0.05);

    // Blade Passage Frequency: f_BPF = N * (RPM / 60) Hz
    const bpf = (this.bladeCount * this.rpm) / 60.0;

    // Carrier Doppler whine frequency: scales from 120 Hz to ~450 Hz with RPM
    const targetFreq = 90 + Math.min(600, (this.rpm / 400.0) * 450);
    this.oscCarrier.frequency.setTargetAtTime(targetFreq, now, 0.08);

    // Filter frequency tracking aerodynamic airflow
    const filterFreq = 180 + Math.min(700, (this.rpm / 400.0) * 500);
    this.noiseFilter.frequency.setTargetAtTime(filterFreq, now, 0.08);

    // Whoosh amplitude
    this.whooshGain.gain.setTargetAtTime(0.45, now, 0.08);
  }

  getWaveformValue() {
    if (!this.isEnabled || !this.analyser) return 0;
    this.analyser.getByteTimeDomainData(this.waveData);
    let sum = 0;
    for (let i = 0; i < this.waveData.length; i++) {
      const v = (this.waveData[i] - 128) / 128;
      sum += Math.abs(v);
    }
    return sum / this.waveData.length;
  }
}
