# Live Fan RPM Measurement System using AWR1843BOOST

This project implements real-time, high-accuracy rotational speed (RPM) estimation of a spinning fan using the Texas Instruments **AWR1843BOOST** 76–81 GHz FMCW radar sensor. The estimated live RPM is computed on the ARM Cortex-R4F Master Subsystem (MSS) and streamed live over the UART interface.

---

## 1. Executive Summary & Physics Fundamentals

### 1.1 The Kinematics of Rotating Blades
When a fan rotates at an angular frequency $\omega = 2\pi f_{\text{rot}}$ (where $f_{\text{rot}} = \frac{\text{RPM}}{60}$ in revolutions per second):
- The physical linear velocity $v(r)$ at any radial position $r \in [0, R_{\text{blade}}]$ along the blade is:
  $$v(r) = \omega \cdot r = 2\pi \left(\frac{\text{RPM}}{60}\right) r$$
- The **blade tip** ($r = R_{\text{blade}}$) attains the maximum linear velocity:
  $$v_{\text{tip}} = 2\pi \left(\frac{\text{RPM}}{60}\right) R_{\text{blade}}$$
- When illuminated by the radar at an aspect angle $\theta$ (the angle between the radar line-of-sight and the plane of rotation), the radial velocity component projected toward or away from the radar is:
  $$v_{\text{radial}}(r, t) = \omega \cdot r \cos(\theta) \sin(\omega t + \phi_0)$$

$$\boxed{\text{RPM} = \frac{60 \cdot v_{\text{tip}}}{2\pi R_{\text{blade}} \cos(\theta)}}$$

### 1.2 Doppler Shift vs. Micro-Doppler Cadence
There are two distinct electromagnetic phenomena produced by a rotating fan:

```
+-------------------------------------------------------------------------------+
| Radar Return Phenomena from a Rotating Fan                                    |
+------------------------------------+------------------------------------------+
| 1. High-Frequency Doppler Shift    | 2. Low-Frequency Micro-Doppler Cadence   |
|    (Intra-Chirp / Coherent Phase)  |    (Inter-Chirp / Flash Periodicity)     |
+------------------------------------+------------------------------------------+
| • Carrier: 77 GHz                  | • Modulation Envelope Period: T_flash    |
| • Wavelength λ ≈ 3.9 mm            | • Repetition rate: Blade Passing Freq.   |
| • Doppler shift:                   | • BPF = N_blades × (RPM / 60)            |
|     f_d = (2 · v) / λ              | • Typical range: 10 Hz to 200 Hz         |
| • Typical range: 1 kHz to 15 kHz   | • Independent of blade length R          |
| • Governs Range-Doppler Matrix     | • Requires high frame rate (> 300 Hz)    |
+------------------------------------+------------------------------------------+
```

### 1.3 Why Simple Peak Detection Fails (Common Pitfalls)
1. **Missing Blade Radius**: The Doppler frequency depends strictly on linear speed ($v$ in m/s). You cannot calculate rotational frequency (RPM) from velocity without knowing the blade radius $R$.
2. **Doppler Spectrum Spread**: A fan blade is not a single point reflector; it is a distributed line scatterer. Reflections span from $0\text{ m/s}$ (the hub) up to $v_{\text{tip}}$ (the tip). The single highest magnitude peak usually originates from the thick blade root or hub ($r \ll R_{\text{blade}}$), **not** the tip. Selecting the maximum magnitude bin severely underestimates the true RPM.
3. **Doppler Bin Discretization**: With standard radar configurations (e.g. 32 Doppler bins, $\Delta v = 0.66\text{ m/s}$), integer bin quantization creates discrete jumps of $\pm 60\text{ to }100\text{ RPM}$.
4. **Static Clutter Confusion**: Doppler bin 0 contains high-amplitude static reflections (fan frame, stand, walls). If bin 0 is not properly excluded, the tracker locks onto stationary clutter.

---

## 2. High-Accuracy Measurement Engine Architecture

The implementation in `rpm_measurement.c` executes the following multi-stage processing pipeline on every received frame:

