/**
 * Arena Shooter — Babylon.js v16
 */
(function () {
  const mount = document.getElementById("arena3d");
  if (!mount) return;

  if (typeof BABYLON === "undefined") {
    const o = document.getElementById("overlay");
    if (o) o.textContent = "Не загрузился Babylon.js. Проверьте интернет.";
    return;
  }

  const ui = {
    player: document.getElementById("playerInfo"),
    meta: document.getElementById("boardMeta"),
    overlay: document.getElementById("overlay"),
    hud: document.getElementById("hud"),
    crosshair: document.getElementById("crosshair"),
    hpFill: document.getElementById("hpFill"),
    hudText: document.getElementById("hudText"),
    loginScreen: document.getElementById("loginScreen"),
    nickInput: document.getElementById("nickInput"),
    teamBlue: document.getElementById("teamBlue"),
    teamRed: document.getElementById("teamRed"),
    joinBtn: document.getElementById("joinBtn"),
    loginError: document.getElementById("loginError"),
    deathScreen: document.getElementById("deathScreen"),
    deathMsg: document.getElementById("deathMsg"),
    respawnBtn: document.getElementById("respawnBtn"),
  };

  let playerId = sessionStorage.getItem("arenaShooterId");
  let state = { players: [], bullets: [], targets: [] };
  let myKills = 0;
  let myHp = 100;
  let es = null;
  let ws = null;
  let wsReady = false;
  let connected = false;

  const keys = { w: false, a: false, s: false, d: false };
  const KEY_CODES = { KeyW: "w", KeyA: "a", KeyS: "s", KeyD: "d" };
  const MOVE_SPEED = 7;
  const BULLET_SPEED = 11;
  const FIRE_MS = 300;
  const ARENA_LIM = 12 - 1.2 - 0.55;
  let serverX = 0;
  let serverZ = 0;
  let lastInputSent = "";
  let shooting = false;
  let lastShot = 0;
  let camX = 0;
  let camZ = 0;
  let camReady = false;
  let hitFlashUntil = 0;
  let pointerLocked = false;
  let selectedTeam = "blue";
  let myTeam = "blue";
  let myName = "";
  let isDead = false;
  let gameStarted = false;
  const TEAM_COLORS = {
    blue: new BABYLON.Color3(0.28, 0.5, 1),
    red: new BABYLON.Color3(1, 0.28, 0.32),
  };

  const canvas = document.createElement("canvas");
  canvas.tabIndex = 0;
  mount.innerHTML = "";
  mount.appendChild(canvas);

  const engine = new BABYLON.Engine(canvas, true, {
    adaptToDeviceRatio: true,
    preserveDrawingBuffer: true,
  });
  const scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.08, 0.12, 0.19, 1);

  const camera = new BABYLON.UniversalCamera("fpCam", new BABYLON.Vector3(0, 1.7, 0), scene);
  camera.minZ = 0.05;
  camera.inertia = 0;
  camera.speed = 0;
  camera.angularSensibility = 2200;
  camera.keysUp = [];
  camera.keysDown = [];
  camera.keysLeft = [];
  camera.keysRight = [];

  const hemi = new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0, 1, 0), scene);
  hemi.intensity = 0.95;
  const dir = new BABYLON.DirectionalLight("dir", new BABYLON.Vector3(-0.4, -1, -0.3), scene);
  dir.position = new BABYLON.Vector3(8, 18, 6);
  dir.intensity = 0.65;

  let glow = null;
  try {
    glow = new BABYLON.GlowLayer("glow", scene, { blurKernelSize: 48 });
    glow.intensity = 0.85;
  } catch {
    /* */
  }

  const ground = BABYLON.MeshBuilder.CreateGround("ground", { width: 24, height: 24 }, scene);
  const groundMat = new BABYLON.StandardMaterial("groundMat", scene);
  groundMat.diffuseColor = new BABYLON.Color3(0.23, 0.32, 0.44);
  ground.material = groundMat;

  for (let i = -11; i <= 11; i += 2) {
    const lineX = BABYLON.MeshBuilder.CreateBox(
      `gridX${i}`,
      { width: 24, height: 0.02, depth: 0.04 },
      scene
    );
    lineX.position.set(0, 0.03, i);
    const lineZ = BABYLON.MeshBuilder.CreateBox(
      `gridZ${i}`,
      { width: 0.04, height: 0.02, depth: 24 },
      scene
    );
    lineZ.position.set(i, 0.03, 0);
    const lmat = new BABYLON.StandardMaterial(`gridMat${i}`, scene);
    lmat.emissiveColor = new BABYLON.Color3(0.2, 0.28, 0.38);
    lmat.alpha = 0.35;
    lineX.material = lmat;
    lineZ.material = lmat;
  }

  const wallMat = new BABYLON.StandardMaterial("wallMat", scene);
  wallMat.diffuseColor = new BABYLON.Color3(0.14, 0.19, 0.25);
  const W = 12;
  [
    [24, 4, 0.5, 0, 2, -W],
    [24, 4, 0.5, 0, 2, W],
    [0.5, 4, 24, -W, 2, 0],
    [0.5, 4, 24, W, 2, 0],
  ].forEach(([xw, yh, zw, px, py, pz], i) => {
    const wall = BABYLON.MeshBuilder.CreateBox(`wall${i}`, { width: xw, height: yh, depth: zw }, scene);
    wall.position.set(px, py, pz);
    wall.material = wallMat;
  });

  const targetMeshes = new Map();
  const playerMeshes = new Map();
  const bulletMeshes = new Map();

  function glowMesh(mesh) {
    if (glow) glow.addIncludedOnlyMesh(mesh);
  }

  [
    { id: "t1", x: 6, z: 0 },
    { id: "t2", x: -6, z: 0 },
    { id: "t3", x: 0, z: 6 },
    { id: "t4", x: 0, z: -6 },
  ].forEach((t) => {
    const box = BABYLON.MeshBuilder.CreateBox(
      t.id,
      { width: 2.3, height: 2.8, depth: 2.3 },
      scene
    );
    box.position = new BABYLON.Vector3(t.x, 1.4, t.z);
    const mat = new BABYLON.StandardMaterial(`${t.id}Mat`, scene);
    mat.diffuseColor = new BABYLON.Color3(1, 0.4, 0.05);
    mat.emissiveColor = new BABYLON.Color3(0.25, 0.08, 0);
    box.material = mat;
    targetMeshes.set(t.id, box);
  });

  const gun = BABYLON.MeshBuilder.CreateBox(
    "gun",
    { width: 0.22, height: 0.16, depth: 0.6 },
    scene
  );
  gun.parent = camera;
  gun.position = new BABYLON.Vector3(0.32, -0.28, 0.85);
  const gunMat = new BABYLON.StandardMaterial("gunMat", scene);
  gunMat.diffuseColor = new BABYLON.Color3(0.1, 0.1, 0.1);
  gun.material = gunMat;

  function createBulletMesh(id) {
    const root = new BABYLON.TransformNode(`bulletRoot_${id}`, scene);
    const core = BABYLON.MeshBuilder.CreateSphere(
      `bullet_${id}`,
      { diameter: 0.85, segments: 14 },
      scene
    );
    core.parent = root;
    const mat = new BABYLON.StandardMaterial(`bulletMat_${id}`, scene);
    mat.emissiveColor = new BABYLON.Color3(1, 0.92, 0.15);
    mat.disableLighting = true;
    core.material = mat;
    glowMesh(core);

    const trail = BABYLON.MeshBuilder.CreateCylinder(
      `trail_${id}`,
      { height: 1.6, diameterTop: 0.12, diameterBottom: 0.45, tessellation: 8 },
      scene
    );
    trail.parent = root;
    trail.rotation.x = Math.PI / 2;
    trail.position.z = -0.85;
    const tmat = new BABYLON.StandardMaterial(`trailMat_${id}`, scene);
    tmat.emissiveColor = new BABYLON.Color3(1, 0.35, 0.05);
    tmat.disableLighting = true;
    trail.material = tmat;
    glowMesh(trail);

    return { root, core, vx: 0, vz: 0, born: 0, local: false };
  }

  function setBulletVel(rec, vx, vz) {
    rec.vx = vx;
    rec.vz = vz;
    const angle = Math.atan2(vx, vz);
    rec.root.rotation.y = angle;
  }

  function spawnBullet(id, x, z, vx, vz, opts) {
    let rec = bulletMeshes.get(id);
    if (!rec) {
      rec = createBulletMesh(id);
      bulletMeshes.set(id, rec);
    }
    rec.root.position.set(x, 1.65, z);
    setBulletVel(rec, vx, vz);
    if (opts?.local) {
      rec.local = true;
      rec.born = opts.born ?? performance.now();
    }
  }

  function spawnBeam(dx, dz) {
    const y = 1.65;
    const x0 = camX + dx * 0.6;
    const z0 = camZ + dz * 0.6;
    const len = 4;
    const beam = BABYLON.MeshBuilder.CreateCylinder(
      "beam",
      { height: len, diameterTop: 0.08, diameterBottom: 0.35, tessellation: 6 },
      scene
    );
    beam.position = new BABYLON.Vector3(x0 + (dx * len) / 2, y, z0 + (dz * len) / 2);
    beam.rotation.y = Math.atan2(dx, dz);
    beam.rotation.x = Math.PI / 2;
    const mat = new BABYLON.StandardMaterial("beamMat", scene);
    mat.emissiveColor = new BABYLON.Color3(0.3, 1, 1);
    mat.disableLighting = true;
    mat.alpha = 0.9;
    beam.material = mat;
    glowMesh(beam);
    setTimeout(() => beam.dispose(), 90);
  }

  function fireLocalShot() {
    const now = performance.now();
    const yaw = camera.rotation.y;
    const dx = Math.sin(yaw);
    const dz = Math.cos(yaw);
    const sx = camX + dx * 1.0;
    const sz = camZ + dz * 1.0;
    const id = `local_${now | 0}`;
    spawnBullet(id, sx, sz, dx * BULLET_SPEED, dz * BULLET_SPEED, { local: true, born: now });
    muzzleFlash();
    spawnBeam(dx, dz);
    return { id, yaw, dx, dz };
  }

  function removeNearestLocalBullet() {
    let best = null;
    let bestAge = Infinity;
    for (const [id, rec] of bulletMeshes) {
      if (!rec.local) continue;
      const age = performance.now() - (rec.born || 0);
      if (age < bestAge) {
        bestAge = age;
        best = id;
      }
    }
    if (best) removeBullet(best);
  }

  function tickLocalBullets(now) {
    for (const [id, rec] of [...bulletMeshes]) {
      if (!rec.local) continue;
      const age = now - (rec.born || 0);
      const x = rec.root.position.x;
      const z = rec.root.position.z;
      if (age > 4000 || Math.abs(x) > 11.5 || Math.abs(z) > 11.5) removeBullet(id);
    }
  }

  function removeBullet(id) {
    const rec = bulletMeshes.get(id);
    if (!rec) return;
    rec.root.dispose();
    bulletMeshes.delete(id);
  }

  function muzzleFlash() {
    const flash = BABYLON.MeshBuilder.CreateSphere(
      "flash",
      { diameter: 0.5, segments: 8 },
      scene
    );
    flash.parent = camera;
    flash.position = new BABYLON.Vector3(0.2, -0.05, 1.1);
    const mat = new BABYLON.StandardMaterial("flashMat", scene);
    mat.emissiveColor = new BABYLON.Color3(1, 1, 1);
    mat.disableLighting = true;
    flash.material = mat;
    glowMesh(flash);
    setTimeout(() => flash.dispose(), 80);
  }

  function setInfo(text, err) {
    if (!ui.player) return;
    ui.player.textContent = text;
    ui.player.style.color = err ? "#ff6666" : "#a8d4ff";
  }

  function updateHud() {
    if (ui.hpFill) ui.hpFill.style.width = Math.max(0, myHp) + "%";
    const teamLabel = myTeam === "red" ? "Красные" : "Синие";
    if (ui.hudText) {
      ui.hudText.textContent = `${myName} · ${teamLabel} · HP ${myHp} · убийств: ${myKills}`;
    }
  }

  function makeNameLabel(name, team) {
    const w = 256;
    const h = 64;
    const tex = new BABYLON.DynamicTexture(`nm_${name}_${team}`, { width: w, height: h }, scene, false);
    const ctx = tex.getContext();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, w, h);
    ctx.font = "bold 32px Segoe UI, Arial";
    ctx.fillStyle = team === "red" ? "#ff8888" : "#88bbff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(name.slice(0, 14), w / 2, h / 2);
    tex.update();
    const plane = BABYLON.MeshBuilder.CreatePlane(`lbl_${name}`, { width: 2.4, height: 0.6 }, scene);
    plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    const mat = new BABYLON.StandardMaterial(`lblm_${name}`, scene);
    mat.diffuseTexture = tex;
    mat.emissiveTexture = tex;
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mat.useAlphaFromDiffuseTexture = true;
    plane.material = mat;
    return { plane, tex, name, team };
  }

  function disposePlayerVisual(rec) {
    if (!rec) return;
    if (rec.label?.plane) rec.label.plane.dispose();
    if (rec.label?.tex) rec.label.tex.dispose();
    if (rec.body) rec.body.dispose();
  }

  function ensurePlayerVisual(p) {
    let rec = playerMeshes.get(p.id);
    const team = p.team === "red" ? "red" : "blue";
    const name = p.name || "Боец";
    const visible = !p.dead && (p.hp ?? 100) > 0;

    if (!rec) {
      const body = BABYLON.MeshBuilder.CreateCylinder(
        `pl_${p.id}`,
        { height: 1.6, diameter: 1.1, tessellation: 12 },
        scene
      );
      const pm = new BABYLON.StandardMaterial(`plMat_${p.id}`, scene);
      pm.diffuseColor = TEAM_COLORS[team];
      pm.emissiveColor = TEAM_COLORS[team].scale(0.35);
      body.material = pm;
      const label = makeNameLabel(name, team);
      label.plane.parent = body;
      label.plane.position.y = 1.35;
      rec = { body, label, name, team };
      playerMeshes.set(p.id, rec);
    }

    if (rec.name !== name || rec.team !== team) {
      rec.label.plane.dispose();
      rec.label.tex.dispose();
      rec.label = makeNameLabel(name, team);
      rec.label.plane.parent = rec.body;
      rec.label.plane.position.y = 1.35;
      rec.name = name;
      rec.team = team;
      rec.body.material.diffuseColor = TEAM_COLORS[team];
      rec.body.material.emissiveColor = TEAM_COLORS[team].scale(0.35);
    }

    rec.body.position.set(p.x, 0.8, p.z);
    rec.body.setEnabled(visible);
    rec.label.plane.setEnabled(visible);
    return rec;
  }

  function showDeathScreen(killerName) {
    isDead = true;
    if (document.pointerLockElement) document.exitPointerLock();
    if (ui.deathMsg) {
      ui.deathMsg.textContent = killerName
        ? `Вас убил: ${killerName}`
        : "Вы погибли в бою";
    }
    ui.deathScreen?.classList.remove("hidden");
    ui.crosshair?.classList.add("hidden");
    ui.hud?.classList.add("hidden");
    ui.overlay?.classList.add("hidden");
  }

  function hideDeathScreen() {
    isDead = false;
    ui.deathScreen?.classList.add("hidden");
    if (gameStarted) ui.overlay?.classList.remove("hidden");
  }

  async function requestRespawn() {
    if (!playerId) return;
    if (wsReady && ws.readyState === 1) {
      ws.send(JSON.stringify({ t: "respawn" }));
    } else {
      try {
        const res = await api("/api/respawn", { playerId });
        if (res.you) applyYou(res.you);
      } catch {
        /* */
      }
    }
    hideDeathScreen();
    camReady = false;
  }

  function initLogin() {
    const savedNick = sessionStorage.getItem("arenaNick");
    if (savedNick && ui.nickInput) ui.nickInput.value = savedNick;
    const savedTeam = sessionStorage.getItem("arenaTeam");
    if (savedTeam === "red" || savedTeam === "blue") selectTeam(savedTeam);

    ui.teamBlue?.addEventListener("click", () => selectTeam("blue"));
    ui.teamRed?.addEventListener("click", () => selectTeam("red"));
    ui.joinBtn?.addEventListener("click", () => enterGame());
    ui.nickInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") enterGame();
    });
    ui.respawnBtn?.addEventListener("click", () => requestRespawn());
  }

  function selectTeam(team) {
    selectedTeam = team === "red" ? "red" : "blue";
    ui.teamBlue?.classList.toggle("team-btn--active", selectedTeam === "blue");
    ui.teamRed?.classList.toggle("team-btn--active", selectedTeam === "red");
  }

  function setMeta() {
    if (ui.meta) {
      const link = wsReady ? "WS" : connected ? "SSE" : "…";
      ui.meta.textContent = `Связь: ${link} | пуль: ${bulletMeshes.size} | счёт: ${myKills}`;
    }
  }

  async function api(path, body) {
    const res = await fetch(path, {
      method: body !== undefined ? "POST" : "GET",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(path + " HTTP " + res.status);
    return text ? JSON.parse(text) : {};
  }

  function applyYou(you) {
    if (!you) return;
    myHp = you.hp ?? myHp;
    myKills = you.kills ?? myKills;
    if (you.name) myName = you.name;
    if (you.team) myTeam = you.team;
    const deadNow = Boolean(you.dead) || myHp <= 0;
    if (deadNow && !isDead) showDeathScreen(you.lastKiller);
    if (!deadNow && isDead) hideDeathScreen();
    isDead = deadNow;
    updateHud();
  }

  function applyState(s) {
    state = s;
    if (s.you) applyYou(s.you);

    const me = state.players.find((p) => p.id === playerId);
    if (me) {
      serverX = me.x;
      serverZ = me.z;
      if (!camReady) {
        camX = me.x;
        camZ = me.z;
        camReady = true;
      }
      myHp = me.hp ?? myHp;
    }

    const tmap = new Map((state.targets || []).map((t) => [t.id, t]));
    for (const [id, box] of targetMeshes) {
      const t = tmap.get(id) || { hp: 100, hit: false };
      const mat = box.material;
      if (t.hit || performance.now() < hitFlashUntil) {
        mat.diffuseColor = new BABYLON.Color3(1, 0.05, 0.05);
        mat.emissiveColor = new BABYLON.Color3(0.8, 0, 0);
      } else {
        mat.diffuseColor = new BABYLON.Color3(1, 0.4, 0.05);
        mat.emissiveColor = new BABYLON.Color3(0.25, 0.08, 0);
      }
    }

    const seenPlayers = new Set();
    for (const p of state.players) {
      if (p.id === playerId) continue;
      seenPlayers.add(p.id);
      ensurePlayerVisual(p);
    }
    for (const [id, rec] of playerMeshes) {
      if (!seenPlayers.has(id)) {
        disposePlayerVisual(rec);
        playerMeshes.delete(id);
      }
    }

    if (me) {
      const deadNow = Boolean(me.dead) || (me.hp ?? 100) <= 0;
      if (deadNow && !isDead) showDeathScreen(me.lastKiller || null);
      if (!deadNow && isDead) hideDeathScreen();
      isDead = deadNow;
    }

    const live = new Set();
    for (const b of state.bullets || []) {
      if (b.ownerId === playerId) continue;
      live.add(b.id);
      spawnBullet(b.id, b.x, b.z, b.vx, b.vz);
    }
    for (const id of [...bulletMeshes.keys()]) {
      if (id.startsWith("local_")) continue;
      if (!live.has(id)) removeBullet(id);
    }

    updateHud();
    setMeta();
  }

  async function pollState() {
    if (!playerId) return;
    try {
      applyState(await api(`/api/state?playerId=${encodeURIComponent(playerId)}`));
    } catch {
      /* */
    }
  }

  function connectWs() {
    if (ws) ws.close();
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${proto}//${location.host}/ws?playerId=${encodeURIComponent(playerId)}`);
    ws.onopen = () => {
      wsReady = true;
      connected = true;
      if (es) {
        es.close();
        es = null;
      }
      setInfo("Подключено (WebSocket). W — вперёд, S — назад.");
    };
    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.t === "state") applyState(msg.data);
      if (msg.t === "you") applyYou(msg.data);
      if (msg.t === "shot") {
        const b = msg.data;
        if (b.ownerId && b.ownerId === playerId) return;
        spawnBullet(b.id, b.x, b.z, b.vx, b.vz);
      }
      if (msg.t === "hit") {
        const h = msg.data;
        if (h.ownerId === playerId) {
          removeNearestLocalBullet();
          myKills = h.kills ?? myKills;
          hitFlashUntil = performance.now() + 400;
          setInfo(`Попадание! Счёт: ${myKills}`);
          updateHud();
        }
      }
      if (msg.t === "death") {
        const d = msg.data;
        if (d.victimId === playerId) showDeathScreen(d.killerName);
      }
      if (msg.t === "respawned") applyYou(msg.data);
    };
    ws.onclose = () => {
      wsReady = false;
      connected = false;
      if (!es) connectSSE();
    };
    ws.onerror = () => {
      wsReady = false;
    };
  }

  function connectSSE() {
    if (es || wsReady) return;
    es = new EventSource(`/api/events?playerId=${encodeURIComponent(playerId)}`);
    es.onopen = () => {
      connected = true;
      setInfo("Подключено (SSE). Жёлтые сферы — пули.");
    };
    es.addEventListener("state", (e) => applyState(JSON.parse(e.data)));
    es.addEventListener("you", (e) => applyYou(JSON.parse(e.data)));
    es.addEventListener("shot", (e) => {
      const b = JSON.parse(e.data);
      if (b.ownerId === playerId) return;
      spawnBullet(b.id, b.x, b.z, b.vx, b.vz);
    });
    es.addEventListener("hit", (e) => {
      const h = JSON.parse(e.data);
      if (h.ownerId === playerId) {
        removeNearestLocalBullet();
        myKills = h.kills ?? myKills;
        hitFlashUntil = performance.now() + 400;
        setInfo(`Попадание! Счёт: ${myKills}`);
        updateHud();
      }
    });
    es.addEventListener("death", (e) => {
      const d = JSON.parse(e.data);
      if (d.victimId === playerId) showDeathScreen(d.killerName);
    });
    es.onerror = () => {
      connected = false;
    };
  }

  function fire() {
    if (!playerId || isDead) return;
    const now = performance.now();
    if (now - lastShot < FIRE_MS) return;
    lastShot = now;

    const shot = fireLocalShot();
    const yawShot = shot.yaw;

    if (wsReady && ws.readyState === 1) {
      ws.send(
        JSON.stringify({ t: "shoot", yaw: yawShot, x: camX, z: camZ, clientId: shot.id })
      );
      return;
    }
    handlePlayerInputHttp(yawShot);
    fetch("/api/shoot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, yaw: yawShot, x: camX, z: camZ }),
    }).catch(() => {});
  }

  function sendInput(force) {
    if (!playerId || isDead) return;
    const yaw = camera.rotation.y;
    const payload = JSON.stringify({
      t: "input",
      keys: { ...keys },
      yaw,
      x: camX,
      z: camZ,
    });
    if (!force && payload === lastInputSent) return;
    lastInputSent = payload;

    if (wsReady && ws.readyState === 1) {
      ws.send(payload);
      return;
    }
    fetch("/api/input", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, keys, yaw, x: camX, z: camZ }),
    }).catch(() => {});
  }

  function handlePlayerInputHttp(yaw) {
    fetch("/api/input", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, keys, yaw, x: camX, z: camZ }),
    }).catch(() => {});
  }

  async function joinGame(nick, team) {
    sessionStorage.removeItem("arenaShooterId");
    const data = await api("/api/join", { name: nick, team });
    playerId = data.playerId;
    myName = data.name;
    myTeam = data.team || team;
    sessionStorage.setItem("arenaShooterId", playerId);
    sessionStorage.setItem("arenaNick", myName);
    sessionStorage.setItem("arenaTeam", myTeam);
    setInfo(`${myName} · ${data.teamName || myTeam} — клик по арене`);
    return data;
  }

  async function enterGame() {
    const nick = (ui.nickInput?.value || "").trim();
    if (!nick) {
      if (ui.loginError) ui.loginError.textContent = "Введите ник";
      return;
    }
    if (ui.loginError) ui.loginError.textContent = "";
    if (ui.joinBtn) ui.joinBtn.disabled = true;
    try {
      await joinGame(nick, selectedTeam);
      ui.loginScreen?.classList.add("hidden");
      gameStarted = true;
      ui.overlay?.classList.remove("hidden");
      connectWs();
      connectSSE();
      await pollState();
    } catch (e) {
      if (ui.loginError) ui.loginError.textContent = "Сервер недоступен";
      console.error(e);
    } finally {
      if (ui.joinBtn) ui.joinBtn.disabled = false;
    }
  }

  function setKeyFromCode(code, down) {
    const k = KEY_CODES[code];
    if (!k) return;
    if (keys[k] === down) return;
    keys[k] = down;
    if (down) {
      applyLocalMove(1 / 60);
      sendInput(true);
    } else {
      sendInput(true);
    }
  }

  function anyMoveKey() {
    return keys.w || keys.a || keys.s || keys.d;
  }

  function clampArena(x, z) {
    return {
      x: Math.max(-ARENA_LIM, Math.min(ARENA_LIM, x)),
      z: Math.max(-ARENA_LIM, Math.min(ARENA_LIM, z)),
    };
  }

  function applyLocalMove(dt) {
    if (isDead) return;
    let mx = 0;
    let mz = 0;
    if (keys.w) mz += 1;
    if (keys.s) mz -= 1;
    if (keys.a) mx -= 1;
    if (keys.d) mx += 1;
    if (mx === 0 && mz === 0) return;
    const len = Math.hypot(mx, mz) || 1;
    mx /= len;
    mz /= len;
    const yaw = camera.rotation.y;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    camX += (mx * cos + mz * sin) * MOVE_SPEED * dt;
    camZ += (-mx * sin + mz * cos) * MOVE_SPEED * dt;
    const c = clampArena(camX, camZ);
    camX = c.x;
    camZ = c.z;
  }

  function reconcileIdle(dt) {
    if (anyMoveKey()) return;
    const dx = serverX - camX;
    const dz = serverZ - camZ;
    const dist = Math.hypot(dx, dz);
    if (dist > 4) {
      camX = serverX;
      camZ = serverZ;
    } else if (dist > 0.2) {
      const k = Math.min(1, dt * 3);
      camX += dx * k;
      camZ += dz * k;
    }
  }

  function setPointerUi(locked) {
    pointerLocked = locked;
    ui.overlay?.classList.toggle("hidden", locked);
    ui.hud?.classList.toggle("hidden", !locked);
    ui.crosshair?.classList.toggle("hidden", !locked);
  }

  canvas.addEventListener("click", () => {
    if (isDead || !gameStarted) return;
    canvas.focus();
    canvas.requestPointerLock?.();
    if (!camera._attached) {
      camera.attachControl(canvas, true);
      camera._attached = true;
    }
  });

  document.addEventListener("pointerlockchange", () => {
    const locked = document.pointerLockElement === canvas;
    setPointerUi(locked);
    if (locked) canvas.focus();
  });

  scene.onKeyboardObservable.add((kb) => {
    const code = kb.event.code;
    if (kb.type === BABYLON.KeyboardEventTypes.KEYDOWN) {
      setKeyFromCode(code, true);
      if (code === "Space") {
        kb.event.preventDefault();
        shooting = true;
        fire();
      }
    } else if (kb.type === BABYLON.KeyboardEventTypes.KEYUP) {
      setKeyFromCode(code, false);
      if (code === "Space") shooting = false;
    }
  });

  window.addEventListener("keydown", (e) => {
    setKeyFromCode(e.code, true);
    if (e.code === "Space") {
      e.preventDefault();
      shooting = true;
      fire();
    }
  });
  window.addEventListener("keyup", (e) => {
    setKeyFromCode(e.code, false);
    if (e.code === "Space") shooting = false;
  });

  canvas.addEventListener("mousedown", (e) => {
    if (e.button === 0) {
      shooting = true;
      fire();
    }
  });
  document.addEventListener("mouseup", (e) => {
    if (e.button === 0) shooting = false;
  });

  setInterval(() => {
    if (shooting) fire();
  }, FIRE_MS);
  setInterval(() => {
    if (!wsReady) pollState();
  }, 400);

  let lastTime = performance.now();
  engine.runRenderLoop(() => {
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    applyLocalMove(dt);
    reconcileIdle(dt);
    sendInput(false);

    camera.position.x = camX;
    camera.position.y = 1.7;
    camera.position.z = camZ;

    for (const [, b] of bulletMeshes) {
      b.root.position.x += b.vx * dt;
      b.root.position.z += b.vz * dt;
    }
    tickLocalBullets(now);

    scene.render();
  });

  window.addEventListener("resize", () => engine.resize());

  function start() {
    engine.resize();
    initLogin();
    setInfo("Введите ник и выберите команду");
  }

  start();
})();
