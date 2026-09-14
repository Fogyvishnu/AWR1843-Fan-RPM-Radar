/**
 * ==============================================================================
 * AWR1843BOOST Radar Tachometer - Real-Time 60 FPS Scrolling Strip Charts
 * ==============================================================================
 */

class RpmStripChart {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.history = []; // Array of { time: timestamp_ms, val: rpm }
    this.maxDurationSec = 60;
    this.maxVal = 400; // Dynamic scale ceiling

    this.initResize();
  }

  initResize() {
    const resize = () => {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      this.canvas.width = rect.width * (window.devicePixelRatio || 1);
      this.canvas.height = 150 * (window.devicePixelRatio || 1);
      this.render();
    };
    window.addEventListener('resize', resize);
    resize();
  }

  setRange(sec) {
    this.maxDurationSec = sec;
    this.render();
  }

  addDataPoint(rpm, timestampMs) {
    const ts = timestampMs || Date.now();
    this.history.push({ time: ts, val: rpm });

    // Prune points older than max history
    const cutoff = ts - (this.maxDurationSec * 1000) - 2000;
    while (this.history.length > 0 && this.history[0].time < cutoff) {
      this.history.shift();
    }

    this.render();
  }

  render() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);

    if (this.history.length === 0) {
      this.drawGrid(ctx, w, h, 400);
      return;
    }

    // Determine current scale ceiling
    let maxObserved = 250;
    let minObserved = 9999;
    let sum = 0;
    for (const pt of this.history) {
      if (pt.val > maxObserved) maxObserved = pt.val;
      if (pt.val < minObserved) minObserved = pt.val;
      sum += pt.val;
    }
    const avgObserved = sum / this.history.length;
    this.maxVal = Math.max(300, Math.ceil(maxObserved * 1.15 / 50) * 50);

    // Update stat pill counters in DOM
    const elMin = document.getElementById('statMinRpm');
    const elAvg = document.getElementById('statAvgRpm');
    const elMax = document.getElementById('statMaxRpm');
    if (elMin && elAvg && elMax && this.history.length > 0) {
      elMin.innerText = (minObserved === 9999 ? 0.0 : minObserved).toFixed(1);
      elAvg.innerText = avgObserved.toFixed(1);
      elMax.innerText = maxObserved.toFixed(1);
    }

    // Draw background grid lines and scale markers
    this.drawGrid(ctx, w, h, this.maxVal);

    // Plot waveform
    const now = Date.now();
    const durationMs = this.maxDurationSec * 1000;
    const paddingLeft = 45;
    const paddingRight = 15;
    const paddingTop = 12;
    const paddingBottom = 22;
    const plotW = w - paddingLeft - paddingRight;
    const plotH = h - paddingTop - paddingBottom;

    ctx.save();
    ctx.beginPath();

    let firstX = null;
    let lastX = null;

    for (let i = 0; i < this.history.length; i++) {
      const pt = this.history[i];
      const ageMs = now - pt.time;
      const xPct = 1.0 - Math.min(1.0, Math.max(0.0, ageMs / durationMs));
      const yPct = Math.min(1.0, Math.max(0.0, pt.val / this.maxVal));

      const x = paddingLeft + (xPct * plotW);
      const y = paddingTop + plotH - (yPct * plotH);

      if (i === 0) {
        ctx.moveTo(x, y);
        firstX = x;
      } else {
        ctx.lineTo(x, y);
      }
      lastX = x;
    }

    // Stroke line with glow
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#00ff88';
    ctx.shadowColor = '#00ff88';
    ctx.shadowBlur = 8;
    ctx.stroke();

    // Area fill gradient under curve
    if (firstX !== null && lastX !== null) {
      ctx.lineTo(lastX, paddingTop + plotH);
      ctx.lineTo(firstX, paddingTop + plotH);
      ctx.closePath();

      const fillGrad = ctx.createLinearGradient(0, paddingTop, 0, paddingTop + plotH);
      fillGrad.addColorStop(0, 'rgba(0, 255, 136, 0.25)');
      fillGrad.addColorStop(1, 'rgba(0, 255, 136, 0.0)');
      ctx.fillStyle = fillGrad;
      ctx.shadowBlur = 0;
      ctx.fill();
    }
    ctx.restore();
  }

  drawGrid(ctx, w, h, maxVal) {
    const paddingLeft = 45;
    const paddingRight = 15;
    const paddingTop = 12;
    const paddingBottom = 22;
    const plotW = w - paddingLeft - paddingRight;
    const plotH = h - paddingTop - paddingBottom;

    ctx.save();
    ctx.lineWidth = 1;
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = '#4e6580';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    // Horizontal Y-axis grid lines (4 divisions)
    const ySteps = 4;
    for (let i = 0; i <= ySteps; i++) {
      const yVal = Math.round((maxVal / ySteps) * i);
      const y = paddingTop + plotH - ((i / ySteps) * plotH);

      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.moveTo(paddingLeft, y);
      ctx.lineTo(w - paddingRight, y);
      ctx.stroke();

      ctx.fillText(yVal.toString(), paddingLeft - 8, y);
    }

    // Vertical X-axis time marks (-60s, -45s, -30s, -15s, NOW)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const xSteps = 4;
    for (let j = 0; j <= xSteps; j++) {
      const x = paddingLeft + ((j / xSteps) * plotW);
      const secAgo = Math.round(this.maxDurationSec * (1.0 - j / xSteps));
      const label = secAgo === 0 ? 'NOW' : `-${secAgo}s`;

      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.moveTo(x, paddingTop);
      ctx.lineTo(x, paddingTop + plotH);
      ctx.stroke();

      ctx.fillText(label, x, paddingTop + plotH + 5);
    }
    ctx.restore();
  }
}

