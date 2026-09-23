/**
 * ==============================================================================
 * AWR1843BOOST Radar Tachometer - Main Web HUD Controller
 * ==============================================================================
 */

document.addEventListener('DOMContentLoaded', () => {
  // Initialize Visual Gauges, 3D Fan, Spectrogram & Charts
  const gauge = new TachometerGauge('tachometerCanvas');
  const rpmChart = new RpmStripChart('rpmChartCanvas');
  const telemChart = new TelemetryDualChart('telemetryChartCanvas');
  const fan3d = new Fan3DViewer('fan3dWrapper');
  const spectrogram = new MicroDopplerSpectrogram('spectrogramCanvas');
  const audioSynth = new DopplerAudioSynthesizer();

  // DOM Elements
  const connBadge = document.getElementById('connStatusBadge');
  const connText = document.getElementById('connStatusText');
  const sensorBadge = document.getElementById('sensorStatusBadge');
  const sensorText = document.getElementById('sensorStatusText');
  const simBadge = document.getElementById('simBadge');
  const clockDisplay = document.getElementById('clockDisplay');
  const fpsDisplay = document.getElementById('fpsDisplay');

  // View Switcher & 3D Fan Elements
  const panelGaugeSection = document.getElementById('panelGaugeSection');
  const gaugeWrapper = document.getElementById('gaugeWrapper');
  const fan3dWrapper = document.getElementById('fan3dWrapper');
  const tabViewGauge = document.getElementById('tabViewGauge');
  const tabView3D = document.getElementById('tabView3D');
  const tabViewSplit = document.getElementById('tabViewSplit');

  const btn3dIso = document.getElementById('btn3dIso');
  const btn3dTop = document.getElementById('btn3dTop');
  const btn3dRadar = document.getElementById('btn3dRadar');
  const btnToggleBeam = document.getElementById('btnToggleBeam');
  const btnToggleStrobe = document.getElementById('btnToggleStrobe');
  const btnToggleWireframe = document.getElementById('btnToggleWireframe');
  const btnToggleBlades = document.getElementById('btnToggleBlades');
  const btnReset3dCam = document.getElementById('btnReset3dCam');

  // Spectrogram Elements
  const btnSpecWaterfall = document.getElementById('btnSpecWaterfall');
  const btnSpecRangeDoppler = document.getElementById('btnSpecRangeDoppler');
  const btnCyclePalette = document.getElementById('btnCyclePalette');
  const btnFreezeSpec = document.getElementById('btnFreezeSpec');
  const sliderSpecGain = document.getElementById('sliderSpecGain');

  // Audio Synthesizer Elements
  const btnToggleAudio = document.getElementById('btnToggleAudio');
  const audioIcon = document.getElementById('audioIcon');

  const fanStatusBox = document.getElementById('fanStatusBox');
  const fanStatusLabel = document.getElementById('fanStatusLabel');

  const valDistance = document.getElementById('valDistance');
  const barDistance = document.getElementById('barDistance');
  const subDistance = document.getElementById('subDistance');

  const valSnr = document.getElementById('valSnr');
  const barSnr = document.getElementById('barSnr');
  const subSnr = document.getElementById('subSnr');

  const valTipVel = document.getElementById('valTipVel');
  const barTipVel = document.getElementById('barTipVel');
  const subTipVel = document.getElementById('subTipVel');

  const selectPort = document.getElementById('selectPort');
  const selectBaud = document.getElementById('selectBaud');
  const btnRefreshPorts = document.getElementById('btnRefreshPorts');
  const btnConnect = document.getElementById('btnConnect');

  const selectProfile = document.getElementById('selectProfile');
  const btnStartSensor = document.getElementById('btnStartSensor');
  const btnStopSensor = document.getElementById('btnStopSensor');

  const sliderCalScale = document.getElementById('sliderCalScale');
  const displayCalScale = document.getElementById('displayCalScale');
  const btnAutoCal = document.getElementById('btnAutoCal');
  const calPresetBtns = document.querySelectorAll('.cal-preset-btn');

  const sliderRadius = document.getElementById('sliderRadius');
  const displayRadius = document.getElementById('displayRadius');
  const sliderAngle = document.getElementById('sliderAngle');
  const displayAngle = document.getElementById('displayAngle');

  const btnToggleRecord = document.getElementById('btnToggleRecord');
  const btnExportCsv = document.getElementById('btnExportCsv');
  const logSampleCount = document.getElementById('logSampleCount');
  const recordIndicator = document.getElementById('recordIndicator');

  const btnToggleSim = document.getElementById('btnToggleSim');
  const btnToggleConsole = document.getElementById('btnToggleConsole');
  const consoleDrawer = document.getElementById('consoleDrawer');
  const btnCloseConsole = document.getElementById('btnCloseConsole');
  const btnClearLogs = document.getElementById('btnClearLogs');
  const chkAutoScroll = document.getElementById('chkAutoScroll');
  const consoleBody = document.getElementById('consoleBody');

  // State
  let isConnected = false;
  let isSensorActive = false;
  let isSimMode = false;
  let isRecording = false;
  let recordedSessions = [];
  let lastRawRpm = 0.0;
  let lastCalibratedRpm = 0.0;

  let packetCounter = 0;
  let lastFpsTime = Date.now();

  // Clock Ticker
  setInterval(() => {
    const now = new Date();
    clockDisplay.innerText = now.toTimeString().split(' ')[0];
  }, 1000);

  // FPS Ticker
  setInterval(() => {
    const now = Date.now();
    const elapsed = (now - lastFpsTime) / 1000;
    const fps = Math.round(packetCounter / elapsed);
    fpsDisplay.innerText = `${fps} Hz`;
    packetCounter = 0;
    lastFpsTime = now;
  }, 1000);

  // ----------------------------------------------------------------------------
  // Server-Sent Events (SSE) Stream Listener
  // ----------------------------------------------------------------------------
  function connectEventStream() {
    const eventSource = new EventSource('/api/stream');

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleStreamPacket(data);
      } catch (err) {
        console.error('Failed to parse SSE JSON:', err);
      }
    };

    eventSource.onerror = () => {
      connBadge.className = 'status-badge';
      connBadge.querySelector('.badge-dot').className = 'badge-dot dot-offline';
      connText.innerText = 'RECONNECTING...';
    };
  }

  function handleStreamPacket(data) {
    if (data.type === 'telemetry') {
      packetCounter++;

      // 1. Update Gauge, 3D Fan, Spectrogram & Audio Synthesizer
      gauge.setRpm(data.rpm, data.is_running);
      fan3d.setRpm(data.rpm, data.is_running);
      if (data.radius !== undefined) fan3d.setBladeRadius(data.radius);
      if (data.angle !== undefined) fan3d.setAspectAngle(data.angle);
      if (data.dist !== undefined) fan3d.setTargetDistance(data.dist);
      spectrogram.setTelemetry(data);
      audioSynth.setRpm(data.rpm, data.is_running);

      if (data.raw_rpm !== undefined) lastRawRpm = data.raw_rpm;
      lastCalibratedRpm = data.rpm;

      if (data.is_running && data.rpm > 10.0) {
        fanStatusBox.className = 'fan-state-badge status-running';
        fanStatusLabel.innerText = 'FAN RUNNING';
      } else {
        fanStatusBox.className = 'fan-state-badge status-stopped';
        fanStatusLabel.innerText = 'STANDBY / IDLE';
      }

      // 2. Update Metrics Cards
      // Target Distance
      valDistance.innerHTML = `${data.dist.toFixed(2)} <span class="unit">m</span>`;
      const distPct = Math.min(100, Math.max(0, (data.dist / 5.0) * 100));
      barDistance.style.width = `${distPct}%`;
      const rangeBin = Math.round(data.dist / 0.0422);
      subDistance.innerText = `Range Bin: ${rangeBin} (4.2cm res)`;

      // SNR
      valSnr.innerHTML = `${data.snr > 0 ? '+' : ''}${data.snr.toFixed(1)} <span class="unit">dB</span>`;
      const snrPct = Math.min(100, Math.max(0, (Math.max(0, data.snr) / 18.0) * 100));
      barSnr.style.width = `${snrPct}%`;
      let snrQuality = 'Marginal';
      if (data.snr > 7.0) snrQuality = 'Excellent (Strong Lock)';
      else if (data.snr > 4.0) snrQuality = 'Good Signal';
      subSnr.innerText = `Quality: ${snrQuality}`;

      // Blade Tip Velocity
      valTipVel.innerHTML = `${data.tip_vel.toFixed(1)} <span class="unit">m/s</span>`;
      const velPct = Math.min(100, Math.max(0, (data.tip_vel / 25.0) * 100));
      barTipVel.style.width = `${velPct}%`;
      const kmh = (data.tip_vel * 3.6).toFixed(1);
      const mph = (data.tip_vel * 2.237).toFixed(1);
      subTipVel.innerText = `${kmh} km/h (${mph} mph)`;

      // 3. Add to Charts
      rpmChart.addDataPoint(data.rpm, data.ts_ms);
      telemChart.addDataPoint(data.tip_vel, data.snr, data.ts_ms);

      // 4. Data Logger
      if (isRecording) {
        recordedSessions.push({
          timestamp: data.timestamp,
          rpm: data.rpm,
          raw_rpm: data.raw_rpm !== undefined ? data.raw_rpm : data.rpm,
          status: data.status,
          distance_m: data.dist,
          snr_db: data.snr,
          tip_vel_m_s: data.tip_vel,
          radius_m: data.radius,
          angle_deg: data.angle,
          cal_scale: data.cal_scale || 2.10
        });
        logSampleCount.innerText = recordedSessions.length.toString();
      }

      // Raw log entry
      appendConsoleLine(`[${data.timestamp}] RPM: ${data.rpm.toFixed(1)} | ${data.status} | Dist: ${data.dist.toFixed(2)}m | SNR: ${data.snr.toFixed(1)}dB | TipVel: ${data.tip_vel.toFixed(1)}m/s`, 'rpm');
    }
    else if (data.type === 'init' || data.type === 'status') {
      updateSystemStatus(data);
    }
    else if (data.type === 'cfg_progress') {
      const wrap = document.getElementById('cfgProgressWrap');
      const bar = document.getElementById('cfgProgressBar');
      const txt = document.getElementById('cfgProgressText');
      if (wrap && bar && txt) {
        wrap.style.display = 'flex';
        if (data.stage === 'uploading') {
          bar.style.width = `${data.percent}%`;
          bar.style.backgroundColor = data.error ? '#ef4444' : '#10b981';
          txt.innerText = `Uploading configuration: ${data.current}/${data.total} (${data.percent}%)`;
        } else if (data.stage === 'complete') {
          bar.style.width = '100%';
          bar.style.backgroundColor = '#10b981';
          txt.innerText = 'Configuration applied. Radar is chirping!';
          setTimeout(() => { wrap.style.display = 'none'; }, 4000);
        } else if (data.stage === 'error') {
          bar.style.backgroundColor = '#ef4444';
          txt.innerText = `Error: ${data.message}`;
        }
      }
      appendConsoleLine(`[CONFIG] ${data.message || ''}`, data.error ? 'error' : 'info');
    }
    else if (data.type === 'log') {
      appendConsoleLine(`[${data.timestamp || ''}] ${data.message}`, 'info');
    }
  }

  function updateSystemStatus(data) {
    if (data.connected !== undefined) {
      isConnected = data.connected;
      if (isConnected) {
        connBadge.className = 'status-pill';
        const dot = connBadge.querySelector('.status-dot') || connBadge.querySelector('.badge-dot');
        if (dot) dot.className = 'status-dot dot-connected';
        connText.innerText = `CONNECTED (${data.port || 'UART'})`;
        btnConnect.innerText = 'DISCONNECT';
        btnConnect.className = 'dash-btn btn-secondary';
      } else {
        connBadge.className = 'status-pill';
        const dot = connBadge.querySelector('.status-dot') || connBadge.querySelector('.badge-dot');
        if (dot) dot.className = 'status-dot dot-offline';
        connText.innerText = 'DISCONNECTED';
        btnConnect.innerText = 'CONNECT';
        btnConnect.className = 'dash-btn btn-primary';
      }
    }

    if (data.sensor_active !== undefined) {
      isSensorActive = data.sensor_active;
      if (isSensorActive) {
        sensorBadge.className = 'status-pill';
        const dot = sensorBadge.querySelector('.status-dot') || sensorBadge.querySelector('.badge-dot');
        if (dot) dot.className = 'status-dot dot-active';
        sensorText.innerText = 'RADAR ACTIVE';
        if (btnStartSensor) {
          btnStartSensor.disabled = true;
          btnStartSensor.style.opacity = '0.5';
        }
      } else {
        sensorBadge.className = 'status-pill';
        const dot = sensorBadge.querySelector('.status-dot') || sensorBadge.querySelector('.badge-dot');
        if (dot) dot.className = 'status-dot dot-idle';
        sensorText.innerText = 'RADAR IDLE';
        if (btnStartSensor) {
          btnStartSensor.disabled = false;
          btnStartSensor.style.opacity = '1.0';
        }
      }
    }

    if (data.simulation !== undefined) {
      isSimMode = data.simulation;
      simBadge.style.display = isSimMode ? 'flex' : 'none';
      btnToggleSim.className = isSimMode ? 'nav-btn active' : 'nav-btn';
    }

    if (data.radius !== undefined) {
      sliderRadius.value = data.radius;
      displayRadius.innerText = `${data.radius.toFixed(2)} m`;
      fan3d.setBladeRadius(data.radius);
      spectrogram.setTelemetry({ radius: data.radius });
    }

    if (data.angle !== undefined) {
      sliderAngle.value = data.angle;
      displayAngle.innerText = `${Math.round(data.angle)} °`;
      fan3d.setAspectAngle(data.angle);
      spectrogram.setTelemetry({ angle: data.angle });
    }

    if (data.cal_scale !== undefined && sliderCalScale) {
      sliderCalScale.value = data.cal_scale;
      displayCalScale.innerText = `${data.cal_scale.toFixed(2)}x`;
      updatePresetButtons(data.cal_scale);
    }
  }

  // ----------------------------------------------------------------------------
  // Serial Port & Hardware Control Handlers
  // ----------------------------------------------------------------------------
  async function loadPorts() {
    try {
      selectPort.innerHTML = '<option value="">Scanning...</option>';
      const resp = await fetch('/api/ports');
      const data = await resp.json();
      selectPort.innerHTML = '';

      if (!data.ports || data.ports.length === 0) {
        selectPort.innerHTML = '<option value="">No serial ports found (plug in radar)</option>';
        return;
      }

      let selectedAssigned = false;
      data.ports.forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p.port;
        opt.innerText = p.desc;
        if (p.recommended && !selectedAssigned) {
          opt.selected = true;
          selectedAssigned = true;
        }
        selectPort.appendChild(opt);
      });
      if (!selectedAssigned && selectPort.options.length > 0) {
        selectPort.options[0].selected = true;
      }
    } catch (err) {
      selectPort.innerHTML = '<option value="">Error scanning ports</option>';
    }
  }

  async function loadProfiles() {
    try {
      const resp = await fetch('/api/profiles');
      const data = await resp.json();
      if (data.profiles && data.profiles.length > 0) {
        selectProfile.innerHTML = '';
        data.profiles.forEach((p) => {
          const opt = document.createElement('option');
          opt.value = p.name;
          opt.innerText = `${p.name} (${p.desc})`;
          if (p.name.includes('highspeed')) {
            opt.selected = true;
          }
          selectProfile.appendChild(opt);
        });
      }
    } catch (err) {
      console.warn('Using default profiles');
    }
  }

  btnRefreshPorts.addEventListener('click', loadPorts);

  btnConnect.addEventListener('click', async () => {
    if (isConnected) {
      // Disconnect
      try {
        await fetch('/api/disconnect', { method: 'POST' });
        appendConsoleLine('[SYSTEM] Disconnected from serial port.', 'system');
      } catch (err) {
        appendConsoleLine(`[ERROR] Disconnect failed: ${err}`, 'error');
      }
    } else {
      // Connect
      const port = selectPort.value;
      const baud = parseInt(selectBaud.value, 10);
      const profile = selectProfile.value;
      if (!port) {
        alert('Please select a serial port from the dropdown.');
        return;
      }
      try {
        appendConsoleLine(`[SYSTEM] Connecting to ${port} at ${baud} baud...`, 'system');
        const resp = await fetch('/api/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ port, baud, profile })
        });
        const result = await resp.json();
        if (result.success) {
          appendConsoleLine(`[SUCCESS] Connected to ${port}! Click START RADAR to begin streaming.`, 'system');
        } else {
          appendConsoleLine(`[ERROR] Connection failed: ${result.error}`, 'error');
          alert(`Connection failed: ${result.error}`);
        }
      } catch (err) {
        appendConsoleLine(`[ERROR] Connect request failed: ${err}`, 'error');
      }
    }
  });

  btnStartSensor.addEventListener('click', async () => {
    const profile = selectProfile.value;
    appendConsoleLine(`[SYSTEM] Initializing radar sensor with profile: ${profile}...`, 'system');
    const wrap = document.getElementById('cfgProgressWrap');
    const bar = document.getElementById('cfgProgressBar');
    const txt = document.getElementById('cfgProgressText');
    if (wrap && bar && txt) {
      wrap.style.display = 'flex';
      bar.style.width = '10%';
      txt.innerText = `Starting upload of ${profile}...`;
    }
    try {
      const resp = await fetch('/api/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile })
      });
      const result = await resp.json();
      if (!result.success) {
        appendConsoleLine(`[ERROR] Failed to start sensor: ${result.error}`, 'error');
        alert(result.error);
        if (wrap) wrap.style.display = 'none';
      }
    } catch (err) {
      appendConsoleLine(`[ERROR] Start request failed: ${err}`, 'error');
      if (wrap) wrap.style.display = 'none';
    }
  });

  btnStopSensor.addEventListener('click', async () => {
    try {
      appendConsoleLine('[SYSTEM] Stopping radar sensor (sensorStop)...', 'system');
      await fetch('/api/stop', { method: 'POST' });
    } catch (err) {
      appendConsoleLine(`[ERROR] Stop request failed: ${err}`, 'error');
    }
  });

  // ----------------------------------------------------------------------------
  // Live Calibration Sliders & Controls
  // ----------------------------------------------------------------------------
  function updatePresetButtons(val) {
    if (!calPresetBtns) return;
    calPresetBtns.forEach((btn) => {
      const scale = parseFloat(btn.getAttribute('data-scale'));
      if (!isNaN(scale)) {
        if (Math.abs(scale - val) < 0.04) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      }
    });
  }

  let calibDebounce = null;
  function sendCalibration() {
    clearTimeout(calibDebounce);
    calibDebounce = setTimeout(async () => {
      const radius = parseFloat(sliderRadius.value);
      const angle = parseFloat(sliderAngle.value);
      const calScale = sliderCalScale ? parseFloat(sliderCalScale.value) : 2.10;
      try {
        await fetch('/api/calibrate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ radius, angle, cal_scale: calScale })
        });
      } catch (err) {
        console.warn('Failed to sync calibration to server');
      }
    }, 150);
  }

  if (sliderCalScale) {
    sliderCalScale.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      displayCalScale.innerText = `${val.toFixed(2)}x`;
      updatePresetButtons(val);
      sendCalibration();
    });
  }

  if (calPresetBtns) {
    calPresetBtns.forEach((btn) => {
      if (btn.hasAttribute('data-scale')) {
        btn.addEventListener('click', (e) => {
          const scale = parseFloat(btn.getAttribute('data-scale'));
          sliderCalScale.value = scale;
          displayCalScale.innerText = `${scale.toFixed(2)}x`;
          updatePresetButtons(scale);
          sendCalibration();
          appendConsoleLine(`[CALIBRATION] Preset applied: ${scale.toFixed(2)}x scale multiplier`, 'info');
        });
      }
    });
  }

  if (btnAutoCal) {
    btnAutoCal.addEventListener('click', () => {
      const defaultVal = lastCalibratedRpm > 0 ? Math.round(lastCalibratedRpm).toString() : '350';
      const promptVal = prompt(
        'Auto-Calibrate RPM Multiplier:\nEnter your ceiling fan\'s actual known RPM for the current speed setting\n(e.g., 120 for Low speed, or 350 for High speed):',
        defaultVal
      );
      if (!promptVal) return;
      const targetRpm = parseFloat(promptVal);
      if (isNaN(targetRpm) || targetRpm <= 0) {
        alert('Invalid RPM value entered.');
        return;
      }

      // Determine raw unscaled RPM
      const currentScale = (sliderCalScale ? parseFloat(sliderCalScale.value) : 2.10) || 2.10;
      const currentRaw = lastRawRpm > 1.0 ? lastRawRpm : (lastCalibratedRpm / currentScale);

      if (currentRaw <= 5.0) {
        alert('Fan must be actively spinning with radar detecting signal to auto-calibrate. Please start the fan and try again.');
        return;
      }

      const calculatedFactor = Math.min(4.0, Math.max(0.5, targetRpm / currentRaw));
      sliderCalScale.value = calculatedFactor.toFixed(2);
      displayCalScale.innerText = `${calculatedFactor.toFixed(2)}x`;
      updatePresetButtons(calculatedFactor);
      sendCalibration();
      appendConsoleLine(
        `[CALIBRATION] Auto-calibrated! Target: ${targetRpm} RPM, Raw: ${currentRaw.toFixed(1)} RPM -> New Multiplier: ${calculatedFactor.toFixed(2)}x`,
        'system'
      );
    });
  }

  sliderRadius.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    displayRadius.innerText = `${val.toFixed(2)} m`;
    fan3d.setBladeRadius(val);
    spectrogram.setTelemetry({ radius: val });
    sendCalibration();
  });

  sliderAngle.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    displayAngle.innerText = `${Math.round(val)} °`;
    fan3d.setAspectAngle(val);
    spectrogram.setTelemetry({ angle: val });
    sendCalibration();
  });

  // ----------------------------------------------------------------------------
  // Chart Duration Filter Buttons (60s, 30s, 15s)
  // ----------------------------------------------------------------------------
  document.querySelectorAll('.chart-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.chart-btn').forEach((b) => b.classList.remove('active'));
      e.target.classList.add('active');
      const sec = parseInt(e.target.getAttribute('data-range'), 10);
      rpmChart.setRange(sec);
    });
  });

  // ----------------------------------------------------------------------------
  // Data Logger & CSV Export
  // ----------------------------------------------------------------------------
  btnToggleRecord.addEventListener('click', () => {
    isRecording = !isRecording;
    if (isRecording) {
      btnToggleRecord.innerHTML = '<span class="icon">⏸</span> PAUSE RECORD';
      btnToggleRecord.className = 'hud-btn btn-danger';
      recordIndicator.className = 'record-indicator recording';
      recordIndicator.innerText = '● RECORDING';
      appendConsoleLine('[LOGGER] Data logging started.', 'info');
    } else {
      btnToggleRecord.innerHTML = '<span class="icon">⏺</span> RESUME RECORD';
      btnToggleRecord.className = 'hud-btn btn-secondary';
      recordIndicator.className = 'record-indicator';
      recordIndicator.innerText = '● PAUSED';
      appendConsoleLine('[LOGGER] Data logging paused.', 'info');
    }
  });

  btnExportCsv.addEventListener('click', () => {
    if (recordedSessions.length === 0) {
      alert('No recorded data available. Click START RECORD first to log measurements.');
      return;
    }

    const headers = ['Timestamp', 'Calibrated_RPM', 'Raw_RPM', 'Scale_Multiplier', 'Status', 'Distance_m', 'SNR_dB', 'TipVelocity_m_s', 'BladeRadius_m', 'AspectAngle_deg'];
    const rows = recordedSessions.map((s) => [
      s.timestamp,
      s.rpm,
      s.raw_rpm !== undefined ? s.raw_rpm : s.rpm,
      s.cal_scale || 2.10,
      s.status,
      s.distance_m,
      s.snr_db,
      s.tip_vel_m_s,
      s.radius_m,
      s.angle_deg
    ]);

    let csvContent = 'data:text/csv;charset=utf-8,' + headers.join(',') + '\n';
    rows.forEach((row) => {
      csvContent += row.join(',') + '\n';
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    const now = new Date().toISOString().replace(/[-:T]/g, '_').slice(0, 15);
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `awr1843_fan_rpm_log_${now}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    appendConsoleLine(`[LOGGER] Exported ${recordedSessions.length} samples to CSV file.`, 'system');
  });

  // ----------------------------------------------------------------------------
  // Demo Mode (Simulation) Toggle
  // ----------------------------------------------------------------------------
  btnToggleSim.addEventListener('click', async () => {
    try {
      const resp = await fetch('/api/sim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enable: !isSimMode })
      });
      const result = await resp.json();
      isSimMode = result.simulation;
      simBadge.style.display = isSimMode ? 'flex' : 'none';
      btnToggleSim.className = isSimMode ? 'hud-btn btn-secondary' : 'hud-btn btn-outline';
      appendConsoleLine(`[SIM] Simulation Mode ${isSimMode ? 'ACTIVATED (Simulating Fan)' : 'DEACTIVATED'}`, 'system');
    } catch (err) {
      console.error('Failed to toggle simulation mode:', err);
    }
  });

  // ----------------------------------------------------------------------------
  // Console Drawer Handlers
  // ----------------------------------------------------------------------------
  btnToggleConsole.addEventListener('click', () => {
    consoleDrawer.classList.toggle('collapsed');
  });

  btnCloseConsole.addEventListener('click', () => {
    consoleDrawer.classList.add('collapsed');
  });

  btnClearLogs.addEventListener('click', () => {
    consoleBody.innerHTML = '<div class="console-line system">[SYSTEM] Console cleared.</div>';
  });

  function appendConsoleLine(text, cssClass = '') {
    const line = document.createElement('div');
    line.className = `console-line ${cssClass}`;
    line.innerText = text;
    consoleBody.appendChild(line);

    // Maintain max 300 DOM lines
    while (consoleBody.children.length > 300) {
      consoleBody.removeChild(consoleBody.firstChild);
    }

    if (chkAutoScroll.checked) {
      consoleBody.scrollTop = consoleBody.scrollHeight;
    }
  }

  // ----------------------------------------------------------------------------
  // View Switcher (GAUGE / 3D RADAR / SPLIT)
  // ----------------------------------------------------------------------------
  function setViewMode(mode) {
    tabViewGauge.classList.toggle('active', mode === 'gauge');
    tabView3D.classList.toggle('active', mode === '3d');
    tabViewSplit.classList.toggle('active', mode === 'split');

    if (mode === 'gauge') {
      gaugeWrapper.style.display = 'flex';
      fan3dWrapper.style.display = 'none';
      panelGaugeSection.classList.remove('view-mode-split');
    } else if (mode === '3d') {
      gaugeWrapper.style.display = 'none';
      fan3dWrapper.style.display = 'flex';
      panelGaugeSection.classList.remove('view-mode-split');
      fan3d.resize();
    } else if (mode === 'split') {
      gaugeWrapper.style.display = 'flex';
      fan3dWrapper.style.display = 'flex';
      panelGaugeSection.classList.add('view-mode-split');
      fan3d.resize();
    }
  }

  tabViewGauge.addEventListener('click', () => setViewMode('gauge'));
  tabView3D.addEventListener('click', () => setViewMode('3d'));
  tabViewSplit.addEventListener('click', () => setViewMode('split'));

  // ----------------------------------------------------------------------------
  // 3D Ceiling Fan Controls
  // ----------------------------------------------------------------------------
  document.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('[data-preset]').forEach((b) => b.classList.remove('active'));
      e.target.classList.add('active');
      const preset = e.target.getAttribute('data-preset');
      fan3d.setPresetView(preset);
    });
  });

  btnToggleBeam.addEventListener('click', () => {
    const isVisible = fan3d.toggleBeam();
    btnToggleBeam.classList.toggle('active', isVisible);
  });

  btnToggleStrobe.addEventListener('click', () => {
    const isStrobe = fan3d.toggleStrobe();
    btnToggleStrobe.classList.toggle('active', isStrobe);
  });

  btnToggleWireframe.addEventListener('click', () => {
    const isWire = fan3d.toggleWireframe();
    btnToggleWireframe.classList.toggle('active', isWire);
  });

  let currentBladeCount = 3;
  btnToggleBlades.addEventListener('click', () => {
    currentBladeCount = currentBladeCount === 3 ? 4 : (currentBladeCount === 4 ? 5 : 3);
    fan3d.setBladeCount(currentBladeCount);
    spectrogram.bladeCount = currentBladeCount;
    audioSynth.bladeCount = currentBladeCount;
    btnToggleBlades.innerText = `${currentBladeCount} BLADES`;
  });

  btnReset3dCam.addEventListener('click', () => {
    fan3d.resetCamera();
  });

  // ----------------------------------------------------------------------------
  // Micro-Doppler Spectrogram Controls
  // ----------------------------------------------------------------------------
  btnSpecWaterfall.addEventListener('click', () => {
    btnSpecWaterfall.classList.add('active');
    btnSpecRangeDoppler.classList.remove('active');
    spectrogram.setViewMode('waterfall');
  });

  btnSpecRangeDoppler.addEventListener('click', () => {
    btnSpecRangeDoppler.classList.add('active');
    btnSpecWaterfall.classList.remove('active');
    spectrogram.setViewMode('range_doppler');
  });

  btnCyclePalette.addEventListener('click', () => {
    const pal = spectrogram.cyclePalette();
    const names = { cyberpunk: 'NEON', jet: 'JET', green: 'GREEN' };
    btnCyclePalette.innerText = `🎨 ${names[pal] || pal.toUpperCase()}`;
  });

  btnFreezeSpec.addEventListener('click', () => {
    const isFrozen = spectrogram.togglePause();
    btnFreezeSpec.classList.toggle('active', isFrozen);
    btnFreezeSpec.innerText = isFrozen ? '▶ RESUME' : '❄️ FREEZE';
  });

  sliderSpecGain.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    spectrogram.setGain(val);
  });

  // ----------------------------------------------------------------------------
  // Audio Synthesizer Toggle
  // ----------------------------------------------------------------------------
  btnToggleAudio.addEventListener('click', () => {
    const enabled = audioSynth.toggle();
    btnToggleAudio.classList.toggle('audio-active', enabled);
    btnToggleAudio.classList.toggle('btn-outline', !enabled);
    btnToggleAudio.classList.toggle('btn-action', enabled);
    audioIcon.innerText = enabled ? '🔊' : '🔇';
    appendConsoleLine(`[AUDIO] Doppler Synthesizer ${enabled ? 'ACTIVATED' : 'MUTED'}`, 'info');
  });

  // Initial Boot
  loadPorts();
  loadProfiles();
  connectEventStream();
  consoleDrawer.classList.add('collapsed'); // Default to collapsed for clean view
});
