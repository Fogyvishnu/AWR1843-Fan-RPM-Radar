# Real-Time Edge mmWave Radar Fan Tachometer
### Autonomous Rotational Speed (RPM) & Micro-Doppler Profiling on TI AWR1843BOOST (77 GHz FMCW SoC)

[![Platform: TI AWR1843BOOST](https://img.shields.io/badge/Platform-TI_AWR1843BOOST-blue.svg)](https://www.ti.com/tool/AWR1843BOOST)
[![Architecture: Cortex--R4F + C674x](https://img.shields.io/badge/Core-Cortex--R4F_%2B_C674x_DSP-orange.svg)](https://www.ti.com)
[![Frequency: 76--81 GHz](https://img.shields.io/badge/Frequency-76--81_GHz_FMCW-brightgreen.svg)]()
[![SDK: mmWave SDK 03.06.02.00](https://img.shields.io/badge/TI_SDK-03.06.02.00--LTS-yellow.svg)]()
[![License: BSD-3-Clause](https://img.shields.io/badge/License-BSD--3--Clause-lightgrey.svg)]()

---

## 1. Overview

This repository contains a complete, autonomous, edge-embedded radar tachometer system for contactless measurement of rotating machinery (cooling fans, ventilation blowers, turbines, and propellers) using the Texas Instruments **AWR1843BOOST** 77 GHz mmWave FMCW radar sensor.

Unlike traditional radar demonstrations that capture raw ADC data and process it offline using MATLAB or Python on a host PC, **this entire signal processing and kinematics engine runs on-chip in real time**:
- **Hardware Accelerator (HWA)**: Executes 1D Range FFT (256-pt) and 2D Doppler FFT (32/128-pt).
- **C674x DSP (DSS)**: Computes 3D point cloud and range-Doppler detection matrix in L3 RAM.
- **ARM Cortex-R4F (MSS)**: Executes the high-accuracy RPM engine (`rpm_measurement.c`) and streams clean live RPM readings over UART at 115200 baud.

---

## 2. Key Technical Innovations

1. **Automatic Fan Range Localization**:
   Accumulates moving Doppler energy ($d \neq 0, d \neq N/2$) across range bins to automatically lock onto the fan's distance, rejecting static clutter from walls and mounting frames.
2. **Correct TI 2D Detection Matrix Indexing**:
   Properly maps memory offsets where Bin 0 is true DC ($0\text{ m/s}$), avoiding the common pitfall of mistaking DC clutter for blade rotation.
3. **Adaptive CFAR Noise Floor & Dynamic SNR Thresholding**:
   Calculates the local noise floor around the fan's range bin to reject ambient electromagnetic noise.
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

## 3. Repository Directory Structure

```text
├── docs/                                      # Complete documentation & publications
│   ├── Beginners_Guide_mmWave_Radar_Fan_RPM.docx # Student learning guide (from physics to code)
│   ├── Beginners_Guide_mmWave_Radar_Fan_RPM.doc
│   ├── Research_Paper_Proposal_mmWave_Fan_RPM.docx # IEEE paper proposal & research blueprint
│   └── Research_Paper_Proposal_mmWave_Fan_RPM.doc
│
├── out_of_box_1843_mss/                       # Master Subsystem (ARM Cortex-R4F) Project
│   ├── rpm_measurement.h                     # Physics constants, blade radius & data structures
│   ├── rpm_measurement.c                     # Range localization, envelope tracking, interpolation
│   ├── mss_main.c                            # Application coordinator & live UART streaming
│   ├── profile_fan_rpm.cfg                   # Chirp profile tuned for 77 GHz fan sensing
│   ├── send_cfg_and_stream.sh                # Pure Bash Arch Linux CLI runner (zero dependencies)
│   ├── stream_fan_rpm.py                     # Python serial dashboard utility
│   ├── readme.md                             # MSS detailed technical documentation
│   └── isk/                                  # Build output directory
│       └── out_of_box_1843_mss_isk.xer4f     # Pre-compiled Cortex-R4F binary (3.4 MB)
│
├── out_of_box_1843_dss/                       # Digital Signal Processor (C674x DSP) Project
│   ├── dss_main.c                            # DSP main data-path processing loop
│   └── isk/                                  # Build output directory
│       └── out_of_box_1843_dss_isk.xe674     # Pre-compiled C674x DSP binary (2.8 MB)
│
├── .gitignore                                 # Excludes build objects and IDE caches
└── README.md                                  # Repository overview (this file)
```

---

## 4. Hardware Setup

### 4.1 Jumper Configuration (SOP2 Debug Mode)
| Jumper | State | Function |
| :---: | :---: | :--- |
| **SOP 2** | **ON (Closed)** | Enables JTAG / CCS Debugging |
| **SOP 1** | OFF (Open) | Standard operational mode |
| **SOP 0** | **ON (Closed)** | Development boot |

### 4.2 Power & Connections
- **Power**: Connect a **5V / 2.5A** DC barrel power adapter (center-positive, 2.1mm).
- **USB**: Connect the micro-USB cable to your PC (onboard TI XDS110 debug probe).
- **Placement**: Position the radar broadside to the fan face at a distance of **0.3 m to 2.0 m**.

---

## 5. Quick Start (Arch Linux / Linux Console)

### Step 1: Clone the Repository
```bash
git clone https://github.com/<YOUR_USERNAME>/<YOUR_REPO_NAME>.git
cd <YOUR_REPO_NAME>/out_of_box_1843_mss
```

### Step 2: Ensure User Permissions
On Arch Linux, serial ports belong to `uucp`:
```bash
sudo usermod -a -G uucp $USER
newgrp uucp
```

### Step 3: Run the Pure-Bash Monitor (Zero Dependencies!)
With the firmware loaded into the AWR1843BOOST:
```bash
./send_cfg_and_stream.sh /dev/ttyACM0
```
This automatically uploads `profile_fan_rpm.cfg` and streams the live RPM in color directly in your terminal:
```text
==========================================================
    Arch Linux AWR1843BOOST Fan RPM Console Monitor
==========================================================
 Port:        /dev/ttyACM0
 Baud Rate:   115200
 Config File: profile_fan_rpm.cfg
==========================================================
[1/2] Sending configuration to radar via /dev/ttyACM0...
[OK] Configuration uploaded! Sensor is active.
---------------------------------------------------------
 TIMESTAMP   | LIVE FAN SPEED       | STATUS
---------------------------------------------------------
 23:30:01    | RPM: 1248.5          | FAN RUNNING
 23:30:02    | RPM: 1249.1          | FAN RUNNING
 23:30:03    | RPM: 1250.0          | FAN RUNNING
```

---

## 6. Building & Debugging from Source

### Prerequisites
- TI mmWave SDK `03.06.02.00-LTS`
- Code Composer Studio (CCS Theia or Eclipse CCS)
- TI ARM Compiler `16.9.6.LTS`
- TI C6000 Compiler `8.3.3`

### Command-Line Compilation
```bash
# 1. Build DSP (C674x)
cd out_of_box_1843_dss/isk
make clean && make all

# 2. Build MSS (ARM Cortex-R4F)
cd out_of_box_1843_mss/isk
make clean && make all
```

---

## 7. Learning Resources & Research Proposals

- **Beginner's Educational Guide**: See [`docs/Beginners_Guide_mmWave_Radar_Fan_RPM.docx`](docs/Beginners_Guide_mmWave_Radar_Fan_RPM.docx) for a first-year engineering textbook explaining FMCW radar physics, Doppler shifts, parabolic vertex derivations, and step-by-step C code.
- **Academic Research Proposal**: See [`docs/Research_Paper_Proposal_mmWave_Fan_RPM.docx`](docs/Research_Paper_Proposal_mmWave_Fan_RPM.docx) for four novel IEEE publication tracks (Dual-Domain Physics Fusion, Edge Efficiency, Fault Diagnosis, and Harsh Environment Sensing).

---

## 8. License
This project is licensed under the BSD-3-Clause License - see the respective source files for details.
