#!/usr/bin/env python3
"""
===============================================================================
AWR1843BOOST mmWave Radar Fan Tachometer - Web Dashboard Server
===============================================================================
High-performance, zero-dependency Python backend serving a real-time
cyberpunk military avionics radar HUD dashboard over HTTP + Server-Sent Events (SSE).

Compatible with all standard Python 3.8+ installations.
===============================================================================
"""

import os
import sys
import json
import time
import math
import glob
import random
import threading
import queue
import urllib.parse
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

try:
    import serial
    import serial.tools.list_ports
    HAS_SERIAL = True
except ImportError:
    HAS_SERIAL = False

# Path configuration
DASHBOARD_DIR = Path(__file__).resolve().parent
REPO_ROOT = DASHBOARD_DIR.parent
STATIC_DIR = DASHBOARD_DIR / "static"

# Global state
state = {
    "port": None,
    "baud": 115200,
    "is_connected": False,
    "is_sensor_active": False,
    "simulation_mode": False,
    "sim_speed_target": 285.0,
    "sim_current_speed": 0.0,
    "blade_radius_m": 0.60,
    "aspect_angle_deg": 30.0,
    "cal_scale": 2.10,
    "selected_profile": "profile_fan_rpm_highspeed.cfg",
    "raw_logs": []
}

state_lock = threading.Lock()
sse_subscribers = []
sse_lock = threading.Lock()
serial_io_lock = threading.Lock()
is_uploading_cfg = threading.Event()
serial_conn = None
serial_thread = None
sim_thread = None
shutdown_flag = threading.Event()

def get_available_ports():
    """Scans and accurately ranks USB / TI XDS110 serial ports."""
    ports_list = []
    if HAS_SERIAL:
        try:
            for p in serial.tools.list_ports.comports():
                dev = p.device
                desc = p.description or "Serial Device"
                hwid = p.hwid or ""
                # Exclude legacy motherboard ttyS ports on Linux
                if dev.startswith("/dev/ttyS") and dev[9:].isdigit() and int(dev[9:]) > 3:
                    continue

                desc_lower = (desc + " " + hwid).lower()
                is_xds = ("xds110" in desc_lower or "ti" in desc_lower)
                is_app_uart = ("application" in desc_lower or "user" in desc_lower or "cli" in desc_lower)
                is_data_port = ("auxiliary" in desc_lower or "data" in desc_lower)

                if is_xds and is_app_uart:
                    label = f"{dev} — TI XDS110 Application/User UART [RECOMMENDED]"
                    rank = 1
                    is_cli = True
                elif is_xds and is_data_port:
                    label = f"{dev} — TI XDS110 Auxiliary Data Port (Data only)"
                    rank = 3
                    is_cli = False
                elif "acm0" in dev.lower() or "usb0" in dev.lower():
                    label = f"{dev} — USB Radar Serial [RECOMMENDED]"
                    rank = 1
                    is_cli = True
                elif "acm1" in dev.lower() or "usb1" in dev.lower():
                    label = f"{dev} — USB Auxiliary Data Port"
                    rank = 3
                    is_cli = False
                elif "usb" in desc_lower or "xds" in desc_lower or "acm" in dev.lower():
                    label = f"{dev} — {desc}"
                    rank = 2
                    is_cli = True
                else:
                    label = f"{dev} — {desc}"
                    rank = 4
                    is_cli = False

                ports_list.append({
                    "port": dev,
                    "desc": label,
                    "raw_desc": desc,
                    "rank": rank,
                    "is_cli": is_cli,
                    "recommended": (rank == 1)
                })
        except Exception:
            pass

    # Fallback search for Linux dev nodes
    if sys.platform.startswith("linux"):
        for path in sorted(glob.glob("/dev/ttyACM*") + glob.glob("/dev/ttyUSB*")):
            if not any(p["port"] == path for p in ports_list):
                rank = 1 if ("ACM0" in path or "USB0" in path) else 2
                ports_list.insert(0, {
                    "port": path,
                    "desc": f"{path} — USB Radar Device",
                    "raw_desc": path,
                    "rank": rank,
                    "is_cli": True,
                    "recommended": (rank == 1)
                })

    # Sort so rank 1 (Application/User UART) is ALWAYS first!
    ports_list.sort(key=lambda x: (x["rank"], x["port"]))
    return ports_list

