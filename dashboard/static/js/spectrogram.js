/**
 * ==============================================================================
 * AWR1843BOOST Radar Tachometer - Real-Time Micro-Doppler & Range-Doppler Heatmap
 * ==============================================================================
 * High-performance HTML5 Canvas radar digital signal processing (DSP) visualizer.
 * Renders:
 * 1. Continuous scrolling Micro-Doppler Time-Frequency Spectrogram (Doppler vs. Time)
 * 2. 2D Range-Doppler Heatmap Matrix (Range vs. Velocity)
 * 3. Instantaneous Doppler Frequency Slice Profile with CFAR Detection Threshold
 *
 * Implements realistic 77 GHz mmWave FMCW radar kinematics:
 * lambda = 3.9 mm | Doppler shift fd = 2 * v_r / lambda (513 Hz per m/s)
 * ==============================================================================
 */

class MicroDopplerSpectrogram {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) {
      console.error(`MicroDopplerSpectrogram: Canvas #${canvasId} not found`);
      return;
    }
    this.ctx = this.canvas.getContext('2d');

    // Radar Kinematics State
    this.rpm = 0.0;
    this.targetRpm = 0.0;
    this.isRunning = false;
    this.distMeters = 1.85;
    this.snrDb = 8.0;
    this.bladeRadius = 0.60;
    this.aspectAngleDeg = 30.0;
    this.bladeCount = 3;

    // View Options
    this.viewMode = 'waterfall'; // 'waterfall' or 'range_doppler'
    this.colorPalette = 'cyberpunk'; // 'cyberpunk', 'jet', 'green'
    this.gain = 1.0;
    this.isPaused = false;

    // Canvas & Buffer Dimensions
    this.vBins = 128; // Doppler velocity bins (-64 to +63)
    this.rBins = 80;  // Range bins (0 to ~3.5m)
    this.maxVelocity = 25.0; // m/s
    this.maxRange = 3.5;    // meters

    // Waterfall circular buffer (columns of Doppler FFT data over time)
    this.waterfallWidth = 260; // time slices
    this.waterfallData = [];
    for (let x = 0; x < this.waterfallWidth; x++) {
      this.waterfallData.push(new Float32Array(this.vBins));
    }
    this.waterfallHead = 0;

    // Color Maps pre-calculated for speed (256 color lookup table)
    this.colorLuts = {
      cyberpunk: this.generateLut([
        { pos: 0.0, r: 7, g: 11, b: 18 },      // Dark navy background
        { pos: 0.2, r: 12, g: 35, b: 64 },     // Deep blue
        { pos: 0.45, r: 0, g: 240, b: 255 },   // Electric Cyan
        { pos: 0.7, r: 0, g: 255, b: 136 },    // Neon Emerald
        { pos: 0.88, r: 255, g: 184, b: 0 },   // Amber
        { pos: 1.0, r: 255, g: 0, b: 119 }     // Hot Magenta Peak
      ]),
      jet: this.generateLut([
        { pos: 0.0, r: 0, g: 0, b: 64 },
        { pos: 0.25, r: 0, g: 128, b: 255 },
        { pos: 0.5, r: 0, g: 255, b: 128 },
        { pos: 0.75, r: 255, g: 255, b: 0 },
        { pos: 1.0, r: 255, g: 32, b: 0 }
      ]),
      green: this.generateLut([
        { pos: 0.0, r: 5, g: 12, b: 8 },
        { pos: 0.3, r: 10, g: 45, b: 25 },
        { pos: 0.6, r: 0, g: 180, b: 80 },
        { pos: 0.85, r: 0, g: 255, b: 136 },
        { pos: 1.0, r: 220, g: 255, b: 230 }
      ])
    };

    // Offscreen rendering buffers
    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCtx = this.offscreenCanvas.getContext('2d');

    // Simulation Phase
    this.simPhase = 0.0;
    this.lastSimTime = performance.now();

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.startLoop();
  }

  generateLut(colorStops) {
    const lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
      const t = i / 255.0;
      let left = colorStops[0];
      let right = colorStops[colorStops.length - 1];

      for (let s = 0; s < colorStops.length - 1; s++) {
        if (t >= colorStops[s].pos && t <= colorStops[s + 1].pos) {
          left = colorStops[s];
          right = colorStops[s + 1];
          break;
        }
      }

      const segmentT = (t - left.pos) / Math.max(0.0001, right.pos - left.pos);
      const r = Math.round(left.r + (right.r - left.r) * segmentT);
      const g = Math.round(left.g + (right.g - left.g) * segmentT);
      const b = Math.round(left.b + (right.b - left.b) * segmentT);

      lut[i * 3 + 0] = r;
      lut[i * 3 + 1] = g;
      lut[i * 3 + 2] = b;
    }
    return lut;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = rect.width || 600;
    const height = rect.height || 260;

    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.displayWidth = width;
    this.displayHeight = height;
  }

  setTelemetry(data) {
    if (data.rpm !== undefined) this.targetRpm = Math.max(0.0, data.rpm);
    if (data.is_running !== undefined) this.isRunning = data.is_running;
    if (data.dist !== undefined) this.distMeters = data.dist;
    if (data.snr !== undefined) this.snrDb = data.snr;
    if (data.radius !== undefined) this.bladeRadius = data.radius;
    if (data.angle !== undefined) this.aspectAngleDeg = data.angle;
  }

  setViewMode(mode) {
    if (mode === 'waterfall' || mode === 'range_doppler') {
      this.viewMode = mode;
    }
  }

  cyclePalette() {
    const palettes = ['cyberpunk', 'jet', 'green'];
    const idx = palettes.indexOf(this.colorPalette);
    this.colorPalette = palettes[(idx + 1) % palettes.length];
    return this.colorPalette;
  }

  togglePause() {
    this.isPaused = !this.isPaused;
    return this.isPaused;
  }

  setGain(val) {
    this.gain = Math.max(0.2, Math.min(3.0, val));
  }

  // ----------------------------------------------------------------------------
  // Radar Micro-Doppler Physics Generator
  // ----------------------------------------------------------------------------
  computeDopplerSlice(dt) {
    const slice = new Float32Array(this.vBins);
    const halfV = this.vBins / 2;

    // Smooth RPM
    this.rpm += (this.targetRpm - this.rpm) * 0.15;
    if (this.rpm < 2.0) this.rpm = 0.0;

    const omega = 2.0 * Math.PI * (this.rpm / 60.0);
    this.simPhase += omega * dt;

    const thetaRad = (this.aspectAngleDeg * Math.PI) / 180.0;
    const cosTheta = Math.cos(thetaRad);
    const maxTipVel = omega * this.bladeRadius * cosTheta;

    // 1. Thermal Noise Floor (Gaussian-like noise floor)
    const noiseLevel = 0.06;
    for (let i = 0; i < this.vBins; i++) {
      slice[i] = noiseLevel * (0.6 + Math.random() * 0.8);
    }

    // 2. Hub stationary radar reflection at 0 m/s (center bin)
    if (this.distMeters > 0.5) {
      const hubEnergy = 0.45;
      slice[halfV] += hubEnergy;
      slice[halfV - 1] += hubEnergy * 0.5;
      slice[halfV + 1] += hubEnergy * 0.5;
    }

    // 3. Rotating Blades Micro-Doppler Signal
    if (this.isRunning && this.rpm > 10.0 && maxTipVel > 0.2) {
      const snrFactor = Math.min(2.5, Math.max(0.4, (this.snrDb + 5.0) / 15.0));

      for (let b = 0; b < this.bladeCount; b++) {
        const bladeAngle = this.simPhase + (b * 2.0 * Math.PI) / this.bladeCount;
        // Radial velocity seen by radar: v_r = v_tip * cos(theta) * sin(bladeAngle)
        const vRadial = maxTipVel * Math.sin(bladeAngle);

        // Blade tip velocity bin index
        const binIndex = Math.round(halfV + (vRadial / this.maxVelocity) * halfV);

        // Broadside specular blade flash occurs when blade is perpendicular to radar line of sight
        const isFlash = Math.abs(Math.cos(bladeAngle)) < 0.12;
        const flashGain = isFlash ? 1.9 : 1.0;

        // Distribute energy across blade length from root (v=0) to tip (v=vRadial)
        const step = vRadial >= 0 ? 1 : -1;
        const numSteps = Math.min(Math.abs(binIndex - halfV), halfV);

        for (let s = 0; s <= numSteps; s++) {
          const currentBin = halfV + (s * step);
          if (currentBin >= 0 && currentBin < this.vBins) {
            // Tip has highest radar cross section (RCS), root has lower
            const rcsProfile = 0.25 + 0.75 * Math.pow((s + 1) / Math.max(1, numSteps), 1.5);
            const energy = (rcsProfile * 0.55 * snrFactor * flashGain) / Math.max(1, Math.sqrt(numSteps));
            slice[currentBin] += energy;
          }
        }

        // Add bright tip cluster
        if (binIndex >= 0 && binIndex < this.vBins) {
          slice[binIndex] += 0.4 * snrFactor * flashGain;
          if (binIndex - 1 >= 0) slice[binIndex - 1] += 0.2 * snrFactor * flashGain;
          if (binIndex + 1 < this.vBins) slice[binIndex + 1] += 0.2 * snrFactor * flashGain;
        }
      }
    }

    // Clamp values
    for (let i = 0; i < this.vBins; i++) {
      slice[i] = Math.min(1.0, slice[i] * this.gain);
    }

    return slice;
  }

  // ----------------------------------------------------------------------------
  // Render Loop
  // ----------------------------------------------------------------------------
  startLoop() {
    const frame = (timestamp) => {
      requestAnimationFrame(frame);

      const now = performance.now();
      const dt = Math.min(0.1, (now - this.lastSimTime) / 1000.0);
      this.lastSimTime = now;

      if (!this.isPaused) {
        const slice = this.computeDopplerSlice(dt);
        this.waterfallData[this.waterfallHead] = slice;
        this.waterfallHead = (this.waterfallHead + 1) % this.waterfallWidth;
      }

      this.render();
    };
    requestAnimationFrame(frame);
  }

  render() {
    const w = this.displayWidth;
    const h = this.displayHeight;
    this.ctx.clearRect(0, 0, w, h);

    // Profile Slice width on the right
    const sliceWidth = 90;
    const mainPlotWidth = w - sliceWidth - 45;
    const plotHeight = h - 35;

    if (this.viewMode === 'waterfall') {
      this.renderWaterfall(15, 10, mainPlotWidth, plotHeight);
    } else {
      this.renderRangeDoppler(15, 10, mainPlotWidth, plotHeight);
    }

    // Render instantaneous Doppler Slice profile curve on right
    this.renderSliceProfile(w - sliceWidth - 10, 10, sliceWidth, plotHeight);

    // Render Axis Labels and Legends
    this.renderAxesAndLabels(15, 10, mainPlotWidth, plotHeight);
  }

  renderWaterfall(x, y, w, h) {
    if (this.offscreenCanvas.width !== this.waterfallWidth || this.offscreenCanvas.height !== this.vBins) {
      this.offscreenCanvas.width = this.waterfallWidth;
      this.offscreenCanvas.height = this.vBins;
    }

    const imgData = this.offscreenCtx.createImageData(this.waterfallWidth, this.vBins);
    const data = imgData.data;
    const lut = this.colorLuts[this.colorPalette];

    // Read circular buffer in order from oldest to newest
    for (let col = 0; col < this.waterfallWidth; col++) {
      const bufIdx = (this.waterfallHead + col) % this.waterfallWidth;
      const slice = this.waterfallData[bufIdx];

      for (let row = 0; row < this.vBins; row++) {
        // Invert Y so +Velocity is on top
        const sliceIdx = this.vBins - 1 - row;
        const val = slice[sliceIdx];
        const lutIdx = Math.min(255, Math.floor(val * 255));

        const pixelIdx = (row * this.waterfallWidth + col) * 4;
        data[pixelIdx + 0] = lut[lutIdx * 3 + 0];
        data[pixelIdx + 1] = lut[lutIdx * 3 + 1];
        data[pixelIdx + 2] = lut[lutIdx * 3 + 2];
        data[pixelIdx + 3] = 255;
      }
    }

    this.offscreenCtx.putImageData(imgData, 0, 0);

    // Smoothly stretch onto display canvas
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.offscreenCanvas, x, y, w, h);
    this.ctx.imageSmoothingEnabled = true;

    // Draw zero Doppler centerline (dashed cyan line)
    this.ctx.strokeStyle = 'rgba(0, 240, 255, 0.4)';
    this.ctx.setLineDash([4, 4]);
    this.ctx.beginPath();
    this.ctx.moveTo(x, y + h / 2);
    this.ctx.lineTo(x + w, y + h / 2);
    this.ctx.stroke();
    this.ctx.setLineDash([]);
  }

  renderRangeDoppler(x, y, w, h) {
    // Range-Doppler Matrix: X = Range (0-3.5m), Y = Velocity (-25 to +25 m/s)
    if (this.offscreenCanvas.width !== this.rBins || this.offscreenCanvas.height !== this.vBins) {
      this.offscreenCanvas.width = this.rBins;
      this.offscreenCanvas.height = this.vBins;
    }

    const imgData = this.offscreenCtx.createImageData(this.rBins, this.vBins);
    const data = imgData.data;
    const lut = this.colorLuts[this.colorPalette];

    const targetRangeBin = Math.round((this.distMeters / this.maxRange) * this.rBins);
    const halfV = this.vBins / 2;

    const omega = 2.0 * Math.PI * (this.rpm / 60.0);
    const thetaRad = (this.aspectAngleDeg * Math.PI) / 180.0;
    const maxTipVel = omega * this.bladeRadius * Math.cos(thetaRad);
    const tipBinExtent = Math.round((maxTipVel / this.maxVelocity) * halfV);

    for (let r = 0; r < this.rBins; r++) {
      const distDiff = Math.abs(r - targetRangeBin);
      const isTargetRange = distDiff <= 2;

      for (let v = 0; v < this.vBins; v++) {
        // Invert Y so +V is at top
        const velBin = this.vBins - 1 - v;
        const velDistFromCenter = Math.abs(velBin - halfV);

        let energy = 0.04 * (0.7 + Math.random() * 0.6); // Noise

        if (isTargetRange && this.isRunning && this.rpm > 10.0) {
          // Hub return at V=0
          if (velDistFromCenter <= 1 && distDiff === 0) {
            energy += 0.85;
          }
          // Blade Doppler wings spreading between -Vtip and +Vtip
          if (velDistFromCenter <= tipBinExtent) {
            const rangeFalloff = 1.0 - (distDiff / 2.5);
            const bladeProfile = 0.35 + 0.45 * (velDistFromCenter / Math.max(1, tipBinExtent));
            energy += bladeProfile * rangeFalloff * (this.snrDb / 12.0);
          }
        } else if (isTargetRange && !this.isRunning) {
          if (velDistFromCenter <= 1 && distDiff === 0) {
            energy += 0.4;
          }
        }

        const lutIdx = Math.min(255, Math.floor(Math.min(1.0, energy * this.gain) * 255));
        const pixelIdx = (v * this.rBins + r) * 4;
        data[pixelIdx + 0] = lut[lutIdx * 3 + 0];
        data[pixelIdx + 1] = lut[lutIdx * 3 + 1];
        data[pixelIdx + 2] = lut[lutIdx * 3 + 2];
        data[pixelIdx + 3] = 255;
      }
    }

    this.offscreenCtx.putImageData(imgData, 0, 0);

    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.offscreenCanvas, x, y, w, h);
    this.ctx.imageSmoothingEnabled = true;

    // Zero Doppler & Target Distance crosshairs
    this.ctx.strokeStyle = 'rgba(0, 240, 255, 0.4)';
    this.ctx.setLineDash([3, 3]);
    this.ctx.beginPath();
    this.ctx.moveTo(x, y + h / 2);
    this.ctx.lineTo(x + w, y + h / 2);
    this.ctx.stroke();

    const targetX = x + (this.distMeters / this.maxRange) * w;
    this.ctx.strokeStyle = 'rgba(255, 184, 0, 0.5)';
    this.ctx.beginPath();
    this.ctx.moveTo(targetX, y);
    this.ctx.lineTo(targetX, y + h);
    this.ctx.stroke();
    this.ctx.setLineDash([]);
  }

  renderSliceProfile(x, y, w, h) {
    // Current instantaneous Doppler slice
    const latestSlice = this.waterfallData[(this.waterfallHead - 1 + this.waterfallWidth) % this.waterfallWidth];

    // Background
    this.ctx.fillStyle = 'rgba(9, 17, 28, 0.75)';
    this.ctx.fillRect(x, y, w, h);
    this.ctx.strokeStyle = 'rgba(0, 240, 255, 0.25)';
    this.ctx.strokeRect(x, y, w, h);

    // CFAR Detection Threshold Line
    const cfarY = y + h * 0.78;
    this.ctx.strokeStyle = 'rgba(255, 34, 85, 0.6)';
    this.ctx.setLineDash([2, 2]);
    this.ctx.beginPath();
    this.ctx.moveTo(x + 5, cfarY);
    this.ctx.lineTo(x + w - 5, cfarY);
    this.ctx.stroke();
    this.ctx.setLineDash([]);

    // Curve
    this.ctx.strokeStyle = '#00ff88';
    this.ctx.lineWidth = 1.5;
    this.ctx.beginPath();

    const halfV = this.vBins / 2;
    for (let i = 0; i < this.vBins; i++) {
      const val = latestSlice[this.vBins - 1 - i]; // Invert so +V is on top
      const px = x + 4 + val * (w - 10);
      const py = y + (i / (this.vBins - 1)) * h;

      if (i === 0) this.ctx.moveTo(px, py);
      else this.ctx.lineTo(px, py);
    }
    this.ctx.stroke();

    // Slice Header
    this.ctx.font = '9px "JetBrains Mono", monospace';
    this.ctx.fillStyle = 'rgba(0, 240, 255, 0.8)';
    this.ctx.fillText('FFT SLICE', x + 6, y + 12);
    this.ctx.fillStyle = 'rgba(255, 34, 85, 0.8)';
    this.ctx.fillText('CFAR THRESH', x + 6, cfarY - 3);
  }

  renderAxesAndLabels(x, y, w, h) {
    this.ctx.font = '10px "JetBrains Mono", monospace';
    this.ctx.fillStyle = '#88a2c2';

    // Doppler Velocity Y-Axis markers (+25, 0, -25 m/s)
    this.ctx.textAlign = 'right';
    this.ctx.fillText(`+${this.maxVelocity} m/s`, x + w - 6, y + 12);
    this.ctx.fillText('0 m/s', x + w - 6, y + h / 2 + 3);
    this.ctx.fillText(`-${this.maxVelocity} m/s`, x + w - 6, y + h - 4);

    // X-Axis Title / Markers
    this.ctx.textAlign = 'left';
    if (this.viewMode === 'waterfall') {
      this.ctx.fillText('◄ TIME (PAST 12s)', x + 6, y + h + 18);
      this.ctx.textAlign = 'right';
      this.ctx.fillText('NOW ◄', x + w, y + h + 18);
    } else {
      this.ctx.fillText('RANGE: 0.0m', x + 6, y + h + 18);
      this.ctx.textAlign = 'center';
      this.ctx.fillText(`TARGET: ${this.distMeters.toFixed(2)}m`, x + (this.distMeters / this.maxRange) * w, y + h + 18);
      this.ctx.textAlign = 'right';
      this.ctx.fillText(`${this.maxRange.toFixed(1)}m`, x + w, y + h + 18);
    }

    // Top Mode Indicator
    this.ctx.textAlign = 'left';
    this.ctx.fillStyle = '#00f0ff';
    const modeName = this.viewMode === 'waterfall'
      ? 'MICRO-DOPPLER SPECTROGRAM [t vs. fd]'
      : 'RANGE-DOPPLER 2D HEATMAP [R vs. v]';
    this.ctx.fillText(modeName, x + 6, y - 2);
  }
}
