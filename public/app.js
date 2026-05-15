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
  let shooting = false;
  let lastShot = 0;
  let camX = 0;
  let camZ = 0;
  let camReady = false;
  let hitFlashUntil = 0;
  let pointerLocked = false;

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

    return { root, core, vx: 0, vz: 0 };
  }

  function setBulletVel(rec, vx, vz) {
    rec.vx = vx;
    rec.vz = vz;
    const angle = Math.atan2(vx, vz);
    rec.root.rotation.y = angle;
  }

  function spawnBullet(id, x, z, vx, vz) {
    let rec = bulletMeshes.get(id);
    if (!rec) {
      rec = createBulletMesh(id);
      bulletMeshes.set(id, rec);
    }
    rec.root.position.set(x, 1.65, z);
    setBulletVel(rec, vx, vz);
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
    if (ui.hudText) ui.hudText.textContent = `HP ${myHp} | убийств: ${myKills}`;
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
    updateHud();
  }

  function applyState(s) {
    state = s;
    if (s.you) applyYou(s.you);

    const me = state.players.find((p) => p.id === playerId);
    if (me) {
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
      let m = playerMeshes.get(p.id);
      if (!m) {
        m = BABYLON.MeshBuilder.CreateCylinder(
          `pl_${p.id}`,
          { height: 1.6, diameter: 1.1, tessellation: 12 },
          scene
        );
        const pm = new BABYLON.StandardMaterial(`plMat_${p.id}`, scene);
        pm.diffuseColor = new BABYLON.Color3(0.9, 0.2, 0.2);
        m.material = pm;
        playerMeshes.set(p.id, m);
      }
      m.position.set(p.x, 0.8, p.z);
    }
    for (const [id, m] of playerMeshes) {
      if (!seenPlayers.has(id)) {
        m.dispose();
        playerMeshes.delete(id);
      }
    }

    const live = new Set();
    for (const b of state.bullets || []) {
      live.add(b.id);
      spawnBullet(b.id, b.x, b.z, b.vx, b.vz);
    }
    for (const id of [...bulletMeshes.keys()]) {
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
        spawnBullet(b.id, b.x, b.z, b.vx, b.vz);
      }
      if (msg.t === "hit") {
        const h = msg.data;
        if (h.ownerId === playerId) {
          myKills = h.kills ?? myKills;
          hitFlashUntil = performance.now() + 400;
          setInfo(`Попадание! Счёт: ${myKills}`);
          updateHud();
        }
      }
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
      spawnBullet(b.id, b.x, b.z, b.vx, b.vz);
    });
    es.addEventListener("hit", (e) => {
      const h = JSON.parse(e.data);
      if (h.ownerId === playerId) {
        myKills = h.kills ?? myKills;
        hitFlashUntil = performance.now() + 400;
        setInfo(`Попадание! Счёт: ${myKills}`);
        updateHud();
      }
    });
    es.onerror = () => {
      connected = false;
    };
  }

  async function fire() {
    if (!playerId) return;
    const now = performance.now();
    if (now - lastShot < 280) return;
    lastShot = now;

    const yaw = camera.rotation.y;
    const dx = Math.sin(yaw);
    const dz = Math.cos(yaw);
    const sx = camX + dx * 1.2;
    const sz = camZ + dz * 1.2;
    spawnBullet(`pred_${now}`, sx, sz, dx * 11, dz * 11);
    muzzleFlash();

    const yawShot = camera.rotation.y;
    if (wsReady && ws.readyState === 1) {
      ws.send(JSON.stringify({ t: "shoot", yaw: yawShot }));
      return;
    }
    try {
      handlePlayerInputHttp(yawShot);
      const res = await api("/api/shoot", { playerId, yaw: yawShot });
      if (res.bullet) {
        removeBullet(`pred_${now}`);
        spawnBullet(res.bullet.id, res.bullet.x, res.bullet.z, res.bullet.vx, res.bullet.vz);
      }
    } catch (e) {
      setInfo("Ошибка: " + e.message, true);
    }
  }

  function sendInput() {
    if (!playerId) return;
    const yaw = camera.rotation.y;
    if (wsReady && ws.readyState === 1) {
      ws.send(JSON.stringify({ t: "input", keys, yaw }));
      return;
    }
    fetch("/api/input", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, keys, yaw }),
    }).catch(() => {});
  }

  function handlePlayerInputHttp(yaw) {
    fetch("/api/input", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, keys, yaw }),
    }).catch(() => {});
  }

  async function joinGame() {
    if (playerId) {
      try {
        if ((await api(`/api/session?playerId=${encodeURIComponent(playerId)}`)).ok) return true;
      } catch {
        /* */
      }
    }
    sessionStorage.removeItem("arenaShooterId");
    const data = await api("/api/join", {});
    playerId = data.playerId;
    sessionStorage.setItem("arenaShooterId", playerId);
    setInfo(`${data.name} — клик по арене, ЛКМ / Пробел`);
    return true;
  }

  function setKeyFromCode(code, down) {
    const k = KEY_CODES[code];
    if (k) keys[k] = down;
  }

  function anyMoveKey() {
    return keys.w || keys.a || keys.s || keys.d;
  }

  function applyLocalMove(dt) {
    if (!anyMoveKey()) return;
    let mx = 0;
    let mz = 0;
    if (keys.w) mz += 1;
    if (keys.s) mz -= 1;
    if (keys.a) mx -= 1;
    if (keys.d) mx += 1;
    const len = Math.hypot(mx, mz) || 1;
    mx /= len;
    mz /= len;
    const yaw = camera.rotation.y;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    camX += (mx * cos + mz * sin) * MOVE_SPEED * dt;
    camZ += (-mx * sin + mz * cos) * MOVE_SPEED * dt;
  }

  function setPointerUi(locked) {
    pointerLocked = locked;
    ui.overlay?.classList.toggle("hidden", locked);
    ui.hud?.classList.toggle("hidden", !locked);
    ui.crosshair?.classList.toggle("hidden", !locked);
  }

  canvas.addEventListener("click", () => {
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
  }, 280);
  setInterval(() => {
    if (!wsReady) pollState();
  }, 400);

  let lastTime = performance.now();
  engine.runRenderLoop(() => {
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    applyLocalMove(dt);

    sendInput();

    const me = state.players.find((p) => p.id === playerId);
    if (me) {
      const blend = anyMoveKey() ? 0.12 : 0.35;
      camX += (me.x - camX) * blend;
      camZ += (me.z - camZ) * blend;
    }
    camera.position.x = camX;
    camera.position.y = 1.7;
    camera.position.z = camZ;

    for (const [, b] of bulletMeshes) {
      b.root.position.x += b.vx * dt;
      b.root.position.z += b.vz * dt;
    }

    scene.render();
  });

  window.addEventListener("resize", () => engine.resize());

  async function start() {
    engine.resize();
    try {
      await joinGame();
      connectWs();
      connectSSE();
      await pollState();
    } catch {
      setInfo("Запустите: cd E:\\crowd-chess && node server.js", true);
      setTimeout(start, 3000);
    }
  }

  start();
})();
