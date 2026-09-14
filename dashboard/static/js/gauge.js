/**
 * ==============================================================================
 * AWR1843BOOST Radar Tachometer - 60 FPS HTML5 Canvas Radial Gauge
 * ==============================================================================
 */

class TachometerGauge {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.targetRpm = 0.0;
    this.currentRpm = 0.0;
    this.maxRpm = 500.0;
    this.isRunning = false;

    // Geometry angles in radians
    this.startAngle = 0.75 * Math.PI; // 135 deg (bottom-left)
    this.endAngle = 2.25 * Math.PI;   // 405 deg (bottom-right)
    this.totalAngle = this.endAngle - this.startAngle; // 270 deg sweep

    // Animation loop
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  setRpm(rpm, isRunning = null) {
    this.targetRpm = Math.max(0, Math.min(this.maxRpm, rpm));
    if (isRunning !== null) {
      this.isRunning = isRunning;
    } else {
      this.isRunning = this.targetRpm > 15.0;
    }
  }

  animate() {
    // Smooth inertial spring damping toward target RPM
    const diff = this.targetRpm - this.currentRpm;
    if (Math.abs(diff) < 0.05) {
      this.currentRpm = this.targetRpm;
    } else {
      this.currentRpm += diff * 0.15;
    }

    this.render();
    requestAnimationFrame(this.animate);
  }

  render() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const cx = w / 2;
    const cy = h / 2 + 10;
    const radius = Math.min(w, h) * 0.42;

    ctx.clearRect(0, 0, w, h);

    // 1. Outer Dark Halo Ring
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 18, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(11, 20, 34, 0.4)';
    ctx.fill();
    ctx.restore();

    // 2. Background Track Arc (Unfilled portion)
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, this.startAngle, this.endAngle);
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.stroke();
    ctx.restore();

    // 3. Active Glowing Fill Arc
    const pct = this.currentRpm / this.maxRpm;
    const activeEndAngle = this.startAngle + (this.totalAngle * pct);

    if (this.currentRpm > 0.5) {
      ctx.save();
      const grad = ctx.createConicGradient(this.startAngle, cx, cy);
      grad.addColorStop(0.0, '#00f0ff');
      grad.addColorStop(0.4, '#00ff88');
      grad.addColorStop(0.8, '#ffb800');
      grad.addColorStop(1.0, '#ff2255');

      ctx.beginPath();
      ctx.arc(cx, cy, radius, this.startAngle, activeEndAngle);
      ctx.lineWidth = 14;
      ctx.lineCap = 'round';
      ctx.strokeStyle = grad;
      ctx.shadowColor = this.isRunning ? '#00ff88' : '#00f0ff';
      ctx.shadowBlur = this.isRunning ? 16 : 8;
      ctx.stroke();
      ctx.restore();
    }

    // 4. Tick Marks & Numeric Scale (0 to 500 RPM)
    ctx.save();
    const numMajorTicks = 10; // 0, 50, 100, ..., 500
    const totalTicks = 50;   // Every 10 RPM

    for (let i = 0; i <= totalTicks; i++) {
      const tickPct = i / totalTicks;
      const angle = this.startAngle + (this.totalAngle * tickPct);
      const isMajor = (i % 5 === 0);

      const tickLen = isMajor ? 14 : 7;
      const rInner = radius - 16;
      const rOuter = rInner - tickLen;

      const x1 = cx + Math.cos(angle) * rInner;
      const y1 = cy + Math.sin(angle) * rInner;
      const x2 = cx + Math.cos(angle) * rOuter;
      const y2 = cy + Math.sin(angle) * rOuter;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineWidth = isMajor ? 2.5 : 1.2;

      // Color ticks based on speed zone
      if (tickPct <= pct && this.currentRpm > 1.0) {
        if (tickPct < 0.4) ctx.strokeStyle = '#00f0ff';
        else if (tickPct < 0.7) ctx.strokeStyle = '#00ff88';
        else ctx.strokeStyle = '#ffb800';
      } else {
        ctx.strokeStyle = isMajor ? 'rgba(255, 255, 255, 0.35)' : 'rgba(255, 255, 255, 0.12)';
      }
      ctx.stroke();

      // Major tick labels
      if (isMajor) {
        const val = Math.round(tickPct * this.maxRpm);
        const rText = rOuter - 14;
        const tx = cx + Math.cos(angle) * rText;
        const ty = cy + Math.sin(angle) * rText;

        ctx.font = '600 11px "JetBrains Mono", monospace';
        ctx.fillStyle = (tickPct <= pct && this.currentRpm > 1.0) ? '#ffffff' : '#6b7280';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(val.toString(), tx, ty);
      }
    }
    ctx.restore();

    // 5. Dial Needle
    const needleAngle = this.startAngle + (this.totalAngle * pct);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(needleAngle);

    // Needle body
    ctx.beginPath();
    ctx.moveTo(-16, -2);
    ctx.lineTo(radius - 22, -1);
    ctx.lineTo(radius - 12, 0);
    ctx.lineTo(radius - 22, 1);
    ctx.lineTo(-16, 2);
    ctx.closePath();

    const needleGrad = ctx.createLinearGradient(0, 0, radius, 0);
    needleGrad.addColorStop(0, 'rgba(0, 240, 255, 0.4)');
    needleGrad.addColorStop(1, '#00f0ff');
    ctx.fillStyle = needleGrad;
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.restore();

    // 6. Center Hub & Readout
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.46, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(7, 13, 22, 0.92)';
    ctx.strokeStyle = this.isRunning ? 'rgba(0, 255, 136, 0.5)' : 'rgba(0, 240, 255, 0.25)';
    ctx.lineWidth = 2;
    if (this.isRunning) {
      ctx.shadowColor = 'rgba(0, 255, 136, 0.4)';
      ctx.shadowBlur = 16;
    }
    ctx.fill();
    ctx.stroke();

    // Digital RPM Readout
    ctx.font = '700 48px "Chakra Petch", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = this.isRunning ? '#00ff88' : '#00f0ff';
    ctx.shadowBlur = this.isRunning ? 14 : 6;
    ctx.fillText(this.currentRpm.toFixed(1), cx, cy - 8);

    // Label: RPM & TACHOMETER
    ctx.shadowBlur = 0;
    ctx.font = '700 13px "JetBrains Mono", monospace';
    ctx.fillStyle = this.isRunning ? '#00ff88' : '#00f0ff';
    ctx.fillText('RPM', cx, cy + 28);

    ctx.font = '600 9px "JetBrains Mono", monospace';
    ctx.fillStyle = '#64748b';
    ctx.letterSpacing = '2px';
    ctx.fillText('RADAR TACHOMETER', cx, cy + 42);

    ctx.restore();
  }
}

window.TachometerGauge = TachometerGauge;