class TelemetryDualChart {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.history = []; // { time, tipVel, snr }
    this.maxDurationSec = 60;

    this.initResize();
  }

  initResize() {
    const resize = () => {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      this.canvas.width = rect.width * (window.devicePixelRatio || 1);
      this.canvas.height = 110 * (window.devicePixelRatio || 1);
      this.render();
    };
    window.addEventListener('resize', resize);
    resize();
  }

  addDataPoint(tipVel, snr, timestampMs) {
    const ts = timestampMs || Date.now();
    this.history.push({ time: ts, tipVel: tipVel, snr: snr });

    const cutoff = ts - (this.maxDurationSec * 1000) - 2000;
    while (this.history.length > 0 && this.history[0].time < cutoff) {
      this.history.shift();
    }

    this.render();
  }

  render() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    const paddingLeft = 45;
    const paddingRight = 15;
    const paddingTop = 8;
    const paddingBottom = 18;
    const plotW = w - paddingLeft - paddingRight;
    const plotH = h - paddingTop - paddingBottom;

    // Grid
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 2; i++) {
      const y = paddingTop + (plotH * (i / 2));
      ctx.beginPath();
      ctx.moveTo(paddingLeft, y);
      ctx.lineTo(w - paddingRight, y);
      ctx.stroke();
    }
    ctx.restore();

    if (this.history.length === 0) return;

    const now = Date.now();
    const durationMs = this.maxDurationSec * 1000;
    const maxVel = 25.0; // m/s scale ceiling
    const maxSnr = 20.0; // dB scale ceiling

    // Trace 1: Tip Velocity (Violet)
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < this.history.length; i++) {
      const pt = this.history[i];
      const ageMs = now - pt.time;
      const xPct = 1.0 - Math.min(1.0, Math.max(0.0, ageMs / durationMs));
      const yPct = Math.min(1.0, Math.max(0.0, pt.tipVel / maxVel));
      const x = paddingLeft + (xPct * plotW);
      const y = paddingTop + plotH - (yPct * plotH);

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineWidth = 2.0;
    ctx.strokeStyle = '#a855f7';
    ctx.shadowColor = '#a855f7';
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.restore();

    // Trace 2: SNR (Emerald Green)
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < this.history.length; i++) {
      const pt = this.history[i];
      const ageMs = now - pt.time;
      const xPct = 1.0 - Math.min(1.0, Math.max(0.0, ageMs / durationMs));
      const yPct = Math.min(1.0, Math.max(0.0, Math.max(0, pt.snr) / maxSnr));
      const x = paddingLeft + (xPct * plotW);
      const y = paddingTop + plotH - (yPct * plotH);

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineWidth = 2.0;
    ctx.strokeStyle = '#00ff88';
    ctx.shadowColor = '#00ff88';
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.restore();
  }
}

window.RpmStripChart = RpmStripChart;
window.TelemetryDualChart = TelemetryDualChart;
