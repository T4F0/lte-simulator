/* =============================================
   LTE Network Attach Simulator — Application JS
   ============================================= */

// ---- Data Models ----

class UE {
  constructor() {
    this.imsi = '';
    this.imei = '';
    this.status = 'detached';       // detached | attaching | attached | error
    this.ip = null;
    this.location = null;
    this.connectedTower = null;
    this.coordinates = { x: 0, y: 0 };
  }

  randomize() {
    this.imsi = '208' + this._rand(2) + this._rand(10);
    this.imei = this._rand(15);
    this.status = 'detached';
    this.ip = null;
    this.location = null;
    this.connectedTower = null;
    return this;
  }

  _rand(len) {
    let s = '';
    for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 10);
    return s;
  }
}

class ENodeB {
  constructor(id, name, x, y) {
    this.id = id;
    this.name = name;
    this.location = { x, y };
    this.status = 'active';
    this.connectedDevices = 0;
  }
}

class MME {
  constructor() { this.sessions = []; }
}

class HSS {
  constructor() {
    this.subscribers = new Map();  // IMSI -> subscriber data
  }

  registerSubscriber(imsi) {
    this.subscribers.set(imsi, {
      imsi,
      authKey: 'K-' + Math.random().toString(36).substring(2, 10).toUpperCase(),
      allowed: true,
      profile: { apn: 'internet', qos: 9 }
    });
  }

  authenticate(imsi) {
    const sub = this.subscribers.get(imsi);
    if (!sub) return { success: false, reason: 'Unknown Subscriber' };
    if (!sub.allowed) return { success: false, reason: 'Subscriber Barred' };
    return {
      success: true,
      authVector: {
        rand: this._hexRand(32),
        autn: this._hexRand(32),
        xres: this._hexRand(16),
        kasme: this._hexRand(64)
      }
    };
  }

  _hexRand(len) {
    let s = '';
    const chars = '0123456789ABCDEF';
    for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * 16)];
    return s;
  }
}

class SGW {
  constructor() { this.bearers = []; }
}

class PGW {
  constructor() { this.ipPool = []; this.nextOctet = 10; }

  assignIP() {
    const ip = `10.${20 + Math.floor(Math.random() * 10)}.${Math.floor(Math.random() * 255)}.${1 + Math.floor(Math.random() * 254)}`;
    this.ipPool.push(ip);
    return ip;
  }
}


// ---- Simulator Engine ----

class LTESimulator {
  constructor() {
    this.ue = new UE();
    this.towers = [
      new ENodeB('tower-a', 'Tower A', 15, 50),
      new ENodeB('tower-b', 'Tower B', 50, 30),
      new ENodeB('tower-c', 'Tower C', 82, 60),
    ];
    this.mme = new MME();
    this.hss = new HSS();
    this.sgw = new SGW();
    this.pgw = new PGW();

    this.running = false;
    this.failureMode = null; // null | 'invalid_sim' | 'auth_fail' | 'tower_down'
    this.stepDelay = 1200;
    this.clockInterval = null;
    this.elapsed = 0;

    this._initDOM();
    this._initEvents();
    this._drawConnections();
    this._drawMapElements();
    this._startClock();

    // Auto-generate a device
    this.generateDevice();
  }

  // ---- DOM References ----
  _initDOM() {
    this.dom = {
      // Nodes
      nodes: {
        ue: document.getElementById('node-ue'),
        enodeb: document.getElementById('node-enodeb'),
        mme: document.getElementById('node-mme'),
        hss: document.getElementById('node-hss'),
        sgw: document.getElementById('node-sgw'),
        pgw: document.getElementById('node-pgw'),
      },
      // Info
      imsi: document.getElementById('infoIMSI'),
      imei: document.getElementById('infoIMEI'),
      status: document.getElementById('infoStatus'),
      ip: document.getElementById('infoIP'),
      tower: document.getElementById('infoTower'),
      coords: document.getElementById('infoCoords'),
      // Status bar
      statusDot: document.getElementById('statusDot'),
      statusText: document.getElementById('statusText'),
      statusIP: document.getElementById('statusIP'),
      statusLocation: document.getElementById('statusLocation'),
      statusLatency: document.getElementById('statusLatency'),
      // Tower indicator
      currentTower: document.getElementById('currentTower'),
      // Logs
      logsContainer: document.getElementById('logsContainer'),
      // Message arrow
      messageArrow: document.getElementById('messageArrow'),
      messageText: document.getElementById('messageText'),
      // Map
      deviceDot: document.getElementById('deviceDot'),
      mapSvg: document.getElementById('mapSvg'),
      // SVG
      topologySvg: document.getElementById('topologySvg'),
      // Clock
      simClock: document.getElementById('simClock'),
    };
  }