def get_available_profiles():
    """Returns all available radar configuration profiles found in the repo."""
    profiles = []
    search_dirs = [
        REPO_ROOT / "out_of_box_1843_mss",
        REPO_ROOT / "prebuilt_binaries",
        REPO_ROOT
    ]
    seen = set()
    for sdir in search_dirs:
        if sdir.exists():
            for p in sorted(sdir.glob("*.cfg")):
                if p.name not in seen:
                    seen.add(p.name)
                    desc = "Standard 2-TX Profile" if "highspeed" not in p.name else "1-TX High-Speed (Up to 400+ RPM)"
                    profiles.append({
                        "name": p.name,
                        "path": str(p),
                        "desc": desc
                    })
    return profiles

def broadcast_telemetry(payload):
    """Pushes telemetry JSON packet to all connected SSE clients."""
    with sse_lock:
        data_str = f"data: {json.dumps(payload)}\n\n"
        dead_clients = []
        for q in sse_subscribers:
            try:
                q.put_nowait(data_str)
            except queue.Full:
                dead_clients.append(q)
        for dead in dead_clients:
            if dead in sse_subscribers:
                sse_subscribers.remove(dead)

def parse_radar_line(raw_line):
    """
    Parses radar UART line formats:
    Rich format: "RPM: 284.5 | RUNNING | Dist: 1.85m | SNR: 8.1dB | TipVel: 17.8m/s"
    Legacy format: "RPM: 284.5"
    """
    raw_line = raw_line.strip()
    if not raw_line.startswith("RPM:"):
        return None

    now_str = time.strftime("%H:%M:%S")
    timestamp_ms = int(time.time() * 1000)

    with state_lock:
        blade_r = state["blade_radius_m"]
        angle_deg = state["aspect_angle_deg"]
        cal_scale = state.get("cal_scale", 2.10)

    cos_theta = math.cos(math.radians(angle_deg))
    if cos_theta < 0.1:
        cos_theta = 1.0

    if "|" in raw_line:
        tokens = [t.strip() for t in raw_line.split("|")]
        # Token 0: "RPM: 284.5"
        try:
            raw_rpm = float(tokens[0].replace("RPM:", "").strip())
        except ValueError:
            raw_rpm = 0.0

        status_str = tokens[1] if len(tokens) > 1 else "STOPPED"
        is_running = (status_str == "RUNNING")

        # Dist token: "Dist: 1.85m"
        dist_val = 0.0
        if len(tokens) > 2:
            try:
                d_str = tokens[2].replace("Dist:", "").replace("m", "").strip()
                dist_val = float(d_str)
            except ValueError:
                dist_val = 0.0

        # SNR token: "SNR: 8.1dB"
        snr_val = 0.0
        if len(tokens) > 3:
            try:
                s_str = tokens[3].replace("SNR:", "").replace("dB", "").strip()
                snr_val = float(s_str)
            except ValueError:
                snr_val = 0.0

        # TipVel token: "TipVel: 17.8m/s"
        tip_vel = 0.0
        if len(tokens) > 4:
            try:
                v_str = tokens[4].replace("TipVel:", "").replace("m/s", "").strip()
                tip_vel = float(v_str)
            except ValueError:
                tip_vel = 0.0

        # Calibrated RPM calculation based on live user-adjusted radius, angle, and calibration scale:
        # RPM = ((60 * tip_vel) / (2 * pi * R * cos(theta))) * cal_scale
        if tip_vel > 0.1 and is_running and blade_r > 0.05:
            calibrated_rpm = ((60.0 * tip_vel) / (2.0 * math.pi * blade_r * cos_theta)) * cal_scale
        else:
            calibrated_rpm = (raw_rpm * cal_scale) if is_running else 0.0

        return {
            "type": "telemetry",
            "rpm": round(calibrated_rpm, 1),
            "raw_rpm": round(raw_rpm, 1),
            "status": status_str,
            "is_running": is_running,
            "dist": round(dist_val, 2),
            "snr": round(snr_val, 1),
            "tip_vel": round(tip_vel, 1),
            "radius": blade_r,
            "angle": angle_deg,
            "cal_scale": cal_scale,
            "timestamp": now_str,
            "ts_ms": timestamp_ms
        }
    else:
        # Single token legacy output
        try:
            raw_rpm = float(raw_line.replace("RPM:", "").strip())
        except ValueError:
            raw_rpm = 0.0
        is_running = raw_rpm > 10.0
        calibrated_rpm = (raw_rpm * cal_scale) if is_running else 0.0
        return {
            "type": "telemetry",
            "rpm": round(calibrated_rpm, 1),
            "raw_rpm": round(raw_rpm, 1),
            "status": "RUNNING" if is_running else "STOPPED",
            "is_running": is_running,
            "dist": 1.85 if is_running else 0.0,
            "snr": 7.5 if is_running else 0.0,
            "tip_vel": round((2.0 * math.pi * blade_r * cos_theta * calibrated_rpm) / 60.0, 1) if is_running else 0.0,
            "radius": blade_r,
            "angle": angle_deg,
            "cal_scale": cal_scale,
            "timestamp": now_str,
            "ts_ms": timestamp_ms
        }

