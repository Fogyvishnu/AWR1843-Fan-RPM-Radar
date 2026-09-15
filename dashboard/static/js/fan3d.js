/**
 * ==============================================================================
 * AWR1843BOOST Radar Tachometer - Interactive 3D Spinning Fan & Radar Visualizer
 * ==============================================================================
 * High-performance WebGL 3D Ceiling Fan & mmWave Radar Beam simulation using Three.js.
 * Renders ceiling fan hub, aerodynamic blades, dynamic motion blur trails,
 * virtual AWR1843BOOST radar sensor PCB, and animated mmWave radar beam frustum.
 *
 * Synchronized in real time to live radar measured RPM, radius, and aspect angle.
 * ==============================================================================
 */

class Fan3DViewer {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.error(`Fan3DViewer: Container #${containerId} not found`);
      return;
    }

    // Telemetry State
    this.rpm = 0.0;
    this.targetRpm = 0.0;
    this.isRunning = false;
    this.bladeRadius = 0.60;   // meters
    this.aspectAngleDeg = 30.0; // degrees
    this.targetDistMeters = 1.85;
    this.bladeCount = 3;

    // Simulation Physics
    this.currentAngle = 0.0;
    this.lastFrameTime = performance.now();
    this.strobeMode = false;
    this.wireframeMode = false;
    this.showBeam = true;

    // Camera Orbit State
    this.cameraDistance = 2.4;
    this.cameraYaw = Math.PI * 0.25;      // 45 deg
    this.cameraPitch = Math.PI * 0.18;    // ~32 deg
    this.isDragging = false;
    this.previousMousePosition = { x: 0, y: 0 };

    this.initThree();
    this.buildScene();
    this.setupInteractivity();
    this.animate();
  }

  initThree() {
    const width = this.container.clientWidth || 420;
    const height = this.container.clientHeight || 360;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x070b12, 0.15);

    // Camera
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    this.updateCameraPosition();

    // WebGL Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.container.appendChild(this.renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x334466, 1.2);
    this.scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0x00f0ff, 1.8);
    dirLight1.position.set(3, 4, 3);
    dirLight1.castShadow = true;
    dirLight1.shadow.mapSize.width = 1024;
    dirLight1.shadow.mapSize.height = 1024;
    this.scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0xff0077, 0.8);
    dirLight2.position.set(-3, -2, -2);
    this.scene.add(dirLight2);

    const pointLight = new THREE.PointLight(0x00ff88, 1.5, 4);
    pointLight.position.set(0, 0, 0);
    this.scene.add(pointLight);

    // Handle Window Resize
    window.addEventListener('resize', () => this.resize());
  }

  buildScene() {
    this.fanRoot = new THREE.Group();
    this.scene.add(this.fanRoot);

    // 1. Ceiling Canopy & Downrod
    const rodMat = new THREE.MeshStandardMaterial({
      color: 0x1f2937,
      metalness: 0.9,
      roughness: 0.2
    });

    const canopyGeo = new THREE.CylinderGeometry(0.12, 0.16, 0.08, 32);
    const canopy = new THREE.Mesh(canopyGeo, rodMat);
    canopy.position.y = 0.9;
    this.fanRoot.add(canopy);

    const rodGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.85, 24);
    const downrod = new THREE.Mesh(rodGeo, rodMat);
    downrod.position.y = 0.45;
    this.fanRoot.add(downrod);

    // 2. Rotating Rotor Hub Group
    this.rotorGroup = new THREE.Group();
    this.rotorGroup.position.y = 0.0;
    this.fanRoot.add(this.rotorGroup);

    // Hub Housing Body
    const hubMat = new THREE.MeshStandardMaterial({
      color: 0x111827,
      metalness: 0.85,
      roughness: 0.25
    });
    const hubGeo = new THREE.CylinderGeometry(0.18, 0.16, 0.14, 36);
    this.hubMesh = new THREE.Mesh(hubGeo, hubMat);
    this.hubMesh.castShadow = true;
    this.rotorGroup.add(this.hubMesh);

    // Glowing Cyberpunk Hub Accent Ring
    const ringGeo = new THREE.TorusGeometry(0.182, 0.012, 16, 48);
    ringGeo.rotateX(Math.PI / 2);
    this.hubRingMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      wireframe: false
    });
    this.hubRing = new THREE.Mesh(ringGeo, this.hubRingMat);
    this.rotorGroup.add(this.hubRing);

    // Center Dome / Finial
    const domeGeo = new THREE.SphereGeometry(0.12, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.5);
    const domeMat = new THREE.MeshStandardMaterial({
      color: 0x050b14,
      metalness: 0.9,
      roughness: 0.1
    });
    const dome = new THREE.Mesh(domeGeo, domeMat);
    dome.rotation.x = Math.PI;
    dome.position.y = -0.07;
    this.rotorGroup.add(dome);

    // 3. Dynamic Fan Blades
    this.bladesGroup = new THREE.Group();
    this.rotorGroup.add(this.bladesGroup);
    this.rebuildBlades();

    // 4. Motion Blur Disc (Transparent ghost trail at high RPM)
    const blurGeo = new THREE.RingGeometry(0.18, 0.65, 48, 1);
    blurGeo.rotateX(Math.PI / 2);
    this.blurMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide
    });
    this.blurDisc = new THREE.Mesh(blurGeo, this.blurMat);
    this.blurDisc.position.y = 0.01;
    this.rotorGroup.add(this.blurDisc);

    // 5. Virtual AWR1843BOOST Radar Sensor Unit
    this.buildRadarSensor();

    // 6. Cyberpunk Radar Floor Grid
    const gridHelper = new THREE.GridHelper(3.0, 16, 0x00f0ff, 0x152238);
    gridHelper.position.y = -1.2;
    this.scene.add(gridHelper);
  }

  buildRadarSensor() {
    this.radarGroup = new THREE.Group();
    this.scene.add(this.radarGroup);

    // Sensor PCB body
    const pcbGeo = new THREE.BoxGeometry(0.18, 0.22, 0.04);
    const pcbMat = new THREE.MeshStandardMaterial({
      color: 0x0a192f,
      metalness: 0.7,
      roughness: 0.3
    });
    this.pcbMesh = new THREE.Mesh(pcbGeo, pcbMat);
    this.radarGroup.add(this.pcbMesh);

    // Antenna array patch graphics on PCB face
    const patchMat = new THREE.MeshBasicMaterial({ color: 0xffb800 });
    for (let i = 0; i < 4; i++) {
      const patchGeo = new THREE.PlaneGeometry(0.018, 0.035);
      const patch = new THREE.Mesh(patchGeo, patchMat);
      patch.position.set(-0.045 + i * 0.03, 0.04, 0.021);
      this.radarGroup.add(patch);
    }

    // Power / Status LED on radar
    const ledGeo = new THREE.SphereGeometry(0.008, 12, 12);
    this.radarLedMat = new THREE.MeshBasicMaterial({ color: 0x00ff88 });
    const led = new THREE.Mesh(ledGeo, this.radarLedMat);
    led.position.set(0.06, -0.07, 0.021);
    this.radarGroup.add(led);

    // Radar Beam Frustum (Translucent Cone representing 77 GHz mmWave beam)
    const beamGeo = new THREE.ConeGeometry(0.75, 1.8, 24, 1, true);
    // Orient cone so vertex is at radar and base expands towards fan
    beamGeo.rotateX(-Math.PI / 2);
    beamGeo.translate(0, 0, 0.9);

    this.beamMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
      wireframe: false,
      depthWrite: false
    });
    this.beamCone = new THREE.Mesh(beamGeo, this.beamMat);
    this.radarGroup.add(this.beamCone);

    // Wireframe outline of beam
    const wireGeo = new THREE.ConeGeometry(0.75, 1.8, 12, 1, true);
    wireGeo.rotateX(-Math.PI / 2);
    wireGeo.translate(0, 0, 0.9);
    this.beamWireMat = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.35,
      wireframe: true
    });
    this.beamWire = new THREE.Mesh(wireGeo, this.beamWireMat);
    this.radarGroup.add(this.beamWire);

    // Radar Ping / Flash Marker at Blade Tip
    const pingGeo = new THREE.RingGeometry(0.02, 0.06, 24);
    pingGeo.rotateX(Math.PI / 2);
    this.pingMat = new THREE.MeshBasicMaterial({
      color: 0xff0055,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide
    });
    this.pingMesh = new THREE.Mesh(pingGeo, this.pingMat);
    this.fanRoot.add(this.pingMesh);

    this.updateRadarPosition();
  }

  updateRadarPosition() {
    if (!this.radarGroup) return;

    // Aspect angle theta in radians
    const theta = (this.aspectAngleDeg * Math.PI) / 180.0;
    const dist = Math.min(2.5, Math.max(1.0, this.targetDistMeters * 0.75));

    // Place radar below the fan at aspect angle theta
    const posX = dist * Math.sin(theta);
    const posY = -dist * Math.cos(theta);
    const posZ = 0.3; // Slight lateral offset for 3D depth

    this.radarGroup.position.set(posX, posY, posZ);

    // Aim radar directly at the center of the fan blades (0, 0, 0)
    this.radarGroup.lookAt(0, 0, 0);

    // Scale radar beam length to reach fan plane
    const beamScale = dist / 1.8;
    this.beamCone.scale.set(beamScale, beamScale, beamScale);
    this.beamWire.scale.set(beamScale, beamScale, beamScale);
  }

  rebuildBlades() {
    // Clear old blades
    while (this.bladesGroup.children.length > 0) {
      const child = this.bladesGroup.children[0];
      if (child.geometry) child.geometry.dispose();
      this.bladesGroup.remove(child);
    }

    const count = this.bladeCount;
    const rScale = this.bladeRadius / 0.60; // relative to 0.6m baseline
    const bladeLen = 0.62 * rScale;
    const rootWidth = 0.09;
    const tipWidth = 0.065;
    const innerRadius = 0.16;

    // Aerodynamic Blade Material
    const bladeMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.75,
      roughness: 0.35,
      wireframe: this.wireframeMode
    });

    const tipGlowMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      wireframe: this.wireframeMode
    });

    for (let i = 0; i < count; i++) {
      const angle = (i * 2.0 * Math.PI) / count;
      const bladePivot = new THREE.Group();
      bladePivot.rotation.y = angle;

      // Blade Arm Mount
      const armGeo = new THREE.CylinderGeometry(0.015, 0.018, innerRadius, 12);
      armGeo.rotateZ(Math.PI / 2);
      armGeo.translate(innerRadius * 0.5, 0, 0);
      const armMesh = new THREE.Mesh(armGeo, bladeMat);
      bladePivot.add(armMesh);

      // Create Aerodynamic Blade Surface using Extrude or Custom Shape
      const shape = new THREE.Shape();
      const x0 = innerRadius;
      const x1 = innerRadius + bladeLen;
      const w0 = rootWidth * 0.5;
      const w1 = tipWidth * 0.5;

      // Aerodynamic tapered airfoil planform
      shape.moveTo(x0, -w0);
      shape.lineTo(x1 * 0.92, -w1);
      shape.quadraticCurveTo(x1, 0, x1 * 0.92, w1);
      shape.lineTo(x0, w0);
      shape.closePath();

      const extrudeSettings = {
        depth: 0.012,
        bevelEnabled: true,
        bevelSegments: 2,
        steps: 1,
        bevelSize: 0.003,
        bevelThickness: 0.003
      };

      const bladeGeo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
      bladeGeo.rotateX(Math.PI / 2);

      // Aerodynamic Pitch Attack Angle (~12 degrees twist)
      bladeGeo.rotateZ(0.21);

      const bladeMesh = new THREE.Mesh(bladeGeo, bladeMat);
      bladeMesh.castShadow = true;
      bladePivot.add(bladeMesh);

      // Cyberpunk Reflective Tip Strip (Simulates radar reflective target marker)
      const tipGeo = new THREE.BoxGeometry(0.04, 0.014, tipWidth);
      tipGeo.rotateZ(0.21);
      const tipMesh = new THREE.Mesh(tipGeo, tipGlowMat);
      tipMesh.position.set(innerRadius + bladeLen - 0.02, 0, 0);
      bladePivot.add(tipMesh);

      this.bladesGroup.add(bladePivot);
    }

    // Update motion blur ring radius
    if (this.blurDisc) {
      this.blurDisc.geometry.dispose();
      const blurGeo = new THREE.RingGeometry(0.18, innerRadius + bladeLen, 48, 1);
      blurGeo.rotateX(Math.PI / 2);
      this.blurDisc.geometry = blurGeo;
    }
  }

  setupInteractivity() {
    const dom = this.renderer.domElement;

    // Mouse Controls
    dom.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.previousMousePosition = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      const deltaX = e.clientX - this.previousMousePosition.x;
      const deltaY = e.clientY - this.previousMousePosition.y;

      this.cameraYaw -= deltaX * 0.008;
      this.cameraPitch += deltaY * 0.008;

      // Clamp pitch to avoid gimbal flipping
      this.cameraPitch = Math.max(-Math.PI * 0.45, Math.min(Math.PI * 0.45, this.cameraPitch));

      this.updateCameraPosition();
      this.previousMousePosition = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    // Touch Controls
    dom.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        this.isDragging = true;
        this.previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (!this.isDragging || e.touches.length !== 1) return;
      const deltaX = e.touches[0].clientX - this.previousMousePosition.x;
      const deltaY = e.touches[0].clientY - this.previousMousePosition.y;

      this.cameraYaw -= deltaX * 0.01;
      this.cameraPitch += deltaY * 0.01;
      this.cameraPitch = Math.max(-Math.PI * 0.45, Math.min(Math.PI * 0.45, this.cameraPitch));

      this.updateCameraPosition();
      this.previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }, { passive: true });

    window.addEventListener('touchend', () => {
      this.isDragging = false;
    });

    // Zoom on Wheel
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cameraDistance += e.deltaY * 0.002;
      this.cameraDistance = Math.max(1.2, Math.min(5.0, this.cameraDistance));
      this.updateCameraPosition();
    }, { passive: false });
  }

  updateCameraPosition() {
    const x = this.cameraDistance * Math.cos(this.cameraPitch) * Math.sin(this.cameraYaw);
    const y = this.cameraDistance * Math.sin(this.cameraPitch);
    const z = this.cameraDistance * Math.cos(this.cameraPitch) * Math.cos(this.cameraYaw);

    this.camera.position.set(x, y, z);
    this.camera.lookAt(0, 0.05, 0);
  }

  setRpm(rpm, isRunning = true) {
    this.targetRpm = Math.max(0.0, rpm);
    this.isRunning = isRunning && this.targetRpm > 5.0;
  }

  setBladeRadius(radiusMeters) {
    if (Math.abs(this.bladeRadius - radiusMeters) > 0.01) {
      this.bladeRadius = Math.max(0.1, radiusMeters);
      this.rebuildBlades();
    }
  }

  setAspectAngle(angleDeg) {
    if (Math.abs(this.aspectAngleDeg - angleDeg) > 0.5) {
      this.aspectAngleDeg = angleDeg;
      this.updateRadarPosition();
    }
  }

  setTargetDistance(distMeters) {
    if (Math.abs(this.targetDistMeters - distMeters) > 0.05) {
      this.targetDistMeters = distMeters;
      this.updateRadarPosition();
    }
  }

  setBladeCount(count) {
    const newCount = Math.max(2, Math.min(6, count));
    if (this.bladeCount !== newCount) {
      this.bladeCount = newCount;
      this.rebuildBlades();
    }
  }

  toggleWireframe() {
    this.wireframeMode = !this.wireframeMode;
    this.rebuildBlades();
    return this.wireframeMode;
  }

  toggleBeam() {
    this.showBeam = !this.showBeam;
    if (this.beamCone) this.beamCone.visible = this.showBeam;
    if (this.beamWire) this.beamWire.visible = this.showBeam;
    return this.showBeam;
  }

  toggleStrobe() {
    this.strobeMode = !this.strobeMode;
    return this.strobeMode;
  }

  resetCamera() {
    this.cameraDistance = 2.4;
    this.cameraYaw = Math.PI * 0.25;
    this.cameraPitch = Math.PI * 0.18;
    this.updateCameraPosition();
  }

  setPresetView(viewName) {
    if (viewName === 'isometric') {
      this.cameraDistance = 2.4;
      this.cameraYaw = Math.PI * 0.25;
      this.cameraPitch = Math.PI * 0.18;
    } else if (viewName === 'top') {
      this.cameraDistance = 2.2;
      this.cameraYaw = 0;
      this.cameraPitch = Math.PI * 0.44;
    } else if (viewName === 'radar') {
      // Look from radar's eye towards the fan
      const theta = (this.aspectAngleDeg * Math.PI) / 180.0;
      this.cameraDistance = 2.6;
      this.cameraYaw = Math.PI + Math.sin(theta);
      this.cameraPitch = -0.3;
    }
    this.updateCameraPosition();
  }

  resize() {
    if (!this.container || !this.renderer || !this.camera) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrameTime) / 1000.0);
    this.lastFrameTime = now;

    // Smooth RPM inertia
    const inertia = this.isRunning ? 0.15 : 0.08;
    this.rpm += (this.targetRpm - this.rpm) * inertia;
    if (this.rpm < 1.0) this.rpm = 0.0;

    // Angular velocity: Omega = 2 * pi * (RPM / 60) rad/sec
    const omega = 2.0 * Math.PI * (this.rpm / 60.0);

    if (this.strobeMode && this.rpm > 10.0) {
      // Strobe optical effect: freeze or slowly drift blades
      const bpf = (this.bladeCount * this.rpm) / 60.0;
      this.currentAngle += Math.sin(now * 0.002) * 0.02;
    } else {
      this.currentAngle += omega * dt;
    }

    // Rotate the fan rotor
    if (this.rotorGroup) {
      this.rotorGroup.rotation.y = this.currentAngle;
    }

    // Motion Blur Trail Opacity based on RPM
    if (this.blurMat) {
      const targetOpacity = Math.min(0.7, (this.rpm / 350.0) * 0.6);
      this.blurMat.opacity += (targetOpacity - this.blurMat.opacity) * 0.1;
      this.blurDisc.visible = this.blurMat.opacity > 0.05;
    }

    // Hub LED glow pulse
    if (this.hubRingMat) {
      const pulse = 0.6 + Math.sin(now * 0.008) * 0.4;
      const glowColor = this.isRunning ? 0x00f0ff : 0xffb800;
      this.hubRingMat.color.setHex(glowColor);
    }

    // Animated mmWave Pulses travelling along radar beam
    if (this.beamMat && this.showBeam) {
      const pulseSpeed = 4.0;
      const beamIntensity = this.isRunning ? (0.12 + Math.sin(now * 0.006 * pulseSpeed) * 0.06) : 0.05;
      this.beamMat.opacity = beamIntensity;
    }

    // Blade passage radar ping effect
    // Triggers flash when a blade crosses radar line of sight
    if (this.pingMesh && this.isRunning && this.rpm > 20.0) {
      const bladeSlice = (2.0 * Math.PI) / this.bladeCount;
      const phase = (this.currentAngle % bladeSlice);
      if (phase < 0.2) {
        const pingAlpha = 1.0 - (phase / 0.2);
        this.pingMat.opacity = pingAlpha * 0.8;
        const pingX = this.bladeRadius * 0.9;
        this.pingMesh.position.set(pingX, 0, 0);
      } else {
        this.pingMat.opacity = Math.max(0.0, this.pingMat.opacity - dt * 4.0);
      }
    }

    this.renderer.render(this.scene, this.camera);
  }
}
