# Real-Time Edge mmWave Radar Fan Tachometer
### Autonomous Rotational Speed (RPM) & Micro-Doppler Profiling on TI AWR1843BOOST (77 GHz FMCW SoC)

[![Platform: TI AWR1843BOOST](https://img.shields.io/badge/Platform-TI_AWR1843BOOST-blue.svg)](https://www.ti.com/tool/AWR1843BOOST)
[![Architecture: Cortex--R4F + C674x](https://img.shields.io/badge/Core-Cortex--R4F_%2B_C674x_DSP-orange.svg)](https://www.ti.com)
[![Frequency: 76--81 GHz](https://img.shields.io/badge/Frequency-76--81_GHz_FMCW-brightgreen.svg)]()
[![SDK: mmWave SDK 03.06.02.00](https://img.shields.io/badge/TI_SDK-03.06.02.00--LTS-yellow.svg)]()
[![Prebuilt: Ready to Flash](https://img.shields.io/badge/Prebuilt_Binaries-Ready_to_Flash-success.svg)](#5-deployment-guides-debug-vs-flash-mode)
[![License: BSD-3-Clause](https://img.shields.io/badge/License-BSD--3--Clause-lightgrey.svg)]()

---

## 1. Overview

This repository provides a complete, autonomous, edge-embedded radar tachometer system for contactless rotational speed (RPM) estimation of industrial and consumer fans, blowers, turbines, and propellers using the Texas Instruments **AWR1843BOOST** 77 GHz mmWave FMCW radar sensor.

Unlike typical radar demonstrations that capture raw ADC data and process it offline on a PC using MATLAB or Python, **this entire signal processing and kinematics pipeline executes on-chip in real time**:
- **Hardware Accelerator (HWA)**: Performs 1D Range FFT (256-pt) and 2D Doppler FFT (32/128-pt).
- **C674x DSP (DSS)**: Computes the 3D point cloud and 2D range-Doppler detection matrix in L3 shared memory.
- **ARM Cortex-R4F (MSS)**: Executes the high-accuracy RPM estimation engine (`rpm_measurement.c`) and streams clean live RPM readings over UART at 115200 baud.

---

## 2. Key Technical Innovations

1. **Automatic Fan Range Localization**:
   Accumulates moving Doppler energy ($d \neq 0, d \neq N/2$) across range bins to automatically lock onto the fan's distance, rejecting static clutter from walls and mounting fixtures.
2. **True 2D Detection Matrix Indexing**:
   Correctly maps memory offsets where Bin 0 is true DC ($0\text{ m/s}$), avoiding the common error of mistaking DC clutter for blade rotation.
3. **Adaptive CFAR Noise Floor & Dynamic Thresholding**:
   Estimates the local noise floor around the fan's range bin to reject ambient electromagnetic noise.
4. **Symmetric Doppler Envelope Tracking**:
   Measures both approaching ($+v_{\text{tip}}$) and receding ($-v_{\text{tip}}$) blade tips. Averaging them cancels net sensor vibrations and DC drift.
5. **Three-Point Parabolic Sub-Bin Interpolation**:
   Interpolates the fractional Doppler peak vertex:
   $$\delta = \frac{y[+1] - y[-1]}{2 \cdot (2y[0] - y[-1] - y[+1])}$$
   Achieving a **$10\times$ improvement in velocity resolution** without increasing FFT size or memory footprint.
6. **Rotational Kinematics & Temporal EMA Smoothing**:
   Transforms tip velocity into rotational speed using true physical dimensions:
   $$\text{RPM} = \frac{60 \cdot v_{\text{tip}}}{2\pi R_{\text{blade}} \cos(\theta)}$$
   Smoothed with an Exponential Moving Average (EMA, $\alpha = 0.20$) for stable real-time display.

---

## 3. Repository Structure

```text
├── prebuilt_binaries/                         # Ready-to-use binaries (no compiling required!)
│   ├── awr1843_fan_rpm.bin                   # Unified multicore image for TI UniFlash (321 KB)
│   ├── out_of_box_1843_mss_isk.xer4f         # Cortex-R4F ELF image for CCS debug (3.4 MB)
│   ├── out_of_box_1843_dss_isk.xe674         # C674x DSP ELF image for CCS debug (2.8 MB)
│   ├── profile_fan_rpm.cfg                   # Radar chirp configuration profile
│   └── README.md                             # Quick-flashing cheat sheet
│
├── docs/                                      # Educational guides & theory
│   ├── Beginners_Guide_mmWave_Radar_Fan_RPM.docx # Student learning textbook (from physics to code)
│   └── Beginners_Guide_mmWave_Radar_Fan_RPM.doc
│
├── out_of_box_1843_mss/                       # Master Subsystem (ARM Cortex-R4F) Source Code
│   ├── rpm_measurement.h                     # Physics constants, blade radius & data structures
│   ├── rpm_measurement.c                     # Range localization, envelope tracking, interpolation
│   ├── mss_main.c                            # Application coordinator & live UART streaming
│   ├── profile_fan_rpm.cfg                   # Chirp profile tuned for 77 GHz fan sensing
│   ├── send_cfg_and_stream.sh                # Pure-Bash Arch Linux CLI runner (zero dependencies)
│   ├── stream_fan_rpm.py                     # Python serial dashboard utility
│   ├── readme.md                             # MSS detailed technical documentation
│   └── isk/                                  # Build output directory
│       └── out_of_box_1843_mss_isk.xer4f     # Compiled Cortex-R4F binary
│
├── out_of_box_1843_dss/                       # Digital Signal Processor (C674x DSP) Source Code
│   ├── dss_main.c                            # DSP main data-path processing loop
│   └── isk/                                  # Build output directory
│       └── out_of_box_1843_dss_isk.xe674     # Compiled C674x DSP binary
│
├── tools/                                     # Tooling & Image Packaging
│   └── package_multicore_bin.py              # Generates UniFlash-compatible multicore .bin on Linux
│
├── .gitignore                                 # Excludes build objects and IDE caches
└── README.md                                  # Repository overview (this file)
```

---

## 4. Hardware Setup & SOP Boot Modes

The AWR1843BOOST EVM uses 3 Sense-On-Power (SOP) jumper pins to set the hardware boot mode:

| Mode | SOP 2 | SOP 1 | SOP 0 | State Binary | Purpose |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **SOP 2 (Development)** | **ON** | OFF | **ON** | `1 0 1` | **Live JTAG Debug Mode via CCS** (Loads `.xer4f` and `.xe674` directly into RAM) |
| **SOP 5 (Flashing)** | OFF | OFF | **ON** | `0 0 1` | **Flashing Mode via TI UniFlash** (Burns `awr1843_fan_rpm.bin` into QSPI flash) |
| **SOP 4 (Functional)** | OFF | OFF | OFF | `0 0 0` | **Standalone Boot Mode** (Autonomously runs flashed firmware on power-up) |

> [!IMPORTANT]
> **Power Supply Requirement**: Connect a dedicated **5V / 2.5A** (center-positive, 2.1mm) DC barrel jack adapter. Do **NOT** attempt to operate the radar solely from USB power; FMCW chirping demands up to 2.0A instantaneous peak current which will cause USB brownout resets.

---

## 5. Deployment Guides: Debug vs. Flash Mode

Choose the path that fits your workflow:
- **Path A: Direct Flashing via TI UniFlash** (Recommended for standalone operation without opening an IDE).
- **Path B: Live Debugging via Code Composer Studio** (Recommended for developers stepping through C code and breakpoints).

```
                      Do you want to step through code with a debugger?
                                      │
                     ┌────────────────┴────────────────┐
                     ▼ YES                             ▼ NO
            [ Path B: CCS Debug ]              [ Path A: UniFlash ]
            • Set Jumpers: [1 0 1]             • Set Jumpers: [0 0 1]
            • Open CCS Target Config           • Open TI UniFlash
            • Load .xer4f & .xe674 into RAM    • Burn awr1843_fan_rpm.bin to Flash
            • Run & inspect live variables     • Remove jumpers [0 0 0] & reset
```

---

### Path A: Direct Flashing via TI UniFlash (Permanent / Standalone Mode)

This method writes the unified multicore image into the onboard QSPI serial flash memory so the radar operates autonomously without CCS.

#### Step 1: Set Jumpers to SOP5 (Flashing Mode)
Place a jumper cap on **SOP0** only:
- **SOP 2**: **OFF** (Open)
- **SOP 1**: **OFF** (Open)
- **SOP 0**: **ON** (Closed)
> Binary State: `[0 0 1]`

#### Step 2: Power Up & Connect
1. Connect the **5V / 2.5A DC power supply** to the barrel jack.
2. Connect the micro-USB cable between the board and your PC.
3. Press the **NRST** (warm reset) button once.

#### Step 3: Launch TI UniFlash
1. Open **TI UniFlash** (desktop application or [cloud version](https://dev.ti.com/uniflash)).
2. In the search box, enter `AWR1843BOOST` and click **Start**.

#### Step 4: Configure Port
1. Click the **Settings & Utilities** tab on the left sidebar.
2. In the **COM Port** field, enter your **Application/User UART port**:
   - **Linux**: `/dev/ttyACM0` (ensure user is in `uucp` / `dialout` group)
   - **Windows**: `COMx` (check Device Manager -> Ports -> "XDS110 Class Application/User UART")
   > [!CAUTION]
   > Do **NOT** select the Auxiliary Data port (`/dev/ttyACM1` or the higher COM port). The bootloader exclusively listens on the Application UART port.

#### Step 5: Select Binary & Flash
1. Click the **Program** tab on the left sidebar.
2. In the **Meta Image 1** row:
   - Click **Browse** and select:
     [`prebuilt_binaries/awr1843_fan_rpm.bin`](prebuilt_binaries/awr1843_fan_rpm.bin)
   - Leave Meta Image 2, 3, and 4 blank.
3. Press the **NRST** button on the EVM once.
4. Click the blue **Load Image** button.
5. Wait for the progress bar to complete. The console will report:
   ```text
   [SUCCESS] Program Load completed successfully
   ```

#### Step 6: Switch to SOP4 (Functional Mode) & Run
1. Disconnect the 5V DC power supply.
2. Remove the **SOP0** jumper so that **all three jumpers are OFF**:
   - **SOP 2**: **OFF**
   - **SOP 1**: **OFF**
   - **SOP 0**: **OFF**
   > Binary State: `[0 0 0]`
3. Reconnect the 5V DC power supply.
4. Press the **NRST** button once.
5. The radar boots autonomously from flash and is ready for chirp commands! Proceed to [Section 6](#6-live-console-monitoring--uart-streaming).

---

### Path B: Live Debugging via Code Composer Studio (CCS JTAG Mode)

This method allows active source-level debugging, variable inspection (`gRpmMeasurement`, `latestRpmEMA`), breakpoints, and profiling.

#### Step 1: Set Jumpers to SOP2 (Development / JTAG Mode)
Place jumper caps on **SOP2** and **SOP0**:
- **SOP 2**: **ON** (Closed)
- **SOP 1**: **OFF** (Open)
- **SOP 0**: **ON** (Closed)
> Binary State: `[1 0 1]`

#### Step 2: Power Up & Connect
1. Connect 5V / 2.5A DC power and micro-USB.
2. Press the **NRST** button once.

#### Step 3: Launch Target Configuration in CCS
1. Open **Code Composer Studio (CCS Theia or Eclipse CCS)**.
2. Open the **Target Configurations** view (`View -> Target Configurations`).
3. If you do not have an existing AWR1843 configuration:
   - Click **New Target Configuration File** (e.g. `AWR1843_XDS110.ccxml`).
   - Connection: `Texas Instruments XDS110 USB Debug Probe`.
   - Board or Device: Check `AWR1843`. Click **Save**.
4. Right-click `AWR1843_XDS110.ccxml` -> **Launch Selected Configuration**.

#### Step 4: Connect Cores
In the CCS **Debug** view:
1. Right-click `Texas Instruments XDS110 USB Debug Probe/C674X_0` -> **Connect Target**.
2. Right-click `Texas Instruments XDS110 USB Debug Probe/Cortex_R4_0` -> **Connect Target**.

#### Step 5: Load Program Binaries
1. **Load DSP Binary**:
   - Click to select `C674X_0`.
   - Navigate to `Run -> Load -> Load Program...`.
   - Click **Browse** and select:
     [`prebuilt_binaries/out_of_box_1843_dss_isk.xe674`](prebuilt_binaries/out_of_box_1843_dss_isk.xe674)
   - Click **OK**.
2. **Load MSS Binary**:
   - Click to select `Cortex_R4_0`.
   - Navigate to `Run -> Load -> Load Program...`.
   - Click **Browse** and select:
     [`prebuilt_binaries/out_of_box_1843_mss_isk.xer4f`](prebuilt_binaries/out_of_box_1843_mss_isk.xer4f)
   - Click **OK**.

#### Step 6: Run Cores
1. Select `C674X_0` and click **Resume (F8)**. (DSP initializes and waits for MSS synchronization).
2. Select `Cortex_R4_0` and click **Resume (F8)**. (MSS completes system initialization and CLI startup).
3. Both cores are now running in RAM. Open your terminal to upload the chirp configuration and stream RPM!

---

## 6. Live Console Monitoring & UART Streaming

Once the radar is running (either via UniFlash Flash boot or CCS Debug load), stream live RPM directly in your terminal without any web visualizers.

### Method 1: Pure-Bash Arch Linux CLI Runner (Zero Dependencies!)
A self-contained script [`out_of_box_1843_mss/send_cfg_and_stream.sh`](out_of_box_1843_mss/send_cfg_and_stream.sh) configures the serial port, uploads the chirp profile, and displays live RPM in color:

```bash
cd out_of_box_1843_mss
./send_cfg_and_stream.sh /dev/ttyACM0
```

**Live Output:**
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
 23:30:01    | RPM: 1248.5          | FAN RUNNING
 23:30:02    | RPM: 1249.1          | FAN RUNNING
 23:30:03    | RPM: 1250.0          | FAN RUNNING
 23:30:04    | RPM: 1249.6          | FAN RUNNING
```
*Press **Ctrl+C** at any time to cleanly stop chirping and exit.*

### Method 2: Python Serial Dashboard
For cross-platform systems (Linux/Windows/macOS):
```bash
python3 out_of_box_1843_mss/stream_fan_rpm.py --cli-port /dev/ttyACM0 --data-port /dev/ttyACM1 --config prebuilt_binaries/profile_fan_rpm.cfg
```

---

## 7. Building from Source & Packaging

If you wish to modify the DSP algorithms or Cortex-R4F tachometer engine:

### Prerequisites
- TI mmWave SDK `03.06.02.00-LTS`
- TI ARM Compiler `16.9.6.LTS`
- TI C6000 DSP Compiler `8.3.3`

### 1. Compile DSS & MSS
```bash
# Compile DSS (C674x DSP)
cd out_of_box_1843_dss/isk
make clean && make all

# Compile MSS (ARM Cortex-R4F)
cd ../../out_of_box_1843_mss/isk
make clean && make all
```

### 2. Package into Unified UniFlash Binary (`.bin`)
On Linux, run the provided packaging utility:
```bash
python3 tools/package_multicore_bin.py
```
This utility:
1. Parses the loadable ELF segments of both `.xer4f` and `.xe674` using `pyelftools`.
2. Encapsulates them into TI RPRC format.
3. Invokes the native SDK `MulticoreImageGen` with BSS firmware (`xwr18xx_radarss_rprc.bin`) and shared memory configuration `0x00000008`.
4. Updates CRC tables and appends CRC32, outputting `prebuilt_binaries/awr1843_fan_rpm.bin`.

---

## 8. Educational Resources & Learning Guide

A comprehensive, student-friendly learning guide is included in the [`docs/`](docs/) directory:
- [`docs/Beginners_Guide_mmWave_Radar_Fan_RPM.docx`](docs/Beginners_Guide_mmWave_Radar_Fan_RPM.docx) (or `.doc`)

This document is written for first-year engineering students and covers:
- FMCW radar principles (chirps, beat frequencies, range and Doppler FFTs).
- Rotational micro-Doppler physics and blade reflection spread.
- Mathematical derivation of three-point parabolic sub-bin vertex interpolation.
- Full line-by-line explanation of the embedded C codebase.

---

## 9. License

This project is licensed under the **BSD-3-Clause License** - see the respective source files for details.