def serial_reader_loop():
    """Background worker continuously receiving data from AWR1843BOOST UART."""
    global serial_conn
    while not shutdown_flag.is_set():
        if is_uploading_cfg.is_set():
            time.sleep(0.05)
            continue

        if serial_conn is not None and serial_conn.is_open:
            try:
                line = None
                with serial_io_lock:
                    if serial_conn is not None and serial_conn.is_open and not is_uploading_cfg.is_set():
                        raw_bytes = serial_conn.readline()
                        if raw_bytes:
                            line = raw_bytes.decode("utf-8", errors="ignore").strip()

                if not line:
                    continue

                # Add to raw log buffer
                with state_lock:
                    state["raw_logs"].append(f"[{time.strftime('%H:%M:%S')}] {line}")
                    if len(state["raw_logs"]) > 200:
                        state["raw_logs"].pop(0)

                parsed = parse_radar_line(line)
                if parsed:
                    broadcast_telemetry(parsed)
                else:
                    # Forward non-RPM status / CLI messages
                    broadcast_telemetry({
                        "type": "log",
                        "message": line,
                        "timestamp": time.strftime("%H:%M:%S")
                    })
            except Exception as e:
                if not shutdown_flag.is_set() and not is_uploading_cfg.is_set():
                    with state_lock:
                        state["is_connected"] = False
                        state["is_sensor_active"] = False
                    broadcast_telemetry({
                        "type": "status",
                        "connected": False,
                        "error": f"Serial communication lost: {e}"
                    })
                    break
        else:
            time.sleep(0.05)