  // ---- Events ----
  _initEvents() {
    document.getElementById('btnAttach').addEventListener('click', () => this.startAttach());
    document.getElementById('btnReset').addEventListener('click', () => this.reset());
    document.getElementById('btnRandomDevice').addEventListener('click', () => this.generateDevice());
    document.getElementById('btnMove').addEventListener('click', () => this.moveDevice());
    document.getElementById('btnLogs').addEventListener('click', () => this._toggleLogs());
    document.getElementById('btnClearLogs').addEventListener('click', () => this._clearLogs());
    document.getElementById('btnInvalidSIM').addEventListener('click', () => this.startAttach('invalid_sim'));
    document.getElementById('btnAuthFail').addEventListener('click', () => this.startAttach('auth_fail'));
    document.getElementById('btnTowerDown').addEventListener('click', () => this.startAttach('tower_down'));

    window.addEventListener('resize', () => {
      this._drawConnections();
      this._drawMapElements();
    });
  }

  // ---- Clock ----
  _startClock() {
    this.clockInterval = setInterval(() => {
      this.elapsed++;
      const h = String(Math.floor(this.elapsed / 3600)).padStart(2, '0');
      const m = String(Math.floor((this.elapsed % 3600) / 60)).padStart(2, '0');
      const s = String(this.elapsed % 60).padStart(2, '0');
      this.dom.simClock.textContent = `${h}:${m}:${s}`;
    }, 1000);
  }

  // ---- Generate Device ----
  generateDevice() {
    if (this.running) return;
    this.ue.randomize();

    // Random position anywhere on the map
    this.ue.coordinates = {
      x: 10 + Math.random() * 80,
      y: 10 + Math.random() * 80
    };

    // Register in HSS
    this.hss.registerSubscriber(this.ue.imsi);

    this._updateDeviceInfo();
    this._updateStatus('ready', 'Ready — Device generated');
    this._positionDevice();
    this.log('info', `UE initialized — IMSI: ${this.ue.imsi}`);
    this.log('info', `IMEI: ${this.ue.imei}`);
  }

  // ---- Start Attach ----
  async startAttach(failureMode = null) {
    if (this.running) return;
    if (!this.ue.imsi) {
      this.log('warning', 'No device generated. Click Random Device first.');
      return;
    }

    this.running = true;
    this.failureMode = failureMode;
    this.ue.status = 'attaching';
    this._updateDeviceInfo();
    this._updateStatus('running', 'Attach procedure in progress...');
    this._setButtonStates(true);

    try {
      await this._step1_powerOn();

      if (this.failureMode === 'tower_down') {
        await this._stepFail_towerDown();
        return;
      }

      await this._step2_searchTower();
      await this._step3_attachRequest();
      await this._step4_forwardToMME();

      if (this.failureMode === 'invalid_sim') {
        await this._stepFail_invalidSIM();
        return;
      }

      await this._step5_authRequest();

      if (this.failureMode === 'auth_fail') {
        await this._stepFail_authFail();
        return;
      }

      await this._step6_authResponse();
      await this._step7_createSession();
      await this._step8_assignIP();
      await this._step9_attachComplete();
    } catch (e) {
      console.error(e);
    }

    this.running = false;
    this._setButtonStates(false);
  }

  // ---- Attach Steps ----

  async _step1_powerOn() {
    this._activateNode('ue');
    this.log('info', 'UE Power ON');
    await this._wait(this.stepDelay);
  }

  async _step2_searchTower() {
    this.log('info', 'Scanning for nearby cell towers...');
    await this._wait(800);

    // Find nearest tower
    let nearest = this.towers[0];
    let minDist = Infinity;
    for (const t of this.towers) {
      const dx = t.location.x - this.ue.coordinates.x;
      const dy = t.location.y - this.ue.coordinates.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < minDist) { minDist = d; nearest = t; }
    }