```
2D Detection Matrix (L3 RAM)
             │
             ▼
   [ Stage 1: Automatic Fan Range Localization ]
   Accumulates non-zero Doppler energy across range bins;
   Identifies the exact range bin r_fan containing the spinning fan.
             │
             ▼
   [ Stage 2: Adaptive CFAR Noise Floor Estimation ]
   Calculates local noise floor on r_fan; sets dynamic detection threshold.
             │
             ▼
   [ Stage 3: Symmetric Doppler Envelope Extraction ]
   Detects the outer spectral boundaries for approaching (+v_tip)
   and receding (-v_tip) blades; cancels net bulk/sensor vibration.
             │
             ▼
   [ Stage 4: Sub-Bin Parabolic Interpolation ]
   Refines integer Doppler bins to continuous fractional bins (10x accuracy).
             │
             ▼
   [ Stage 5: Physical RPM Conversion ]
   Transforms v_tip into RPM using R_blade and aspect angle θ.
             │
             ▼
   [ Stage 6: Temporal Exponential Moving Average (EMA) Filter ]
   Stabilizes frame-to-frame turbulence while tracking speed dynamics.
             │
             ▼
   UART Output: Clean live RPM string (e.g., "RPM: 1248.5\r\n")
```

### Key Algorithmic Components

#### A. Automatic Range Bin Localization
Static clutter only populates Doppler bin 0 ($0\text{ m/s}$). In contrast, rotating blades scatter energy across multiple Doppler bins. The engine computes:
$$E_{\text{moving}}(r) = \sum_{d = 1, d \neq N_D/2}^{N_D - 1} \text{detMatrix}[r \cdot N_D + d]$$
The range bin $r_{\text{fan}} = \arg\max_r E_{\text{moving}}(r)$ locks onto the fan regardless of the radar-to-fan distance.

#### B. Symmetric Doppler Envelope Extraction
Because blades rotate around a center axis:
- One side of the fan approaches the radar ($+v$).
- The opposite side recedes from the radar ($-v$).

The algorithm identifies both the positive spectral edge $d_{\text{edge,pos}}$ and the negative spectral edge $d_{\text{edge,neg}}$. Averaging their absolute values cancels out DC offsets and sensor vibrations:
$$d_{\text{tip}} = \frac{d_{\text{edge,pos}} + |d_{\text{edge,neg}}|}{2}$$

#### C. Sub-Bin Parabolic Interpolation
To transcend integer bin quantization, 3-point parabolic interpolation is applied to the peak/edge bins:
$$\delta = \frac{y[d+1] - y[d-1]}{2 \cdot (2y[d] - y[d-1] - y[d+1])}, \quad \delta \in [-0.5, +0.5]$$
$$d_{\text{continuous}} = d + \delta$$
$$v_{\text{tip}} = d_{\text{continuous}} \times \Delta v_{\text{resolution}}$$

#### D. Temporal Exponential Moving Average (EMA)
To eliminate visual flicker and turbulence fluctuations while maintaining fast response:
$$\text{RPM}_{\text{filtered}}[k] = \alpha \cdot \text{RPM}_{\text{raw}}[k] + (1 - \alpha) \cdot \text{RPM}_{\text{filtered}}[k-1]$$
where $\alpha = 0.20$ provides smooth, responsive readings.

---

## 3. Hardware Setup & SOP Boot Modes

### 3.1 AWR1843BOOST Switch / Jumper Configuration
The AWR1843BOOST EVM uses 3 Sense-On-Power (SOP) jumper pins to set the boot mode:

| Pin / Jumper | SOP2 (Debug / CCS Mode) | SOP5 (Flashing Mode) | SOP4 (Functional Boot) |
| :--- | :---: | :---: | :---: |
| **SOP 2** | **ON (Jumper Closed)** | OFF (Jumper Open) | OFF (Jumper Open) |
| **SOP 1** | OFF (Jumper Open) | OFF (Jumper Open) | OFF (Jumper Open) |
| **SOP 0** | **ON (Jumper Closed)** | **ON (Jumper Closed)** | OFF (Jumper Open) |
| **State Binary** | `1 0 1` | `0 0 1` | `0 0 0` |
| **Purpose** | **Development & Debug via CCS JTAG** | Flashing combined image via UniFlash | Autonomous boot from serial flash |