def simulation_worker_loop():
    """Generates ultra-realistic aerodynamic radar micro-Doppler telemetry."""
    curr_rpm = 0.0
    dist_baseline = 1.85
    while not shutdown_flag.is_set():
        with state_lock:
            sim_active = state["simulation_mode"]
            target_rpm = state["sim_speed_target"]
            blade_r = state["blade_radius_m"]
            angle_deg = state["aspect_angle_deg"]
            conn = state["is_connected"]

        if sim_active and not conn:
            # Inertial spin up / spin down physics
            curr_rpm += (target_rpm - curr_rpm) * 0.12
            if curr_rpm < 2.0:
                curr_rpm = 0.0

            is_running = curr_rpm > 15.0
            cos_theta = math.cos(math.radians(angle_deg))
            if cos_theta < 0.1:
                cos_theta = 1.0

            # Aerodynamic blade tip velocity: v = omega * R * cos(angle)
            omega = 2.0 * math.pi * (curr_rpm / 60.0)
            tip_vel = omega * blade_r * cos_theta

            # Add natural blade flutter and micro-Doppler noise
            noise = (math.sin(time.time() * 8.0) * 1.5) + (random.uniform(-0.8, 0.8)) if is_running else 0.0
            display_rpm = max(0.0, curr_rpm + noise) if is_running else 0.0
            display_dist = dist_baseline + (random.uniform(-0.02, 0.02) if is_running else 0.0)
            display_snr = (8.2 + math.sin(time.time() * 3.0) * 0.8 + random.uniform(-0.3, 0.3)) if is_running else -1.2
            display_tip_vel = max(0.0, tip_vel + (noise * 0.06)) if is_running else 0.0

            payload = {
                "type": "telemetry",
                "rpm": round(display_rpm, 1),
                "raw_rpm": round(display_rpm, 1),
                "status": "RUNNING" if is_running else "STOPPED",
                "is_running": is_running,
                "dist": round(display_dist, 2),
                "snr": round(display_snr, 1),
                "tip_vel": round(display_tip_vel, 1),
                "radius": blade_r,
                "angle": angle_deg,
                "cal_scale": state.get("cal_scale", 2.10),
                "timestamp": time.strftime("%H:%M:%S"),
                "ts_ms": int(time.time() * 1000),
                "simulation": True
            }
            broadcast_telemetry(payload)
            time.sleep(0.1)  # 10 Hz telemetry rate
        else:
            time.sleep(0.2)

def find_profile_path(profile_name):
    """Finds full path to the requested radar configuration profile."""
    candidates = [
        REPO_ROOT / "out_of_box_1843_mss" / profile_name,
        REPO_ROOT / "prebuilt_binaries" / profile_name,
        REPO_ROOT / profile_name
    ]
    for c in candidates:
        if c.exists():
            return c
    return None

def send_radar_config(cfg_path):
    """
    Safely sends .cfg profile commands to the AWR1843 radar CLI port.
    Ensures safe line endings (\\n), checks response, and reports progress over SSE.
    """
    global serial_conn
    with state_lock:
        if serial_conn is None or not serial_conn.is_open:
            broadcast_telemetry({"type": "cfg_progress", "stage": "error", "message": "Radar is not connected."})
            return False, "Radar is not connected."

    is_uploading_cfg.set()
    try:
        with serial_io_lock:
            # 1. Stop any currently active chirping and clear buffers
            try:
                serial_conn.write(b"sensorStop\n")
                time.sleep(0.08)
                serial_conn.reset_input_buffer()
                serial_conn.reset_output_buffer()
            except Exception:
                pass

            broadcast_telemetry({
                "type": "log",
                "message": f"[*] Uploading radar profile: {cfg_path.name}..."
            })
            broadcast_telemetry({
                "type": "cfg_progress",
                "stage": "starting",
                "message": f"Preparing {cfg_path.name}..."
            })

            with open(cfg_path, "r") as f:
                commands = [line.strip() for line in f if line.strip() and not line.strip().startswith("%")]

            total = len(commands)
            error_count = 0

            for idx, cmd in enumerate(commands, 1):
                # Send command with single \n terminator
                serial_conn.write((cmd + "\n").encode("utf-8"))

                # mmWave CLI required parsing delay
                cmd_delay = 0.08 if ("sensorStart" in cmd or "sensorStop" in cmd) else 0.035
                time.sleep(cmd_delay)

                # Read CLI response
                resp = ""
                try:
                    if serial_conn.in_waiting > 0:
                        resp = serial_conn.read(serial_conn.in_waiting).decode("utf-8", errors="ignore").strip()
                except Exception:
                    pass

                has_err = ("Error" in resp)
                if has_err:
                    error_count += 1
                    broadcast_telemetry({
                        "type": "log",
                        "message": f"[!] Error on '{cmd}': {resp}"
                    })

                broadcast_telemetry({
                    "type": "cfg_progress",
                    "stage": "uploading",
                    "current": idx,
                    "total": total,
                    "percent": int((idx / total) * 100),
                    "command": cmd,
                    "error": has_err,
                    "message": f"[{idx}/{total}] {cmd}"
                })

            with state_lock:
                state["is_sensor_active"] = True

            msg = f"Radar initialized with {cfg_path.name}. Chirping active!"
            broadcast_telemetry({
                "type": "cfg_progress",
                "stage": "complete",
                "total": total,
                "current": total,
                "percent": 100,
                "message": msg
            })
            broadcast_telemetry({
                "type": "status",
                "connected": True,
                "sensor_active": True,
                "message": msg
            })
            broadcast_telemetry({
                "type": "log",
                "message": f"[SUCCESS] {msg}"
            })
            return True, msg

    except Exception as e:
        err_msg = f"Config upload failed: {e}"
        broadcast_telemetry({
            "type": "cfg_progress",
            "stage": "error",
            "message": err_msg
        })
        broadcast_telemetry({
            "type": "log",
            "message": f"[ERROR] {err_msg}"
        })
        return False, err_msg
    finally:
        is_uploading_cfg.clear()

