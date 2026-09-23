/**
 * ==============================================================================
 * AWR1843BOOST Radar Tachometer - Minimalist Precision Canvas Radial Gauge
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

    // Geometry angles in radians: 260 deg sweep
    this.startAngle = 0.77 * Math.PI; // ~138 deg (bottom-left)
    this.endAngle = 2.23 * Math.PI;   // ~402 deg (bottom-right)
    this.totalAngle = this.endAngle - this.startAngle;

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
      this.currentRpm += diff * 0.14;
    }

    this.render();
    requestAnimationFrame(this.animate);
  }

  render() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const cx = w / 2;
    const cy = h / 2 + 8;
    const radius = Math.min(w, h) * 0.40;

    ctx.clearRect(0, 0, w, h);

    // 1. Background Track Arc (Muted Slate / Charcoal)
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, this.startAngle, this.endAngle);
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.stroke();
    ctx.restore();

    // 2. Active Progress Arc (Precision Emerald with subtle cyan transition)
    const pct = Math.max(0, Math.min(1.0, this.currentRpm / this.maxRpm));
    const activeEndAngle = this.startAngle + (this.totalAngle * pct);

    if (this.currentRpm > 0.5) {
      ctx.save();
      const grad = ctx.createLinearGradient(
        cx - radius, cy + radius,
        cx + radius, cy - radius
      );
      grad.addColorStop(0.0, '#0ea5e9'); // Cyan
      grad.addColorStop(0.5, '#10b981'); // Emerald
      grad.addColorStop(1.0, '#34d399'); // Mint

      ctx.beginPath();
      ctx.arc(cx, cy, radius, this.startAngle, activeEndAngle);
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      ctx.strokeStyle = grad;
      ctx.stroke();
      ctx.restore();
    }

    // 3. Minimalist Precision Ticks (0, 50, 100, ..., 500)
    ctx.save();
    const totalTicks = 50;   // Every 10 RPM
    for (let i = 0; i <= totalTicks; i++) {
      const tickPct = i / totalTicks;
      const angle = this.startAngle + (this.totalAngle * tickPct);
      const isMajor = (i % 10 === 0);
      const isMedium = (i % 5 === 0);

      const tickLen = isMajor ? 10 : (isMedium ? 6 : 3);
      const rInner = radius - 14;
      const rOuter = rInner - tickLen;

      const x1 = cx + Math.cos(angle) * rInner;
      const y1 = cy + Math.sin(angle) * rInner;
      const x2 = cx + Math.cos(angle) * rOuter;
      const y2 = cy + Math.sin(angle) * rOuter;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineWidth = isMajor ? 1.8 : 1.0;

      if (tickPct <= pct && this.currentRpm > 1.0) {
        ctx.strokeStyle = '#10b981';
      } else {
        ctx.strokeStyle = isMajor ? 'rgba(255, 255, 255, 0.28)' : 'rgba(255, 255, 255, 0.09)';
      }
      ctx.stroke();

      // Major numerical labels (0, 100, 200, 300, 400, 500)
      if (isMajor) {
        const val = Math.round(tickPct * this.maxRpm);
        const rText = rOuter - 12;
        const tx = cx + Math.cos(angle) * rText;
        const ty = cy + Math.sin(angle) * rText;

        ctx.font = '500 11px -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif';
        ctx.fillStyle = (tickPct <= pct && this.currentRpm > 1.0) ? '#e2e8f0' : '#64748b';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(val.toString(), tx, ty);
      }
    }
    ctx.restore();

    // 4. Sleek Minimalist Dial Needle
    const needleAngle = this.startAngle + (this.totalAngle * pct);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(needleAngle);

    ctx.beginPath();
    ctx.moveTo(-10, -1.5);
    ctx.lineTo(radius - 20, -0.75);
    ctx.lineTo(radius - 12, 0);
    ctx.lineTo(radius - 20, 0.75);
    ctx.lineTo(-10, 1.5);
    ctx.closePath();

    ctx.fillStyle = this.isRunning ? '#10b981' : '#94a3b8';
    ctx.fill();
    ctx.restore();

    // 5. Center Hub: Flat Minimalist Disc
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.44, 0, Math.PI * 2);
    ctx.fillStyle = '#11151c';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();

    // Large Digital RPM Readout
    ctx.font = '600 48px -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.currentRpm.toFixed(1), cx, cy - 8);

    // Units label: RPM
    ctx.font = '600 12px "JetBrains Mono", monospace';
    ctx.fillStyle = this.isRunning ? '#10b981' : '#64748b';
    ctx.letterSpacing = '1.5px';
    ctx.fillText('RPM', cx, cy + 26);

    // Subtle Sub-indicator
    ctx.font = '500 10px -apple-system, BlinkMacSystemFont, "Inter", sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillText(this.isRunning ? 'RADAR ACTIVE' : 'STANDBY', cx, cy + 42);

    ctx.restore();
  }
}

window.TachometerGauge = TachometerGauge;
