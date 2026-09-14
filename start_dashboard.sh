#!/usr/bin/env bash
# ==============================================================================
# AWR1843BOOST Radar Tachometer - Web Dashboard Launcher
# ==============================================================================

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=========================================================="
echo "    AWR1843BOOST Radar Fan Tachometer Web HUD"
echo "=========================================================="

# Check for Python 3
if ! command -v python3 &> /dev/null; then
    echo "[ERROR] Python 3 is not installed or not in PATH."
    exit 1
fi

# Launch Python backend server
exec python3 "${SCRIPT_DIR}/dashboard/app.py" "$@"
