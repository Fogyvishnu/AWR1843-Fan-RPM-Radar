#!/usr/bin/env bash
# ==============================================================================
# Pure Bash mmWave Config Uploader & Live RPM Streamer for Arch Linux Console
# ==============================================================================
# Zero dependencies: Uses standard Linux 'stty', bash file descriptors, and coreutils.
# ==============================================================================

set -e

PORT="${1:-/dev/ttyACM0}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CFG="${2:-${SCRIPT_DIR}/profile_fan_rpm.cfg}"
BAUD="${3:-115200}"

echo "=========================================================="
echo "    Arch Linux AWR1843BOOST Fan RPM Console Monitor"
echo "=========================================================="
echo " Port:        $PORT"
echo " Baud Rate:   $BAUD"
echo " Config File: $CFG"
echo "=========================================================="

if [ ! -e "$PORT" ]; then
    echo -e "\n[ERROR] Device '$PORT' not found!"
    echo "Make sure your AWR1843BOOST is connected to USB."
    echo "Check available devices with: ls -l /dev/ttyACM*"
    exit 1
fi

if [ ! -r "$PORT" ] || [ ! -w "$PORT" ]; then
    echo -e "\n[ERROR] Permission denied on '$PORT'!"
    echo "On Arch Linux, add your user to the 'uucp' group:"
    echo "  sudo usermod -a -G uucp $USER"
    echo "Then log out and log back in, or run:"
    echo "  newgrp uucp"
    exit 1
fi

if [ ! -f "$CFG" ]; then
    echo -e "\n[ERROR] Configuration file '$CFG' not found!"
    exit 1
fi

# Open file descriptor 3 for read/write on the serial port
# (Holding the FD open prevents DTR drop / board reboot)
exec 3<> "$PORT"

# Configure UART with stty: raw mode, no echo, 8-N-1, target baud
stty -F "$PORT" "$BAUD" raw -echo -echoe -echok -echoctl -echoke cs8 -cstopb -parenb

cleanup() {
    echo -e "\n\n[!] Interrupt received. Stopping radar sensor..."
    echo -ne "sensorStop\r\n" >&3 2>/dev/null || true
    sleep 0.1
    exec 3>&- 2>/dev/null || true
    echo "[OK] Radar stopped and port closed cleanly. Goodbye!"
    exit 0
}
trap cleanup SIGINT SIGTERM

echo -e "\n[1/2] Sending configuration to radar via $PORT..."
while IFS= read -r line || [[ -n "$line" ]]; do
    # Strip leading/trailing whitespace
    line=$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    
    # Skip comments and blank lines
    [[ -z "$line" || "$line" =~ ^% ]] && continue
    
    echo "  --> $line"
    echo -ne "${line}\r\n" >&3
    # mmWave CLI interpreter requires a small delay between commands
    sleep 0.04
done < "$CFG"

echo -e "\n[2/2] Configuration uploaded! Sensor is active."
echo "---------------------------------------------------------"
echo " TIMESTAMP   | LIVE FAN SPEED       | STATUS"
echo "---------------------------------------------------------"

# Continuously read and format incoming stream
while IFS= read -r line <&3; do
    # Remove carriage returns
    line=$(echo "$line" | tr -d '\r')
    
    if [[ "$line" =~ ^RPM: ]]; then
        rpm_val=$(echo "$line" | sed 's/RPM:[[:space:]]*//')
        now_str=$(date +"%H:%M:%S")
        
        # Color output: bright green for active fan, cyan for idle
        if awk "BEGIN {exit !($rpm_val > 10.0)}"; then
            printf " %-11s | \e[1;32m%-20s\e[0m | \e[32mFAN RUNNING\e[0m\n" "$now_str" "$line"
        else
            printf " %-11s | \e[1;36m%-20s\e[0m | \e[33mSTOPPED / IDLE\e[0m\n" "$now_str" "$line"
        fi
    elif [[ "$line" =~ "Error" ]]; then
        echo -e " \e[1;31m[CLI ERROR]\e[0m $line"
    fi
done