> [!IMPORTANT]
> - For **CCS Debugging** (loading `.xer4f` and `.xe674`), place jumpers on **SOP2** and **SOP0** (leave SOP1 open).
> - **Power Supply**: Connect a dedicated **5V / 2.5A** (center-positive, 2.1mm) DC barrel jack adapter. Do **not** power the radar solely from USB; chirping requires instantaneous peak currents up to 2.0A that can cause brownouts.
> - Connect the micro-USB cable from your PC to the EVM (connects to the onboard XDS110 debug probe).

### 3.2 Radar Placement & Physical Alignment
```
                     Plane of Rotation
                            │
        ┌─────────────┐     │       ▲ +v (Approaching blade)
        │             │     │      ╱
        │ AWR1843     │─────┼──── ◯  Hub
        │ Sensor EVM  │ LOS │      ╲
        │             │     │       ▼ -v (Receding blade)
        └─────────────┘     │
             ├─── Distance ─┤
               (0.3m - 2m)
```
- **Alignment**: Point the radar antenna array directly broadside at the rotating fan face.
- **Distance**: Maintain a standoff distance of **$0.3\text{ m}$ to $2.0\text{ m}$** from the fan blades.
- **Aspect Angle ($\theta$)**:
  - A frontal or slight oblique view ($\theta \approx 0^\circ - 30^\circ$) yields strong specular reflections from the blade leading/trailing edges.
  - If the radar is positioned at an angle, update `RPM_DEFAULT_ASPECT_ANGLE_DEG` in `rpm_measurement.h`.

---

## 4. Understanding COM Ports: Application vs. Data Port

When you plug the AWR1843BOOST micro-USB into your computer, the onboard TI XDS110 probe enumerates as **TWO virtual COM ports**:

```
+-----------------------------------------------------------------------------------------+
|                              TI XDS110 Dual Serial Interface                             |
+------------------------------------+----------------------------------------------------+
| 1. Application / User UART Port    | 2. Auxiliary Data Port                             |
|    (Enhanced COM Port)             |    (Standard COM Port)                             |
+------------------------------------+----------------------------------------------------+
| • Windows: "Application/User UART" | • Windows: "Auxiliary Data Port"                   |
|   (typically LOWER COM number)     |   (typically HIGHER COM number)                    |
| • Linux: /dev/ttyACM0              | • Linux: /dev/ttyACM1                              |
| • Baud Rate: 115200 (8-N-1)        | • Baud Rate: 921600 (8-N-1)                        |
|                                    |                                                    |
| PURPOSE:                           | PURPOSE:                                           |
| -> Send .cfg commands to radar     | -> High-speed binary TLVs (3D point clouds)        |
| -> RECEIVE LIVE FAN RPM!           |                                                    |
|                                    | REQUIRED FOR RPM SYSTEM?                           |
| REQUIRED FOR RPM SYSTEM?           | -> NO! Not needed for fan RPM measurement.         |
| -> YES! This is the ONLY port you  |    (Can remain completely closed).                 |
|    need to monitor for RPM.        |                                                    |
+------------------------------------+----------------------------------------------------+
```

> [!NOTE]
> In the standard mmWave Out-of-Box demo, binary detection TLVs go to the Data Port (921600 baud).  
> **However, for this RPM project, our firmware outputs clean, formatted ASCII text (`RPM: 1250.4\r\n`) directly over the Application / User UART Port (115200 baud)** using `CLI_write()`.  
> Therefore, you **only** need to interact with the **Application / User UART Port**!

---

## 5. Step-by-Step Build Guide

### 5.1 Prerequisites & Toolchain Versions
- **TI mmWave SDK**: `v03.06.02.00-LTS`
- **Code Composer Studio**: CCS 12.x or CCS Theia (or command line)
- **ARM Compiler (MSS)**: `TI ARM CGT 16.9.6.LTS`
- **DSP Compiler (DSS)**: `TI C6000 CGT 8.3.3`
- **SYS/BIOS**: `6.73.01.01`
- **XDCtools**: `3.50.08.24`

### 5.2 Build Order
Always build the **DSS (DSP)** project first, followed by the **MSS (ARM)** project:
1. `out_of_box_1843_dss`
2. `out_of_box_1843_mss`

