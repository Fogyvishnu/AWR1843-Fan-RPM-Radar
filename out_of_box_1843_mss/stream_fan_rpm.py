#!/usr/bin/env python3
"""
===============================================================================
AWR1843BOOST Live Fan RPM Streamer & Configuration Uploader
===============================================================================
This utility connects to the TI AWR1843BOOST mmWave radar sensor's
Application/User UART port (default: 115200 baud), uploads the Doppler chirp
configuration file, and streams real-time live RPM measurements.

Usage:
  python3 stream_fan_rpm.py [OPTIONS]

Options:
  --port PORT     Serial port (e.g., /dev/ttyACM0 on Linux, COM3 on Windows)
  --cfg FILE      Path to mmWave chirp profile (default: profile_fan_rpm.cfg)
  --baud BAUD     CLI baud rate (default: 115200)
  --skip-cfg      Skip uploading .cfg (listen to already-running sensor)
  --help          Show this message
===============================================================================
"""

import sys
import os
import time
import argparse
import glob

def find_default_port():
    """Auto-detect default TI XDS110 Application/User UART port."""
    if sys.platform.startswith('linux'):
        # Usually /dev/ttyACM0 is Application/User UART, /dev/ttyACM1 is Data Port
        candidates = sorted(glob.glob('/dev/ttyACM*'))
        if candidates:
            return candidates[0]
        candidates = sorted(glob.glob('/dev/ttyUSB*'))
        if candidates:
            return candidates[0]
        return '/dev/ttyACM0'
    elif sys.platform.startswith('win'):
        return 'COM3'
    elif sys.platform.startswith('darwin'):
        candidates = sorted(glob.glob('/dev/tty.usbmodem*'))
        if candidates:
            return candidates[0]
        return '/dev/tty.usbmodem1'
    return '/dev/ttyACM0'

def parse_arguments():
    parser = argparse.ArgumentParser(
        description="Stream live Fan RPM from AWR1843BOOST Application UART port."
    )
    parser.add_argument(
        '--port',
        type=str,
        default=find_default_port(),
        help="Application/User COM port (default: %(default)s)"
    )
    parser.add_argument(
        '--cfg',
        type=str,
        default=os.path.join(os.path.dirname(__file__), 'profile_fan_rpm.cfg'),
        help="Radar chirp configuration file (default: %(default)s)"
    )
    parser.add_argument(
        '--baud',
        type=int,
        default=115200,
        help="Application UART baud rate (default: %(default)s)"
    )
    parser.add_argument(
        '--skip-cfg',
        action='store_true',
        help="Skip uploading .cfg file (listen only)"
    )
    return parser.parse_args()

def main():
    args = parse_arguments()

    try:
        import serial
    except ImportError:
        print("[ERROR] 'pyserial' library not found.")
        print("Please install it using: pip install pyserial")
        sys.exit(1)

    print("=" * 65)
    print("      TI AWR1843BOOST - LIVE FAN RPM MONITOR")
    print("=" * 65)
    print(f" Target Port: {args.port}")
    print(f" Baud Rate:   {args.baud} (8-N-1)")
    print(f" Config File: {args.cfg}")
    print("=" * 65)

    try:
        ser = serial.Serial(args.port, args.baud, timeout=0.1)
    except serial.SerialException as e:
        print(f"\n[ERROR] Failed to open serial port '{args.port}':")
        print(f"        {e}")
        print("\nTroubleshooting tips:")
        print(" 1. Check if AWR1843BOOST is plugged into USB.")
        print(" 2. Verify port name (Linux: 'ls -l /dev/ttyACM*', Win: Device Manager).")
        print(" 3. If permission denied on Linux: 'sudo usermod -a -G dialout $USER'")
        print(" 4. Close any other terminal (CCS Console, Tera Term, PuTTY) using this port.")
        sys.exit(1)

    time.sleep(0.3)
    ser.reset_input_buffer()
    ser.reset_output_buffer()

    # Upload configuration file if not skipped
    if not args.skip_cfg:
        if not os.path.exists(args.cfg):
            print(f"\n[ERROR] Configuration file '{args.cfg}' not found.")
            ser.close()
            sys.exit(1)

        print(f"\n[1/2] Uploading configuration to radar ({args.cfg})...")
        with open(args.cfg, 'r') as f:
            cfg_lines = f.readlines()

        for line in cfg_lines:
            line = line.strip()
            # Skip empty lines and comments
            if not line or line.startswith('%'):
                continue

            ser.write((line + '\n').encode('utf-8'))
            time.sleep(0.04)  # mmWave CLI command parsing delay

            resp = ser.read_all().decode('utf-8', errors='ignore')
            if "Error" in resp:
                print(f"  [!] CLI Response Error on command '{line}': {resp.strip()}")

        print("[OK] Configuration uploaded successfully! Radar is active.\n")
    else:
        print("\n[INFO] Skipping config upload (--skip-cfg active). Listening directly...")

    print("[2/2] Streaming Live RPM from Application UART...")
    print("-" * 65)
    print(f" {'TIMESTAMP':<12} | {'LIVE RPM':<14} | {'STATUS':<15} | {'VISUAL BAR'}")
    print("-" * 65)

    try:
        while True:
            raw_line = ser.readline().decode('utf-8', errors='ignore').strip()
            if not raw_line:
                continue

            # Process live RPM string
            if raw_line.startswith("RPM:"):
                rpm_str = raw_line.replace("RPM:", "").strip()
                try:
                    rpm_val = float(rpm_str)
                    now_str = time.strftime("%H:%M:%S")

                    if rpm_val > 10.0:
                        status = "FAN RUNNING"
                        # Generate simple visual bar up to 2500 RPM
                        bar_len = min(25, int(rpm_val / 100.0))
                        bar = "#" * bar_len
                    else:
                        status = "STOPPED / IDLE"
                        bar = "-"

                    print(f" {now_str:<12} | {rpm_val:8.1f} RPM   | {status:<15} | [{bar:<25}]")
                except ValueError:
                    pass

    except KeyboardInterrupt:
        print("\n\nUser interrupted (Ctrl+C). Stopping radar sensor...")
        try:
            ser.write(b'sensorStop\n')
            time.sleep(0.1)
        except Exception:
            pass
        ser.close()
        print("[OK] Sensor stopped and port closed cleanly. Goodbye!")

if __name__ == '__main__':
    main()
