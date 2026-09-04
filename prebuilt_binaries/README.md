# Prebuilt Binaries & Deployment Guide

This directory contains pre-compiled binaries and configuration files for the **AWR1843 Real-Time mmWave Radar Fan Tachometer** project. Users do **not** need to install TI compilers or build from source to run this project.

---

## 📁 Files Included

| File | Subsystem / Format | Purpose | How to Use |
| :--- | :--- | :--- | :--- |
| **`awr1843_fan_rpm.bin`** (321 KB) | Unified Multicore MetaImage | **Direct QSPI Flash** | Burn with **TI UniFlash** for standalone operation without a debugger. |
| **`out_of_box_1843_mss_isk.xer4f`** (3.4 MB) | ARM Cortex-R4F (ELF) | **Live JTAG Debug** | Load into Cortex-R4F via **Code Composer Studio (CCS)**. |
| **`out_of_box_1843_dss_isk.xe674`** (2.8 MB) | TI C674x DSP (ELF) | **Live JTAG Debug** | Load into C674x DSP via **Code Composer Studio (CCS)**. |
| **`profile_fan_rpm.cfg`** (3.0 KB) | Plaintext CLI Profile | **Radar Chirp Config** | Send over UART at 115200 baud to start FMCW chirping. |

---

## ⚡ Option A: Direct Flashing via TI UniFlash (Permanent / Standalone Mode)

Use this method to permanently flash the firmware onto the AWR1843BOOST board so it boots and runs autonomously without Code Composer Studio or a JTAG connection.

### Step 1: Set Hardware Jumpers to SOP5 (Flashing Mode)
Set the 3 Sense-On-Power (SOP) jumpers on the AWR1843BOOST:
- **SOP2**: **OFF** (open / unjumpered)
- **SOP1**: **OFF** (open / unjumpered)
- **SOP0**: **ON** (closed / jumpered)
> Binary State: `[0 0 1]`

### Step 2: Power Up the Board
1. Connect a **5V / 2.5A** DC barrel power supply (center-positive, 2.1mm) to the power jack.
2. Connect the micro-USB cable to your PC.
3. Press the board's **NRST** (warm reset) button once.

### Step 3: Flash with TI UniFlash
1. Launch **TI UniFlash** (web or desktop app).
2. In the device selection search bar, type `AWR1843BOOST` and click **Start**.
3. In the left navigation, click **Settings & Utilities**:
   - Locate the **COM Port** field.
   - Enter your AWR1843BOOST **Application / User UART** port:
     - Linux: `/dev/ttyACM0` (or check `ls -l /dev/serial/by-id/`)
     - Windows: `COMx` (check Windows Device Manager -> Ports -> "XDS110 Class Application/User UART")
4. In the left navigation, click **Program**:
   - Under **Meta Image 1**, click **Browse** and select `awr1843_fan_rpm.bin`.
5. Click **Load Image**.
   - UniFlash will erase the QSPI flash sectors and write the multicore image.
   - Wait until you see: `[SUCCESS] Program Load completed successfully`.

### Step 4: Switch to SOP4 (Functional Standalone Mode)
1. Disconnect the 5V DC power supply.
2. Remove the **SOP0** jumper so that **all jumpers are OFF**:
   - **SOP2**: **OFF**
   - **SOP1**: **OFF**
   - **SOP0**: **OFF**
   > Binary State: `[0 0 0]`
3. Reconnect the 5V DC power supply and press the **NRST** button once.
4. The radar is now permanently programmed and booted!

### Step 5: Send Chirp Profile & Stream Live RPM
From your terminal:
```bash
# Pure Bash runner (Linux):
cd ../out_of_box_1843_mss
./send_cfg_and_stream.sh /dev/ttyACM0

# Or Python visualizer (Cross-platform):
python3 stream_fan_rpm.py --cli-port /dev/ttyACM0 --data-port /dev/ttyACM1 --config ../prebuilt_binaries/profile_fan_rpm.cfg
```

---

## 🛠 Option B: Live Debugging via Code Composer Studio (CCS JTAG Mode)

Use this method for active source-level debugging, stepping through DSP or Cortex-R4F code, setting breakpoints, and inspecting live variables (`gRpmMeasurement`, `latestRpmEMA`).

### Step 1: Set Hardware Jumpers to SOP2 (Development / JTAG Mode)
Set the 3 Sense-On-Power (SOP) jumpers on the AWR1843BOOST:
- **SOP2**: **ON** (closed / jumpered)
- **SOP1**: **OFF** (open / unjumpered)
- **SOP0**: **ON** (closed / jumpered)
> Binary State: `[1 0 1]`

### Step 2: Power Up the Board
1. Connect 5V / 2.5A DC barrel power and micro-USB.
2. Press the **NRST** button once.

### Step 3: Launch Target Configuration in CCS
1. Open **Code Composer Studio (CCS Theia or CCS Eclipse)**.
2. Open **Target Configurations** view (`View -> Target Configurations`).
3. If you don't already have an AWR1843 configuration:
   - Create a new configuration (e.g. `AWR1843_XDS110.ccxml`).
   - Connection: `Texas Instruments XDS110 USB Debug Probe`.
   - Device: `AWR1843`. Click **Save**.
4. Right-click `AWR1843_XDS110.ccxml` -> **Launch Selected Configuration**.

### Step 4: Connect Cores & Load Prebuilt Binaries
1. In the **Debug** view:
   - Right-click `Texas Instruments XDS110 USB Debug Probe/C674X_0` -> **Connect Target**.
   - Right-click `Texas Instruments XDS110 USB Debug Probe/Cortex_R4_0` -> **Connect Target**.
2. **Load DSP Image**:
   - Highlight `C674X_0`.
   - Click `Run -> Load -> Load Program...`.
   - Browse to `prebuilt_binaries/out_of_box_1843_dss_isk.xe674`.
   - Click **OK**.
3. **Load MSS Image**:
   - Highlight `Cortex_R4_0`.
   - Click `Run -> Load -> Load Program...`.
   - Browse to `prebuilt_binaries/out_of_box_1843_mss_isk.xer4f`.
   - Click **OK**.

### Step 5: Run Targets & Stream Data
1. Select `C674X_0` and click **Resume (F8)**. (DSP runs and waits for MSS synchronization).
2. Select `Cortex_R4_0` and click **Resume (F8)**. (MSS initializes radar subsystems).
3. Both cores are now executing in real time from RAM.
4. Send `profile_fan_rpm.cfg` via UART terminal or script:
   ```bash
   ./send_cfg_and_stream.sh /dev/ttyACM0
   ```
5. You can now pause execution anytime in CCS, inspect `gRpmMeasurement` struct in the **Expressions** view, and watch Doppler peaks live in real time!