### 5.3 Building via Code Composer Studio (GUI)
1. Open Code Composer Studio / CCS Theia.
2. In the Project Explorer, right-click on `out_of_box_1843_dss` and select **Build Project**.
   - Verify that `out_of_box_1843_dss/isk/out_of_box_1843_dss_isk.xe674` is generated with 0 errors.
3. In the Project Explorer, right-click on `out_of_box_1843_mss` and select **Build Project**.
   - Verify that `out_of_box_1843_mss/isk/out_of_box_1843_mss_isk.xer4f` is generated with 0 errors.

### 5.4 Building via Command Line (Makefiles)
You can also compile directly in a bash terminal:

```bash
# 1. Build DSS (C674x DSP)
cd /home/vish/workspace_ccstheia/out_of_box_1843_dss/isk
make clean
make all

# 2. Build MSS (Cortex-R4F ARM)
cd /home/vish/workspace_ccstheia/out_of_box_1843_mss/isk
make clean
make all
```

Output binary artifacts:
- DSP executable: `out_of_box_1843_dss/isk/out_of_box_1843_dss_isk.xe674`
- MSS executable: `out_of_box_1843_mss/isk/out_of_box_1843_mss_isk.xer4f`

---

## 6. Step-by-Step Debug & Run Guide (CCS JTAG)

### Step 1: Set Jumpers to SOP2 (Debug Mode)
1. Place jumpers on **SOP2** and **SOP0**. Ensure **SOP1** has no jumper (`1 0 1`).
2. Power on the AWR1843BOOST with the 5V power supply.
3. Press the **NRST** (Reset) tactile button once to latch the boot pins.

### Step 2: Launch Target Configuration in CCS
1. In CCS, open the **Target Configurations** window (`View` -> `Target Configurations`).
2. Expand `Projects` -> `out_of_box_1843_mss` -> `targetConfigs`.
3. Right-click on `AWR1843.ccxml` and select **Launch Selected Configuration**.
4. The CCS Debug view will open showing the debug probe cores.

### Step 3: Connect Cores
1. In the Debug tree, right-click on **Texas Instruments XDS110 USB Debug Probe / Cortex_R4_0** and select **Connect Target**.
2. Right-click on **Texas Instruments XDS110 USB Debug Probe / C674X_0** and select **Connect Target**.

### Step 4: Load Programs
1. Select **C674X_0** in the Debug window:
   - Click `Run` -> `Load` -> `Load Program...`
   - Click `Browse project...` and select:
     `out_of_box_1843_dss/isk/out_of_box_1843_dss_isk.xe674`
   - Click `OK` to load.
2. Select **Cortex_R4_0** in the Debug window:
   - Click `Run` -> `Load` -> `Load Program...`
   - Click `Browse project...` and select:
     `out_of_box_1843_mss/isk/out_of_box_1843_mss_isk.xer4f`
   - Click `OK` to load.

### Step 5: Run the Cores
1. Select **C674X_0** and click the green **Resume** button (or press `F8`).
2. Select **Cortex_R4_0** and click the green **Resume** button (or press `F8`).
3. In the CCS **Console** (CIO output), you should see:
   ```text
   [Cortex_R4_0] Debug: Launching the Millimeter Wave Demo
   [Cortex_R4_0] Debug: MMWave MSS Initialization was successful
   [Cortex_R4_0] Debug: CLI is operational
   ```
4. The radar is now waiting for configuration commands on the Application UART port.

---

## 7. Flashing Firmware to QSPI Flash Memory via TI UniFlash

While JTAG debugging (Section 6) loads the binaries temporarily into internal RAM for development and code iteration, **TI UniFlash allows you to permanently flash the firmware onto the onboard QSPI serial flash memory**. Once flashed, the radar can operate autonomously in standalone mode on power-up without Code Composer Studio or a JTAG debugger!

### 7.1 Understanding the Flashing Process vs. JTAG
| Feature | JTAG Debug Mode (SOP2: `1 0 1`) | UniFlash Flashing Mode (SOP5: `0 0 1`) | Functional Mode (SOP4: `0 0 0`) |
| :--- | :--- | :--- | :--- |
| **Target Storage** | Internal RAM (Volatile) | Onboard QSPI Flash (Non-Volatile) | Boots from QSPI Flash |
| **Files Used** | `.xer4f` (MSS) + `.xe674` (DSS) | Combined multicore image (`.bin`) | Runs flashed `.bin` |
| **Tool Required** | Code Composer Studio (CCS) | TI UniFlash (Desktop or Cloud) | Standalone (No tool needed) |
| **Best For** | Active code development & debugging | Flashing firmware to permanent memory | Autonomous deployment in the field |