class RadarDashboardHandler(SimpleHTTPRequestHandler):
    """Custom REST API & SSE HTTP handler."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def do_GET(self):
        url_parts = urllib.parse.urlparse(self.path)
        path = url_parts.path

        if path == "/api/stream":
            self.handle_sse_stream()
            return
        elif path == "/api/ports":
            self.send_json_response({"ports": get_available_ports()})
            return
        elif path == "/api/profiles":
            self.send_json_response({"profiles": get_available_profiles()})
            return
        elif path == "/api/status":
            with state_lock:
                self.send_json_response({
                    "connected": state["is_connected"],
                    "port": state["port"],
                    "baud": state["baud"],
                    "sensor_active": state["is_sensor_active"],
                    "simulation": state["simulation_mode"],
                    "sim_target": state["sim_speed_target"],
                    "radius": state["blade_radius_m"],
                    "angle": state["aspect_angle_deg"],
                    "cal_scale": state.get("cal_scale", 2.10),
                    "selected_profile": state["selected_profile"]
                })
            return
        elif path == "/api/logs":
            with state_lock:
                self.send_json_response({"logs": state["raw_logs"][-50:]})
            return

        # Default static file serving
        return super().do_GET()

    def do_POST(self):
        url_parts = urllib.parse.urlparse(self.path)
        path = url_parts.path
        content_len = int(self.headers.get("Content-Length", 0))
        post_data = self.rfile.read(content_len) if content_len > 0 else b"{}"

        try:
            body = json.loads(post_data.decode("utf-8")) if post_data else {}
        except Exception:
            body = {}

        if path == "/api/connect":
            self.handle_connect(body)
        elif path == "/api/disconnect":
            self.handle_disconnect()
        elif path == "/api/start":
            self.handle_start_sensor(body)
        elif path == "/api/stop":
            self.handle_stop_sensor()
        elif path == "/api/calibrate":
            self.handle_calibrate(body)
        elif path == "/api/sim":
            self.handle_sim_toggle(body)
        else:
            self.send_error(404, "Endpoint not found")

    def handle_sse_stream(self):
        """Streams real-time Server-Sent Events to browser client."""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

        client_queue = queue.Queue(maxsize=100)
        with sse_lock:
            sse_subscribers.append(client_queue)

        # Send initial status packet
        with state_lock:
            init_packet = {
                "type": "init",
                "connected": state["is_connected"],
                "port": state["port"],
                "sensor_active": state["is_sensor_active"],
                "simulation": state["simulation_mode"],
                "radius": state["blade_radius_m"],
                "angle": state["aspect_angle_deg"],
                "cal_scale": state.get("cal_scale", 2.10)
            }
        self.wfile.write(f"data: {json.dumps(init_packet)}\n\n".encode("utf-8"))
        self.wfile.flush()

        try:
            while not shutdown_flag.is_set():
                try:
                    data = client_queue.get(timeout=1.0)
                    self.wfile.write(data.encode("utf-8"))
                    self.wfile.flush()
                except queue.Empty:
                    # Keep-alive ping
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            with sse_lock:
                if client_queue in sse_subscribers:
                    sse_subscribers.remove(client_queue)

    def handle_connect(self, body):
        global serial_conn, serial_thread
        port = body.get("port")
        baud = int(body.get("baud", 115200))
        auto_start = body.get("auto_start", False)
        profile_name = body.get("profile", state.get("selected_profile", "profile_fan_rpm_highspeed.cfg"))

        if not port:
            self.send_json_response({"success": False, "error": "No serial port specified"}, status=400)
            return

        if not HAS_SERIAL:
            self.send_json_response({"success": False, "error": "pyserial module not available"}, status=500)
            return

        try:
            if serial_conn is not None and serial_conn.is_open:
                try:
                    serial_conn.close()
                except Exception:
                    pass

            serial_conn = serial.Serial(
                port=port,
                baudrate=baud,
                timeout=0.1,
                write_timeout=1.0,
                dsrdtr=False,
                rtscts=False
            )
            time.sleep(0.15)
            serial_conn.reset_input_buffer()
            serial_conn.reset_output_buffer()

            with state_lock:
                state["port"] = port
                state["baud"] = baud
                state["is_connected"] = True
                state["simulation_mode"] = False
                state["selected_profile"] = profile_name

            # Start reader thread if needed
            if serial_thread is None or not serial_thread.is_alive():
                serial_thread = threading.Thread(target=serial_reader_loop, daemon=True)
                serial_thread.start()

            broadcast_telemetry({
                "type": "status",
                "connected": True,
                "port": port,
                "sensor_active": False,
                "message": f"Connected to {port} @ {baud} baud"
            })

            if auto_start:
                cfg_path = find_profile_path(profile_name)
                if cfg_path:
                    threading.Thread(target=send_radar_config, args=(cfg_path,), daemon=True).start()

            self.send_json_response({"success": True, "port": port})
        except Exception as e:
            self.send_json_response({"success": False, "error": str(e)}, status=500)

    def handle_disconnect(self):
        global serial_conn
        try:
            if serial_conn is not None and serial_conn.is_open:
                with serial_io_lock:
                    try:
                        serial_conn.write(b"sensorStop\n")
                        time.sleep(0.05)
                    except Exception:
                        pass
                    serial_conn.close()
            serial_conn = None

            with state_lock:
                state["is_connected"] = False
                state["is_sensor_active"] = False

            broadcast_telemetry({
                "type": "status",
                "connected": False,
                "sensor_active": False,
                "message": "Disconnected from radar"
            })
            self.send_json_response({"success": True})
        except Exception as e:
            self.send_json_response({"success": False, "error": str(e)}, status=500)

    def handle_start_sensor(self, body):
        global serial_conn
        profile_name = body.get("profile", state.get("selected_profile", "profile_fan_rpm_highspeed.cfg"))

        cfg_path = find_profile_path(profile_name)
        if not cfg_path:
            self.send_json_response({"success": False, "error": f"Profile file '{profile_name}' not found"}, status=404)
            return

        with state_lock:
            state["selected_profile"] = profile_name

        if serial_conn is None or not serial_conn.is_open:
            with state_lock:
                if state["simulation_mode"]:
                    state["is_sensor_active"] = True
                    self.send_json_response({"success": True, "simulation": True})
                    return
            self.send_json_response({"success": False, "error": "Radar is not connected. Connect port first."}, status=400)
            return

        threading.Thread(target=send_radar_config, args=(cfg_path,), daemon=True).start()
        self.send_json_response({"success": True, "message": f"Uploading {profile_name}..."})

    def handle_stop_sensor(self):
        global serial_conn
        with state_lock:
            state["is_sensor_active"] = False
            state["sim_speed_target"] = 0.0

        if serial_conn is not None and serial_conn.is_open:
            with serial_io_lock:
                try:
                    serial_conn.write(b"sensorStop\n")
                    time.sleep(0.06)
                except Exception:
                    pass

        broadcast_telemetry({
            "type": "status",
            "connected": state["is_connected"],
            "sensor_active": False,
            "message": "Radar sensor stopped (sensorStop sent)"
        })
        self.send_json_response({"success": True})

    def handle_calibrate(self, body):
        with state_lock:
            if "radius" in body:
                state["blade_radius_m"] = float(body["radius"])
            if "angle" in body:
                state["aspect_angle_deg"] = float(body["angle"])
            if "cal_scale" in body:
                state["cal_scale"] = float(body["cal_scale"])

        broadcast_telemetry({
            "type": "calibrated",
            "radius": state["blade_radius_m"],
            "angle": state["aspect_angle_deg"],
            "cal_scale": state["cal_scale"]
        })
        self.send_json_response({
            "success": True,
            "radius": state["blade_radius_m"],
            "angle": state["aspect_angle_deg"],
            "cal_scale": state["cal_scale"]
        })

    def handle_sim_toggle(self, body):
        with state_lock:
            enable = body.get("enable", not state["simulation_mode"])
            state["simulation_mode"] = enable
            if "target_rpm" in body:
                state["sim_speed_target"] = float(body["target_rpm"])
            elif enable:
                state["sim_speed_target"] = 285.0
            else:
                state["sim_speed_target"] = 0.0

        broadcast_telemetry({
            "type": "sim_state",
            "simulation": state["simulation_mode"],
            "sim_target": state["sim_speed_target"]
        })
        self.send_json_response({
            "success": True,
            "simulation": state["simulation_mode"],
            "target": state["sim_speed_target"]
        })

    def send_json_response(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        # Suppress standard noisy HTTP request access logging
        pass

def main():
    import argparse
    parser = argparse.ArgumentParser(description="AWR1843 mmWave Radar Fan RPM Dashboard")
    parser.add_argument("--port", type=int, default=8055, help="HTTP server port (default: 8055)")
    parser.add_argument("--host", type=str, default="0.0.0.0", help="HTTP server host (default: 0.0.0.0)")
    parser.add_argument("--no-browser", action="store_true", help="Do not automatically open browser")
    parser.add_argument("--sim", action="store_true", help="Start directly in Demo Simulation mode")
    args = parser.parse_args()

    if args.sim:
        with state_lock:
            state["simulation_mode"] = True
            state["sim_speed_target"] = 285.0

    # Start simulation worker thread
    global sim_thread
    sim_thread = threading.Thread(target=simulation_worker_loop, daemon=True)
    sim_thread.start()

    server = ThreadingHTTPServer((args.host, args.port), RadarDashboardHandler)
    url = f"http://localhost:{args.port}"
    print("=" * 68)
    print("      TI AWR1843BOOST - RADAR TACHOMETER AVIONICS HUD")
    print("=" * 68)
    print(f" Dashboard URL:    \033[1;36m{url}\033[0m")
    print(f" Web Server Host:  {args.host}:{args.port}")
    print(f" Serial Port Tool: {'[Available]' if HAS_SERIAL else '[pyserial missing]'}")
    print(f" Simulation Mode:  {'[ACTIVE]' if args.sim else '[OFF - toggle in UI]'}")
    print("=" * 68)
    print(" Press Ctrl+C in terminal to stop server.")
    print("=" * 68)

    if not args.no_browser:
        def open_browser():
            time.sleep(0.6)
            try:
                import webbrowser
                webbrowser.open(url)
            except Exception:
                pass
        threading.Thread(target=open_browser, daemon=True).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[!] Shutting down dashboard server...")
        shutdown_flag.set()
        if serial_conn is not None and serial_conn.is_open:
            try:
                serial_conn.write(b"sensorStop\r\n")
                time.sleep(0.05)
                serial_conn.close()
            except Exception:
                pass
        server.server_close()
        print("[OK] Server stopped cleanly. Goodbye!")

if __name__ == "__main__":
    main()