    this.ue.connectedTower = nearest;
    this.ue.location = nearest.name;
    this._activateNode('enodeb');
    this._activateConnection('ue', 'enodeb');
    this._showMessage('ue', 'enodeb', 'Cell Search');
    this._activateTower(nearest.id);

    this.log('success', `Found ${nearest.name} (signal: -${60 + Math.floor(Math.random() * 30)} dBm)`);
    this._updateDeviceInfo();
    await this._wait(this.stepDelay);
    this._hideMessage();
  }

  async _stepFail_towerDown() {
    this.log('info', 'Scanning for nearby cell towers...');
    await this._wait(800);

    // Sort towers by distance from device (nearest first)
    const sorted = [...this.towers].sort((a, b) => {
      const da = Math.hypot(a.location.x - this.ue.coordinates.x, a.location.y - this.ue.coordinates.y);
      const db = Math.hypot(b.location.x - this.ue.coordinates.x, b.location.y - this.ue.coordinates.y);
      return da - db;
    });

    // Try each tower one by one
    for (let i = 0; i < sorted.length; i++) {
      const t = sorted[i];
      const dist = Math.hypot(t.location.x - this.ue.coordinates.x, t.location.y - this.ue.coordinates.y).toFixed(1);
      const signal = -(90 + Math.floor(Math.random() * 30)); // very weak signal

      this.log('info', `Attempting connection to ${t.name} (distance: ${dist})...`);
      this._activateTower(t.id);
      this._activateNode('enodeb');
      this._showMessage('ue', 'enodeb', `Trying ${t.name}`);
      await this._wait(1000);

      // Mark tower as failed
      document.getElementById(t.id)?.classList.remove('active');
      this._activateNode('enodeb', 'error');
      this._activateConnection('ue', 'enodeb', 'error');
      this._hideMessage();
      this.log('error', `✗ ${t.name} unreachable — signal: ${signal} dBm (below threshold)`);
      await this._wait(800);

      // Reset enodeb color for next attempt (except last)
      if (i < sorted.length - 1) {
        this.dom.nodes.enodeb.classList.remove('error');
        this._clearConnections();
        this._drawConnections();
      }
    }

    this._hideMessage();
    this.log('error', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    this.log('error', '⚠ All cell towers unreachable!');
    this.log('error', `  Towers scanned: ${sorted.map(t => t.name).join(', ')}`);
    this.log('error', '  Cause: No suitable cell found (RRC failure)');
    this.log('error', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    this._activateNode('ue', 'error');
    this.ue.status = 'error';
    this._updateDeviceInfo();
    this._updateStatus('error', 'Attach Failed — All Towers Unreachable');
    this.running = false;
    this._setButtonStates(false);
  }

  async _step3_attachRequest() {
    this._showMessage('ue', 'enodeb', 'Attach Request');
    this.log('send', `UE → eNodeB : Attach Request (IMSI: ${this.ue.imsi})`);
    await this._wait(this.stepDelay);
    this._hideMessage();
  }

  async _step4_forwardToMME() {
    this._activateNode('mme');
    this._activateConnection('enodeb', 'mme');
    this._showMessage('enodeb', 'mme', 'Initial UE Message');
    this.log('send', 'eNodeB → MME : Initial UE Message (S1-AP)');
    await this._wait(this.stepDelay);
    this._hideMessage();
  }

  async _stepFail_invalidSIM() {
    this._activateNode('hss');
    this._activateConnection('mme', 'hss');
    this._showMessage('mme', 'hss', 'Auth Info Request');
    this.log('send', 'MME → HSS : Authentication Info Request');
    await this._wait(this.stepDelay);
    this._hideMessage();

    this._activateNode('hss', 'error');
    this._activateConnection('mme', 'hss', 'error');
    this._showMessage('hss', 'mme', 'Unknown Subscriber');
    this.log('error', 'HSS → MME : ⚠ Unknown Subscriber — IMSI not found');
    await this._wait(this.stepDelay);
    this._hideMessage();

    this._showMessage('mme', 'enodeb', 'Attach Reject');
    this.log('error', 'MME → eNodeB : Attach Reject');
    await this._wait(800);
    this._hideMessage();

    this._showMessage('enodeb', 'ue', 'Attach Reject');
    this.log('error', 'eNodeB → UE : Attach Reject (Cause: #2 IMSI unknown)');
    await this._wait(800);
    this._hideMessage();

    this.log('error', '✗ Attach REJECTED — Cause: Unknown Subscriber');
    this._activateNode('ue', 'error');
    this.ue.status = 'error';
    this._updateDeviceInfo();
    this._updateStatus('error', 'Attach Failed — Invalid SIM / Unknown Subscriber');
    this.running = false;
    this._setButtonStates(false);
  }

  async _step5_authRequest() {
    this._activateNode('hss');
    this._activateConnection('mme', 'hss');
    this._showMessage('mme', 'hss', 'Auth Info Request');
    this.log('send', 'MME → HSS : Authentication Info Request');
    await this._wait(this.stepDelay);
    this._hideMessage();

    const result = this.hss.authenticate(this.ue.imsi);
    this.log('receive', 'HSS → MME : Authentication Vector received');
    this.log('info', `Auth Key RAND: ${result.authVector.rand.substring(0, 16)}...`);
    this._showMessage('hss', 'mme', 'Auth Vector');
    await this._wait(this.stepDelay);
    this._hideMessage();
  }

  async _stepFail_authFail() {
    this._showMessage('mme', 'enodeb', 'Auth Request');
    this.log('send', 'MME → UE : Authentication Request (EPS-AKA)');
    await this._wait(this.stepDelay);
    this._hideMessage();

    this._showMessage('ue', 'mme', 'Auth Failure');
    this.log('error', 'UE → MME : ⚠ Authentication Failure (MAC mismatch)');
    await this._wait(this.stepDelay);
    this._hideMessage();

    this.log('error', '✗ Attach REJECTED — Cause: Authentication Failure');
    this._activateNode('ue', 'error');
    this._activateNode('mme', 'error');
    this.ue.status = 'error';
    this._updateDeviceInfo();
    this._updateStatus('error', 'Attach Failed — Authentication Failure');
    this.running = false;
    this._setButtonStates(false);
  }

  async _step6_authResponse() {
    this._showMessage('mme', 'ue', 'Auth Request');
    this.log('send', 'MME → UE : Authentication Request (EPS-AKA challenge)');
    await this._wait(this.stepDelay);
    this._hideMessage();

    this._showMessage('ue', 'mme', 'Auth Response');
    this.log('receive', 'UE → MME : Authentication Response (RES verified)');
    await this._wait(this.stepDelay);
    this._hideMessage();

    this.log('success', '✓ Authentication Successful');

    // NAS Security
    this._showMessage('mme', 'ue', 'Security Mode Cmd');
    this.log('send', 'MME → UE : NAS Security Mode Command');
    await this._wait(800);
    this._hideMessage();

    this._showMessage('ue', 'mme', 'Security Complete');
    this.log('receive', 'UE → MME : NAS Security Mode Complete');
    await this._wait(800);
    this._hideMessage();

    this.log('success', '✓ NAS Security Established (EEA2 + EIA2)');
  }

  async _step7_createSession() {
    this._activateNode('sgw');
    this._activateConnection('mme', 'sgw');
    this._showMessage('mme', 'sgw', 'Create Session');
    this.log('send', 'MME → SGW : Create Session Request');
    await this._wait(this.stepDelay);
    this._hideMessage();

    this._activateNode('pgw');
    this._activateConnection('sgw', 'pgw');
    this._showMessage('sgw', 'pgw', 'Create Session');
    this.log('send', 'SGW → PGW : Create Session Request (GTP-C)');
    await this._wait(this.stepDelay);
    this._hideMessage();
  }

  async _step8_assignIP() {
    const ip = this.pgw.assignIP();
    this.ue.ip = ip;

    this._showMessage('pgw', 'sgw', `IP: ${ip}`);
    this.log('receive', `PGW → SGW : Create Session Response (IP: ${ip})`);
    await this._wait(this.stepDelay);
    this._hideMessage();

    this._showMessage('sgw', 'mme', 'Session Created');
    this.log('receive', 'SGW → MME : Create Session Response');
    await this._wait(800);
    this._hideMessage();

    this.log('success', `✓ IP Address Assigned: ${ip}`);
    this.log('info', 'Default Bearer (QCI=9) established');
  }

  async _step9_attachComplete() {
    // Initial Context Setup
    this._showMessage('mme', 'enodeb', 'Context Setup');
    this.log('send', 'MME → eNodeB : Initial Context Setup Request');
    await this._wait(800);
    this._hideMessage();

    this._showMessage('enodeb', 'mme', 'Context Response');
    this.log('receive', 'eNodeB → MME : Initial Context Setup Response');
    await this._wait(800);
    this._hideMessage();

    // Attach Accept
    this._showMessage('mme', 'ue', 'Attach Accept');
    this.log('send', 'MME → UE : Attach Accept');
    await this._wait(this.stepDelay);
    this._hideMessage();

    this._showMessage('ue', 'mme', 'Attach Complete');
    this.log('receive', 'UE → MME : Attach Complete');
    await this._wait(800);
    this._hideMessage();

    // Modify Bearer
    this.log('info', 'MME → SGW : Modify Bearer Request (location update)');
    await this._wait(600);

    // Success
    this.ue.status = 'attached';
    Object.values(this.dom.nodes).forEach(n => {
      n.classList.remove('active');
      n.classList.add('success');
    });
    this._successAllConnections();

    this.log('success', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    this.log('success', '✓ UE ATTACHED SUCCESSFULLY');
    this.log('success', `  IP Address : ${this.ue.ip}`);
    this.log('success', `  Cell Tower : ${this.ue.location}`);
    this.log('success', `  GUTI       : ${this._generateGUTI()}`);
    this.log('success', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const latency = 45 + Math.floor(Math.random() * 30);
    this._updateDeviceInfo();
    this._updateStatus('attached', 'UE Attached — Internet Access Active');
    this.dom.statusLatency.textContent = `Latency: ${latency}ms`;
    this.dom.statusIP.textContent = `IP: ${this.ue.ip}`;
    this.dom.statusLocation.textContent = `Location: ${this.ue.location}`;
  }

  _generateGUTI() {
    return `GUTI-${Math.random().toString(36).substring(2, 6).toUpperCase()}-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
  }

  // ---- Move Device (Handover) ----
  async moveDevice() {
    if (this.running) return;
    if (this.ue.status !== 'attached') {
      this.log('warning', 'Device must be attached before moving.');
      return;
    }

    this.running = true;
    this._setButtonStates(true);

    const currentTower = this.ue.connectedTower;
    const otherTowers = this.towers.filter(t => t.id !== currentTower.id);
    const newTower = otherTowers[Math.floor(Math.random() * otherTowers.length)];

    this.log('info', `UE moving from ${currentTower.name} to ${newTower.name}...`);

    // Animate device on map
    this.ue.coordinates = {
      x: newTower.location.x + (Math.random() - 0.5) * 8,
      y: newTower.location.y + (Math.random() - 0.5) * 8
    };
    this._positionDevice();
    await this._wait(1200);

    // Measurement Report
    this.log('send', `UE → eNodeB : Measurement Report (${newTower.name} stronger)`);
    this._showMessage('ue', 'enodeb', 'Measurement Report');
    await this._wait(this.stepDelay);
    this._hideMessage();

    // Handover Request
    this.log('send', `Source eNodeB → Target eNodeB : Handover Request`);
    await this._wait(800);

    // Handover Command
    this.log('send', `eNodeB → UE : Handover Command`);
    this._showMessage('enodeb', 'ue', 'HO Command');
    await this._wait(this.stepDelay);
    this._hideMessage();

    // Deactivate old tower, activate new
    this._deactivateTower(currentTower.id);
    this._activateTower(newTower.id);
    this.ue.connectedTower = newTower;
    this.ue.location = newTower.name;

    // Handover Complete
    this.log('receive', `UE → Target eNodeB : Handover Complete`);
    await this._wait(800);

    // Path Switch
    this.log('info', 'eNodeB → MME : Path Switch Request');
    await this._wait(600);
    this.log('info', 'MME → SGW : Modify Bearer (new downlink path)');
    await this._wait(600);

    this.log('success', `✓ Handover Complete: ${currentTower.name} → ${newTower.name}`);
    this.log('info', `New coordinates: (${this.ue.coordinates.x.toFixed(1)}, ${this.ue.coordinates.y.toFixed(1)})`);

    this._updateDeviceInfo();
    this._drawMapElements();
    this.dom.statusLocation.textContent = `Location: ${newTower.name}`;

    this.running = false;
    this._setButtonStates(false);
  }

  // ---- Reset ----
  reset() {
    if (this.running) return;
    this.ue = new UE();
    this.failureMode = null;

    // Clear node states
    Object.values(this.dom.nodes).forEach(n => {
      n.classList.remove('active', 'success', 'error');
    });

    // Clear connections
    this._clearConnections();

    // Clear tower highlights
    this.towers.forEach(t => {
      document.getElementById(t.id)?.classList.remove('active');
    });

    // Hide device dot
    this.dom.deviceDot.classList.remove('visible');

    // Reset UI
    this._updateDeviceInfo();
    this._updateStatus('', 'Ready — Generate a device to begin');
    this.dom.statusIP.textContent = 'IP: —';
    this.dom.statusLocation.textContent = 'Location: —';
    this.dom.statusLatency.textContent = 'Latency: —';
    this.dom.currentTower.textContent = 'No Connection';

    this._clearLogs();
    this.log('info', 'Simulator reset');
    this._hideMessage();
    this._drawMapElements();
  }

  // ---- UI Helpers ----

  _updateDeviceInfo() {
    this.dom.imsi.textContent = this.ue.imsi || '—';
    this.dom.imei.textContent = this.ue.imei || '—';
    this.dom.ip.textContent = this.ue.ip || '—';
    this.dom.tower.textContent = this.ue.location || '—';
    this.dom.coords.textContent = this.ue.imsi
      ? `(${this.ue.coordinates.x.toFixed(1)}, ${this.ue.coordinates.y.toFixed(1)})`
      : '—';

    const statusEl = this.dom.status;
    statusEl.textContent = this.ue.status.charAt(0).toUpperCase() + this.ue.status.slice(1);
    statusEl.className = 'info-value status-badge ' + this.ue.status;

    if (this.ue.connectedTower) {
      this.dom.currentTower.textContent = this.ue.connectedTower.name;
    }
  }

  _updateStatus(state, text) {
    this.dom.statusDot.className = 'status-dot ' + state;
    this.dom.statusText.textContent = text;
  }

  _setButtonStates(disabled) {
    ['btnAttach', 'btnMove', 'btnReset', 'btnRandomDevice', 'btnInvalidSIM', 'btnAuthFail', 'btnTowerDown']
      .forEach(id => document.getElementById(id).disabled = disabled);
  }

  // ---- Node Activation ----
  _activateNode(nodeKey, state = 'active') {
    const node = this.dom.nodes[nodeKey];
    node.classList.remove('active', 'success', 'error');
    node.classList.add(state);
  }

  // ---- Connection Lines ----

  _getNodeCenter(nodeKey) {
    const keyMap = { ue: 'node-ue', enodeb: 'node-enodeb', mme: 'node-mme', hss: 'node-hss', sgw: 'node-sgw', pgw: 'node-pgw' };
    const el = document.getElementById(keyMap[nodeKey]);
    const canvas = document.getElementById('topologyCanvas');
    if (!el || !canvas) return { x: 0, y: 0 };

    const elRect = el.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    return {
      x: elRect.left - canvasRect.left + elRect.width / 2,
      y: elRect.top - canvasRect.top + elRect.height / 2
    };
  }

  _connections = [
    ['ue', 'enodeb'],
    ['enodeb', 'mme'],
    ['mme', 'hss'],
    ['mme', 'sgw'],
    ['sgw', 'pgw'],
  ];

  _drawConnections() {
    const svg = this.dom.topologySvg;
    // Preserve active states
    const states = {};
    svg.querySelectorAll('.conn-line').forEach(l => {
      states[l.dataset.conn] = l.getAttribute('class');
    });

    svg.innerHTML = '';

    for (const [from, to] of this._connections) {
      const p1 = this._getNodeCenter(from);
      const p2 = this._getNodeCenter(to);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', p1.x);
      line.setAttribute('y1', p1.y);
      line.setAttribute('x2', p2.x);
      line.setAttribute('y2', p2.y);
      const key = `${from}-${to}`;
      line.dataset.conn = key;
      line.setAttribute('class', states[key] || 'conn-line');
      svg.appendChild(line);
    }
  }

  _activateConnection(from, to, state = 'active') {
    const key = `${from}-${to}`;
    const line = this.dom.topologySvg.querySelector(`[data-conn="${key}"]`);
    if (line) {
      line.classList.remove('active', 'success', 'error');
      line.classList.add('conn-line', state);
    }
  }

  _successAllConnections() {
    this.dom.topologySvg.querySelectorAll('.conn-line').forEach(l => {
      l.classList.remove('active', 'error');
      l.classList.add('success');
    });
  }

  _clearConnections() {
    this.dom.topologySvg.querySelectorAll('.conn-line').forEach(l => {
      l.classList.remove('active', 'success', 'error');
    });
  }

  // ---- Message Arrow ----
  _showMessage(fromKey, toKey, text) {
    const p1 = this._getNodeCenter(fromKey);
    const p2 = this._getNodeCenter(toKey);
    const mx = (p1.x + p2.x) / 2;
    const my = (p1.y + p2.y) / 2 - 30;

    this.dom.messageArrow.style.left = mx + 'px';
    this.dom.messageArrow.style.top = my + 'px';
    this.dom.messageArrow.style.transform = 'translate(-50%, -50%)';
    this.dom.messageText.textContent = text;
    this.dom.messageArrow.classList.add('visible');
  }

  _hideMessage() {
    this.dom.messageArrow.classList.remove('visible');
  }

  // ---- Tower Map ----
  _activateTower(towerId) {
    this.towers.forEach(t => document.getElementById(t.id)?.classList.remove('active'));
    document.getElementById(towerId)?.classList.add('active');
    this._drawMapElements();
  }

  _deactivateTower(towerId) {
    document.getElementById(towerId)?.classList.remove('active');
  }

  _positionDevice() {
    const dot = this.dom.deviceDot;
    dot.style.left = this.ue.coordinates.x + '%';
    dot.style.top = this.ue.coordinates.y + '%';
    dot.classList.add('visible');
  }

  _drawMapElements() {
    const svg = this.dom.mapSvg;
    svg.innerHTML = '';

    const canvas = document.getElementById('mapCanvas');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();

    // Draw coverage circles
    for (const t of this.towers) {
      const cx = (t.location.x / 100) * rect.width;
      const cy = (t.location.y / 100) * rect.height;
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', cx);
      circle.setAttribute('cy', cy);
      circle.setAttribute('r', 45);
      circle.setAttribute('class', `tower-range${this.ue.connectedTower?.id === t.id ? ' active' : ''}`);
      svg.appendChild(circle);
    }

    // Draw connection line to active tower
    if (this.ue.connectedTower && this.ue.status !== 'detached') {
      const tx = (this.ue.connectedTower.location.x / 100) * rect.width;
      const ty = (this.ue.connectedTower.location.y / 100) * rect.height;
      const dx = (this.ue.coordinates.x / 100) * rect.width;
      const dy = (this.ue.coordinates.y / 100) * rect.height;

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', tx);
      line.setAttribute('y1', ty);
      line.setAttribute('x2', dx);
      line.setAttribute('y2', dy);
      line.setAttribute('class', 'map-conn visible');
      svg.appendChild(line);
    }
  }

  // ---- Logging ----
  log(type, message) {
    const container = this.dom.logsContainer;

    // Remove placeholder
    const placeholder = container.querySelector('.log-placeholder');
    if (placeholder) placeholder.remove();

    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;

    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { hour12: false });

    entry.innerHTML = `<span class="log-time">[${time}]</span><span class="log-msg">${message}</span>`;
    container.appendChild(entry);
    container.scrollTop = container.scrollHeight;
  }

  _clearLogs() {
    this.dom.logsContainer.innerHTML = '<div class="log-placeholder">Logs cleared. Click <strong>Start Attach</strong> to begin simulation...</div>';
  }

  _toggleLogs() {
    const card = document.getElementById('logsCard');
    card.scrollIntoView({ behavior: 'smooth' });
  }

  // ---- Utility ----
  _wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}


// ---- Initialize ----
document.addEventListener('DOMContentLoaded', () => {
  window.sim = new LTESimulator();
});