---

### 7.2 Step-by-Step Flashing Procedure

#### Step 1: Set Jumpers to SOP5 (Flashing Mode)
1. Disconnect the power supply.
2. Set the three SOP jumpers on the AWR1843BOOST:
   - **SOP 2**: **OFF (Open / Removed)**
   - **SOP 1**: **OFF (Open / Removed)**
   - **SOP 0**: **ON (Closed / Jumper Installed)**
   - Binary setting: `[0 0 1]`
3. Connect the dedicated **5V / 2.5A** DC power supply to the barrel jack.
4. Connect the micro-USB cable to your PC.
5. Press the **NRST** (Reset) tactile button once to latch the bootloader into flashing mode.

#### Step 2: Open TI UniFlash & Select Device
1. Open the **TI UniFlash** tool (either the offline desktop application or [UniFlash Cloud](https://dev.ti.com/uniflash)).
2. In the **New Configuration** search bar, type:
   `AWR1843` or `AWR1843BOOST`
3. Click on the detected device and click **Start**.

#### Step 3: Set the Communication Port
1. Click on the **Settings & Utilities** tab on the left sidebar.
2. Under the **Setup** section, locate the **COM Port** field.
3. Enter your **Application / User UART Port** (Enhanced COM Port):
   - On **Linux**: `/dev/ttyACM0`
   - On **Windows**: Enter the lower COM port number (e.g., `COM3` or `COM19` from Device Manager).
   > [!CAUTION]
   > Do **NOT** select the Auxiliary Data Port (`/dev/ttyACM1` or higher COM number). The bootloader exclusively communicates on the Application/User UART port!
   > Ensure no other program (terminal, Python monitor, CCS console) is holding this port open.

#### Step 4: Select the Binary & Flash
1. Click on the **Program** tab on the left sidebar.
2. In the **Meta Image 1** row:
   - Click **Browse** and select your multicore binary file (`.bin`).
   - *(Leave Meta Image 2, 3, and 4 completely blank).*
3. Press the **NRST** button on the radar EVM once.
4. Click the blue **Load Image** button.
5. The progress bar will advance through erasing, programming, and verifying flash sectors.
6. When complete, the console at the bottom will display:
   ```text
   [SUCCESS] Program Load completed successfully
   ```

---

### 7.3 Booting & Running After Flashing (Functional Mode)

To run the flashed firmware autonomously:
1. Disconnect the 5V power supply.
2. Remove the jumper from **SOP0** so that **all three jumpers are OFF**:
   - **SOP 2**: **OFF (Open)**
   - **SOP 1**: **OFF (Open)**
   - **SOP 0**: **OFF (Open)**
   - Binary setting: `[0 0 0]` (SOP4 Functional Mode)
3. Reconnect the 5V / 2.5A power supply.
4. Press the **NRST** button once.
5. The radar now automatically boots from QSPI flash into your fan RPM firmware!
6. Open your terminal and run the configuration script:
   ```bash
   ./send_cfg_and_stream.sh /dev/ttyACM0
   ```
   The radar starts transmitting chirps and outputs the live RPM directly.

---

### 7.4 UniFlash Troubleshooting FAQ

| Error Message | Probable Root Cause | Exact Solution |
| :--- | :--- | :--- |
| **`[ERROR] Cortex_R4_0: Initial response from the device was not received`** | 1. Incorrect SOP jumper position.<br>2. Forgot to press NRST.<br>3. Selected the Auxiliary Data Port instead of Application Port. | 1. Verify SOP jumpers are `[0 0 1]` (SOP2 OFF, SOP1 OFF, SOP0 ON).<br>2. Press NRST button.<br>3. Ensure COM port is `/dev/ttyACM0` or the User UART port. |
| **`Permission denied: '/dev/ttyACM0'`** | User does not have serial port access rights on Linux. | Run `sudo usermod -a -G uucp $USER` on Arch Linux (or `dialout` on Ubuntu) and then run `newgrp uucp`. |
| **`[ERROR] Failed to open COM port`** | Port is currently held open by another application. | Close any running serial terminals (Minicom, screen, PuTTY, `send_cfg_and_stream.sh`, Python scripts). |
| **Radar does not boot after flashing** | Board left in SOP5 Flashing mode. | Remove all SOP jumpers (`0 0 0` Functional mode) and press NRST. |

---

## 8. Arch Linux Console & CLI Guide: Sending `.cfg` & Reading Live RPM

> [!TIP]
> **No web browsers or GUI tools (such as TI mmWave Demo Visualizer) are required!**  
> All configuration and live telemetry can be performed natively inside your standard Arch Linux terminal / console.

### 8.1 Arch Linux Device Node & User Permissions

When the AWR1843BOOST is plugged into USB, the Linux kernel assigns two ACM nodes:
- `/dev/ttyACM0`: **Application / User UART Port** (Enhanced port @ 115200 baud). **Use this!**
- `/dev/ttyACM1`: **Auxiliary Data Port** (Standard port @ 921600 baud). *Not needed.*

#### 1. Verify Device Nodes:
```bash
ls -l /dev/serial/by-id/
# Or:
dmesg | grep -i "ttyACM"
```
You will see entries for `Texas_Instruments_XDS110_Embed_with_CMSIS-DAP`. The first interface (`if00`) corresponds to `/dev/ttyACM0`.

#### 2. Configure Arch Linux Permissions:
On Arch Linux, serial devices belong to the `uucp` group (`crw-rw---- 1 root uucp`). Ensure your user belongs to this group:
```bash
# Add current user to 'uucp' group:
sudo usermod -a -G uucp $USER

# Apply the new group to your current shell session immediately:
newgrp uucp
```

---

### 7.2 Method 1: Pure Bash Script (`send_cfg_and_stream.sh`) — Recommended!

A zero-dependency, pure Bash script [`send_cfg_and_stream.sh`](send_cfg_and_stream.sh) is provided directly in this directory. It uses only standard Linux utilities (`stty`, bash file descriptors, `sed`, `date`).

#### Run the Script:
```bash
cd /home/vish/workspace_ccstheia/out_of_box_1843_mss

# Run with default port /dev/ttyACM0:
./send_cfg_and_stream.sh

# Or specify a custom port or config:
./send_cfg_and_stream.sh /dev/ttyACM0 profile_fan_rpm.cfg
```

#### What the Script Does:
1. Opens `/dev/ttyACM0` using a persistent file descriptor (`exec 3<> /dev/ttyACM0`) so the board does not reset.
2. Sets the port to `115200` baud, raw mode, 8-N-1 via `stty`.
3. Sends each line of `profile_fan_rpm.cfg` with a 40ms pacing interval required by the mmWave CLI engine.
4. Switches directly to real-time live RPM streaming with colorized output:
   ```text
   ==========================================================
       Arch Linux AWR1843BOOST Fan RPM Console Monitor
   ==========================================================
    Port:        /dev/ttyACM0
    Baud Rate:   115200
    Config File: profile_fan_rpm.cfg
   ==========================================================
   [1/2] Sending configuration to radar via /dev/ttyACM0...
     --> sensorStop
     --> flushCfg
     --> dfeDataOutputMode 1
     ...
     --> sensorStart
   [2/2] Configuration uploaded! Sensor is active.
   ---------------------------------------------------------
    TIMESTAMP   | LIVE FAN SPEED       | STATUS
   ---------------------------------------------------------
    23:14:02    | RPM: 1248.5          | FAN RUNNING
    23:14:02    | RPM: 1249.2          | FAN RUNNING
    23:14:03    | RPM: 1251.0          | FAN RUNNING
   ```
5. On **Ctrl+C**, the trap automatically transmits `sensorStop` to shut off radar chirping and cleanly closes the port.

---

### 7.3 Method 2: Pure Linux Command-Line One-Liners (Manual)

If you prefer using two standard terminal panes (e.g. in `tmux`, `kitty`, `alacritty`, or two bash tabs):

#### Step 1: Configure Port
```bash
stty -F /dev/ttyACM0 115200 cs8 -cstopb -parenb raw -echo
```

#### Step 2: In Terminal 1 (Stream Listener)
```bash
cat /dev/ttyACM0 | grep --line-buffered "RPM:"
```

#### Step 3: In Terminal 2 (Send Configuration)
```bash
while IFS= read -r line; do
  [[ -n "$line" && ! "$line" =~ ^% ]] && echo -ne "${line}\r\n" > /dev/ttyACM0 && sleep 0.04
done < profile_fan_rpm.cfg
```
As soon as `sensorStart` is processed, **Terminal 1** will immediately begin streaming:
```text
RPM: 1248.5
RPM: 1249.2
RPM: 1250.0
```
To stop the sensor from Terminal 2:
```bash
echo -ne "sensorStop\r\n" > /dev/ttyACM0
```

---

### 7.4 Method 3: Arch Linux Terminal Tools (`tio` or `picocom`)

If you like dedicated terminal utilities on Arch Linux:

#### Option A: `tio` (Simple, modern serial I/O tool)
```bash
# Install tio via pacman:
sudo pacman -S tio

# Open connection:
tio -b 115200 /dev/ttyACM0
```
*(In another terminal, pipe `profile_fan_rpm.cfg` to `/dev/ttyACM0` using the loop from Method 2).*

#### Option B: `picocom`
```bash
# Install picocom via pacman:
sudo pacman -S picocom

# Connect:
picocom -b 115200 --imap lfcrlf /dev/ttyACM0
```

---

### 7.5 Method 4: Python CLI Script (`stream_fan_rpm.py`)

A feature-rich Python script is also provided with an ASCII visual speed bar:

```bash
# On Arch Linux, install python-pyserial:
sudo pacman -S python-pyserial

# Run the live monitor:
python3 stream_fan_rpm.py --port /dev/ttyACM0
```

---

## 8. Radar Profile Tuning Guide (`profile_fan_rpm.cfg`)

The chirp configuration file governs the physics of detection:

| Parameter | Configuration Command | Current Value | Physical Effect / Notes |
| :--- | :--- | :--- | :--- |
| **Carrier Frequency** | `profileCfg` | $77\text{ GHz}$ | $\lambda = 3.896\text{ mm}$ wavelength |
| **Frequency Slope** | `profileCfg` | $100\text{ MHz/\mu s}$ | Bandwidth $= 3.55\text{ GHz}$ |
| **ADC Samples** | `profileCfg` | $256$ samples | Range resolution $= 4.2\text{ cm}$ |
| **Number of Loops** | `frameCfg` | $32$ loops | 32 Doppler bins per frame |
| **Velocity Resolution** | Calculated | $0.66\text{ m/s}$ per bin | Sub-bin interpolation refines this $10\times$ |
| **Max Unambiguous Velocity** | Calculated | $\pm 10.59\text{ m/s}$ | $V_{\max}$ (supports up to $\approx 1011\text{ RPM}$ at $R = 0.1\text{ m}$) |
| **Frame Periodicity** | `frameCfg` | $200\text{ ms}$ ($5\text{ Hz}$) | Live update rate |
| **Detection Matrix** | `guiMonitor` | `... 1 0` | Bit 5 MUST be 1 (`rangeDopplerHeatMap`) |

### Tuning Scenarios

#### Scenario 1: Increase Live Update Rate from 5 Hz to 20 Hz
In `profile_fan_rpm.cfg`, edit line 50:
```text
% Change 200 ms (5 Hz) to 50 ms (20 Hz):
frameCfg 0 1 32 0 50 1 0
```

#### Scenario 2: Increase Maximum Detectable Fan Speed (> 1000 RPM)
To prevent Doppler velocity aliasing on high-speed fans ($> 1000\text{ RPM}$):
- Shorten the ramp end time and idle time in `profileCfg` so the chirp repetition interval $T_c$ decreases:
  $$V_{\max} = \frac{\lambda}{4 T_c}$$
- Or switch to single-TX mode (TX1 only) to cut $T_c$ in half, doubling $V_{\max}$ to $\pm 21.2\text{ m/s}$ ($> 2000\text{ RPM}$).

#### Scenario 3: Quadruple Doppler Resolution for Slow Fans (128 Doppler Bins)
Switch to single-TX mode with 128 loops:
```text
chirpCfg 0 0 0 0 0 0 0 1
frameCfg 0 0 128 0 50 1 0
```
This yields:
- 128 Doppler bins instead of 32.
- Doppler resolution drops from $0.66\text{ m/s}$ down to **$0.165\text{ m/s}$ per bin** ($4\times$ finer precision).

---

## 9. Software Architecture & File Overview

| File | Role | Key Functions / Structs |
| :--- | :--- | :--- |
| [`rpm_measurement.h`](file:///home/vish/workspace_ccstheia/out_of_box_1843_mss/rpm_measurement.h) | Physics & calibration header | `RPM_DEFAULT_BLADE_RADIUS_M`, `FanRpmResult_t`, `RPM_init()`, `RPM_calculateFromDetMatrix()` |
| [`rpm_measurement.c`](file:///home/vish/workspace_ccstheia/out_of_box_1843_mss/rpm_measurement.c) | Core DSP math engine | Range bin localization, noise estimation, symmetric envelope detection, parabolic interpolation, EMA filtering |
| [`mss_main.c`](file:///home/vish/workspace_ccstheia/out_of_box_1843_mss/mss_main.c) | MSS application coordinator | `MmwDemo_transmitProcessedOutput()` calls `RPM_calculateFromDetMatrix()` and streams RPM via `CLI_write()` |
| [`profile_fan_rpm.cfg`](file:///home/vish/workspace_ccstheia/out_of_box_1843_mss/profile_fan_rpm.cfg) | Radar sensor profile | Chirp and frame timing configured for 77 GHz fan rotational Doppler detection |

### How to Calibrate for Your Physical Fan
Open [`rpm_measurement.h`](file:///home/vish/workspace_ccstheia/out_of_box_1843_mss/rpm_measurement.h) and edit:
```c
/* 1. Measure the physical radius from hub center to blade tip in meters: */
#define RPM_DEFAULT_BLADE_RADIUS_M      0.10f   /* 0.10 m = 10 cm */

/* 2. Angle between radar line-of-sight and the plane of rotation: */
#define RPM_DEFAULT_ASPECT_ANGLE_DEG    0.0f    /* 0 deg for straight on */

/* 3. Output formatting mode: */
#define RPM_UART_NUMERIC_ONLY           0       /* 0: "RPM: 1250.4\r\n", 1: "1250.4\r\n" */
```

---

## 10. Troubleshooting & Verification FAQ

| Issue / Symptom | Root Cause | Solution |
| :--- | :--- | :--- |
| **Output shows `RPM: 0.0` consistently** | 1. Fan is stopped or blade reflection is too weak.<br>2. Fan is closer than $8\text{ cm}$ (near-field leakage filter).<br>3. `guiMonitor` bit 5 is disabled. | 1. Ensure fan is rotating.<br>2. Place fan between $0.3\text{ m}$ and $1.5\text{ m}$ away.<br>3. Verify `profile_fan_rpm.cfg` has `guiMonitor -1 1 0 0 0 1 0`. |
| **Live RPM is off by a constant factor ($\approx 1.5\times$ or $0.5\times$)** | `RPM_DEFAULT_BLADE_RADIUS_M` does not match the actual fan radius. | Measure the physical radius from center spindle to blade tip with a ruler and update the macro in `rpm_measurement.h`. |
| **CLI fails to start / No output on UART** | Wrong COM port connected or baud rate mismatch. | Connect to the **Application/User UART Port** at **115200 baud**. Do not connect to the Auxiliary Data Port. |
| **CCS JTAG reports "Target failed to connect"** | Jumper setting incorrect or board brownout. | 1. Check jumpers: **SOP2 and SOP0 must be closed**, SOP1 open (`1 0 1`).<br>2. Ensure 5V / 2.5A barrel power supply is plugged in and press the NRST button. |
| **Readings saturate or alias at top speed** | Blade tip linear speed exceeds radar $V_{\max}$ ($10.59\text{ m/s}$). | Increase $V_{\max}$ by decreasing chirp ramp time in `profileCfg` or switching to single-TX mode. |
| **Unexpected binary characters on UART** | Listening to the Auxiliary Data Port instead of the Application Port. | Close the Auxiliary port (921600) and open the Application Port (115200). Live RPM is pure ASCII on the Application Port. |
