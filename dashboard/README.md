# 🛰️ AWR1843BOOST Radar Tachometer - Web Avionics HUD

An aerospace-grade, real-time web dashboard and control center for the **TI AWR1843BOOST mmWave FMCW Doppler Radar Ceiling Fan Tachometer**.

Designed with a high-contrast cyberpunk dark HUD aesthetic, smooth hardware-accelerated 60 FPS Canvas animations, live scrolling strip charts, automatic serial port detection, chirp configuration uploading, and one-click CSV session recording.

---

## 📸 Dashboard Preview

```text
+---------------------------------------------------------------------------------------------------+
|  [●] AWR1843BOOST RADAR TACHOMETER           [CONNECTED: /dev/ttyACM0] [RADAR ACTIVE]  10 Hz  |
+--------------------------------------------------+------------------------------------------------+
|                                                  |   RPM TIME SERIES (LAST 60s)                   |
|                   284.5                          |   350 |          /\        /\                      |
|                    RPM                           |   250 |  ~~\    /  \  /\  /  \                     |
|           [● FAN RUNNING (ACTIVE)]               |   150 |_____\__/____\/__\/____\_____ NOW           |
|                                                  +------------------------------------------------+
|  +-------------+  +-------------+  +----------+  |   TIP VELOCITY (m/s) & SNR (dB) HISTORY        |
|  |  DISTANCE   |  |     SNR     |  | TIP VEL  |  |   20 | ~~~~/\~~~~~/\~~~~ (Tip Vel: 17.8 m/s)   |
|  |   1.85 m    |  |   +8.1 dB   |  | 17.8 m/s |  |   10 | ----------------- (SNR: 8.1 dB)         |
|  +-------------+  +-------------+  +----------+  +------------------------------------------------+
|                                                  |   RADAR CONNECTION      SENSOR CONTROLS        |
|  [CALIBRATION]                                   |   Port: /dev/ttyACM0    Profile: 1-TX High-Speed |
|  Blade Radius (R): [===●====] 0.60 m             |   [ CONNECT ]           [ ▶ START ]  [ ⏹ STOP ]  |
|  Aspect Angle (θ): [===●====] 30 °               |   DATA LOGGER: 1,420 samples  [ EXPORT CSV ]   |
+--------------------------------------------------+------------------------------------------------+
```

---

## ⚡ Key Features

1. **Precision Radial Tachometer Gauge (60 FPS Canvas)**:
   - Smooth inertial spring damping needle movement.
   - Dynamic multi-color speed zones: Cyan ($0 - 150\text{ RPM}$), Emerald ($150 - 300\text{ RPM}$), and Amber/Coral ($300 - 500\text{ RPM}$).
   - Large digital RPM readout with pulsating active glow.

2. **Real-Time Telemetry Cards**:
   - **Target Distance**: Reports localized fan distance in meters with range bin index ($4.2\text{ cm}$ resolution).
   - **Signal-to-Noise Ratio (SNR)**: Real-time blade reflection strength in $\text{dB}$ with signal quality grading (*Excellent*, *Good*, *Marginal*).
   - **Blade Tip Velocity**: Instantaneous linear tip velocity along radar line of sight ($m/s$, $km/h$, $mph$).

3. **Live Scrolling Strip-Charts**:
   - Time-series waveform over selectable time windows ($15s$, $30s$, $60s$).
   - Real-time Min, Average, and Max RPM telemetry statistics.
   - Dual-trace micro-Doppler history chart tracking Tip Velocity and SNR.

4. **Hardware Radar Control & Auto-Detection**:
   - Auto-scans Linux USB `/dev/ttyACM*` and `/dev/ttyUSB*` ports and Windows `COM*` ports.
   - One-click profile uploader: uploads `.cfg` commands with the required $40\text{ ms}$ CLI pacing and initiates radar transmission.
   - Instant sensor stop (`sensorStop`) button.

5. **On-The-Fly Dynamic Calibration**:
   - Adjust **Blade Radius** ($0.10\text{ m}$ to $1.20\text{ m}$) and **Radar Aspect Angle** ($0^\circ$ to $60^\circ$) in real-time.
   - Telemetry recalculates immediately on client and server without recompiling or flashing firmware!

6. **Data Logger & CSV Export**:
   - Real-time session data recorder.
   - One-click export to standard CSV (`awr1843_fan_rpm_log_YYYYMMDD_HHMMSS.csv`) for laboratory analysis in MATLAB, Python, or Excel.

7. **Built-in Demo Simulation Mode**:
   - Test and demonstrate the complete UI immediately without physical radar hardware.
   - Simulates rotational aerodynamics, blade acceleration/deceleration, micro-Doppler turbulence, and range noise.

8. **Collapsible Raw Serial Debug Console**:
   - Inspect raw radar UART lines directly inside the web interface with color-coded syntax and auto-scrolling.

---

## 🚀 How to Launch

### Quick Launch (Linux / macOS):
```bash
./start_dashboard.sh
```

### Direct Python Launch:
```bash
python3 dashboard/app.py
```

### Launch in Demo Simulation Mode (No Radar Required):
```bash
python3 dashboard/app.py --sim
```

### Custom Port:
```bash
python3 dashboard/app.py --port 8080 --no-browser
```

Open your browser at **`http://localhost:8055`**.

---

## 🛠 Tech Stack

- **Backend**: Zero-dependency Python 3 standard library (`http.server`, `threading`, `queue`, `urllib.parse`) + Server-Sent Events (SSE). Uses `pyserial` for radar communication.
- **Frontend**: Modern vanilla HTML5 / CSS3 / JavaScript (ES6+).
- **Graphics**: Hardware-accelerated HTML5 Canvas with custom conic gradient gauges and 60 FPS scrolling strip charts. Zero heavy charting dependencies.
