const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { URL } = require("url");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "public");
const TICK_MS = 1000 / 60;
const ARENA = 24;
const WALL = 1.2;
const PLAYER_SPEED = 7;
const BULLET_SPEED = 11;
const BULLET_LIFE_MS = 4000;
const FIRE_COOLDOWN_MS = 300;
const PLAYER_HP = 100;
const BULLET_DAMAGE = 25;
const TARGET_HALF = 1.15;
const PLAYER_HIT_R = 0.85;
const HIT_SUBSTEP = 0.22;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
};

const players = new Map();
const inputs = new Map();
const sseByPlayer = new Map();
const wsByPlayer = new Map();
let bullets = [];

let targets = [
  { id: "t1", x: 6, z: 0, hp: 100, maxHp: 100, hitUntil: 0 },
  { id: "t2", x: -6, z: 0, hp: 100, maxHp: 100, hitUntil: 0 },
  { id: "t3", x: 0, z: 6, hp: 100, maxHp: 100, hitUntil: 0 },
  { id: "t4", x: 0, z: -6, hp: 100, maxHp: 100, hitUntil: 0 },
];

function randomSpawn() {
  const m = ARENA / 2 - 2;
  return {
    x: (Math.random() * 2 - 1) * m,
    z: (Math.random() * 2 - 1) * m,
    yaw: 0,
  };
}

function respawn(pl) {
  const s = randomSpawn();
  pl.x = s.x;
  pl.z = s.z;
  pl.hp = PLAYER_HP;
}

function arenaLimit() {
  return ARENA / 2 - WALL;
}

function isBlocked(x, z) {
  const lim = arenaLimit();
  return x < -lim || x > lim || z < -lim || z > lim;
}

/** Отрезок пересекает AABB мишени (XZ) */
function segmentHitsBox(ax, az, bx, bz, cx, cz, hw, hd) {
  const minX = cx - hw;
  const maxX = cx + hw;
  const minZ = cz - hd;
  const maxZ = cz + hd;
  const len = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(4, Math.ceil(len / HIT_SUBSTEP));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = ax + (bx - ax) * t;
    const pz = az + (bz - az) * t;
    if (px >= minX && px <= maxX && pz >= minZ && pz <= maxZ) return true;
  }
  return false;
}

/** Отрезок ближе radius к точке игрока */
function segmentHitsCircle(ax, az, bx, bz, px, pz, radius) {
  const len = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(4, Math.ceil(len / HIT_SUBSTEP));
  const r2 = radius * radius;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    const d2 = (x - px) ** 2 + (z - pz) ** 2;
    if (d2 <= r2) return true;
  }
  return false;
}

function shoot(playerId, yaw) {
  const pl = players.get(playerId);
  if (!pl || pl.hp <= 0) return null;
  const now = Date.now();
  if (now - pl.lastShot < FIRE_COOLDOWN_MS) return null;
  pl.lastShot = now;
  pl.yaw = yaw;

  const dx = Math.sin(yaw);
  const dz = Math.cos(yaw);
  const x0 = pl.x + dx * 1.0;
  const z0 = pl.z + dz * 1.0;
  return {
    id: `b_${crypto.randomBytes(4).toString("hex")}`,
    ownerId: playerId,
    x: x0,
    z: z0,
    px: x0,
    pz: z0,
    vx: dx * BULLET_SPEED,
    vz: dz * BULLET_SPEED,
    born: now,
  };
}

function hitTarget(t, ownerId, now) {
  t.hp = Math.max(0, t.hp - BULLET_DAMAGE);
  t.hitUntil = now + 400;
  const killer = players.get(ownerId);
  let destroyed = false;
  if (killer) killer.kills = (killer.kills || 0) + 1;
  if (t.hp <= 0) {
    t.hp = t.maxHp;
    destroyed = true;
  }
  return destroyed;
}

function checkHits(b, ax, az, bx, bz, now) {
  for (const t of targets) {
    if (segmentHitsBox(ax, az, bx, bz, t.x, t.z, TARGET_HALF, TARGET_HALF)) {
      const kill = hitTarget(t, b.ownerId, now);
      broadcastHit({
        kind: "target",
        targetId: t.id,
        ownerId: b.ownerId,
        hp: t.hp,
        kill,
        kills: players.get(b.ownerId)?.kills ?? 0,
      });
      return true;
    }
  }

  for (const pl of players.values()) {
    if (pl.id === b.ownerId || pl.hp <= 0) continue;
    if (segmentHitsCircle(ax, az, bx, bz, pl.x, pl.z, PLAYER_HIT_R)) {
      pl.hp = Math.max(0, pl.hp - BULLET_DAMAGE);
      const killer = players.get(b.ownerId);
      if (killer) killer.kills = (killer.kills || 0) + 1;
      let kill = false;
      if (pl.hp <= 0) {
        pl.hp = 0;
        kill = true;
        const id = pl.id;
        setTimeout(() => {
          const p = players.get(id);
          if (p) respawn(p);
        }, 1200);
      }
      broadcastHit({
        kind: "player",
        victimId: pl.id,
        ownerId: b.ownerId,
        hp: pl.hp,
        kill,
        kills: players.get(b.ownerId)?.kills ?? 0,
      });
      return true;
    }
  }
  return false;
}

function broadcastHit(info) {
  const line = `event: hit\ndata: ${JSON.stringify(info)}\n\n`;
  for (const res of sseByPlayer.values()) {
    try {
      res.write(line);
    } catch {
      /* */
    }
  }
  for (const sock of wsByPlayer.values()) {
    wsSend(sock, { t: "hit", data: info });
  }
}

function handleWsMessage(playerId, text) {
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    return;
  }
  if (msg.t === "input") {
    handlePlayerInput(playerId, msg.keys, msg.yaw);
    return;
  }
  if (msg.t === "shoot") {
    if (!players.has(playerId)) return;
    const bullet = shoot(playerId, Number(msg.yaw) || 0);
    if (bullet) {
      bullets.push(bullet);
      broadcastShot(bullet);
    }
    broadcast();
  }
}

function applyPlayerMove(pl, inp, dt) {
  let mx = 0;
  let mz = 0;
  if (inp.w) mz += 1;
  if (inp.s) mz -= 1;
  if (inp.a) mx -= 1;
  if (inp.d) mx += 1;
  const len = Math.hypot(mx, mz) || 1;
  mx /= len;
  mz /= len;

  const sin = Math.sin(pl.yaw);
  const cos = Math.cos(pl.yaw);
  const nx = pl.x + (mx * cos + mz * sin) * PLAYER_SPEED * dt;
  const nz = pl.z + (-mx * sin + mz * cos) * PLAYER_SPEED * dt;
  if (!isBlocked(nx, pl.z)) pl.x = nx;
  if (!isBlocked(pl.x, nz)) pl.z = nz;
}

function handlePlayerInput(playerId, keys, yaw) {
  if (!players.has(playerId)) return;
  const inp = {
    w: Boolean(keys?.w),
    a: Boolean(keys?.a),
    s: Boolean(keys?.s),
    d: Boolean(keys?.d),
    yaw: Number(yaw) || 0,
    at: Date.now(),
  };
  inputs.set(playerId, inp);
  const pl = players.get(playerId);
  if (!pl || pl.hp <= 0) return;
  pl.yaw = inp.yaw;
  applyPlayerMove(pl, inp, 1 / 60);
}

function gameTick() {
  const now = Date.now();
  const dt = TICK_MS / 1000;

  for (const pl of players.values()) {
    const inp = inputs.get(pl.id);
    if (!inp || now - inp.at > 2000 || pl.hp <= 0) continue;
    pl.yaw = inp.yaw;
    applyPlayerMove(pl, inp, dt);
  }

  const alive = [];
  for (const b of bullets) {
    if (now - b.born > BULLET_LIFE_MS) continue;

    const ax = b.x;
    const az = b.z;
    b.x += b.vx * dt;
    b.z += b.vz * dt;

    if (isBlocked(b.x, b.z)) continue;

    if (checkHits(b, ax, az, b.x, b.z, now)) continue;

    b.px = b.x;
    b.pz = b.z;
    alive.push(b);
  }
  bullets = alive;

  broadcast();
}

function publicState() {
  const now = Date.now();
  return {
    arena: ARENA,
    playerCount: players.size,
    players: [...players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      x: p.x,
      z: p.z,
      yaw: p.yaw,
      hp: p.hp,
    })),
    targets: targets.map((t) => ({
      id: t.id,
      x: t.x,
      z: t.z,
      hp: t.hp,
      maxHp: t.maxHp,
      hit: t.hitUntil > now,
    })),
    bullets: bullets.map((b) => ({
      id: b.id,
      x: b.x,
      z: b.z,
      vx: b.vx,
      vz: b.vz,
    })),
  };
}

function personalState(playerId) {
  const pl = players.get(playerId);
  return {
    playerId,
    name: pl?.name,
    hp: pl?.hp ?? 0,
    kills: pl?.kills ?? 0,
  };
}

function wsSend(socket, obj) {
  if (!socket || socket.destroyed) return;
  const payload = Buffer.from(JSON.stringify(obj), "utf8");
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = len;
  } else {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  }
  try {
    socket.write(Buffer.concat([header, payload]));
  } catch {
    /* */
  }
}

function wsParseFrame(buffer) {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f;
  if (opcode === 0x8) return { close: true, rest: buffer };
  const masked = (buffer[1] & 0x80) !== 0;
  let len = buffer[1] & 0x7f;
  let off = 2;
  if (len === 126) {
    if (buffer.length < 4) return null;
    len = buffer.readUInt16BE(2);
    off = 4;
  } else if (len === 127) return null;
  if (masked) off += 4;
  if (buffer.length < off + len) return null;
  let data = buffer.slice(off, off + len);
  if (masked) {
    const mask = buffer.slice(off - 4, off);
    for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
  }
  return { text: data.toString("utf8"), rest: buffer.slice(off + len) };
}

function removePlayer(playerId) {
  sseByPlayer.delete(playerId);
  const sock = wsByPlayer.get(playerId);
  if (sock && !sock.destroyed) sock.destroy();
  wsByPlayer.delete(playerId);
  players.delete(playerId);
  inputs.delete(playerId);
  bullets = bullets.filter((b) => b.ownerId !== playerId);
}

function broadcast() {
  const payload = publicState();
  const line = `event: state\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const [pid, res] of sseByPlayer) {
    try {
      res.write(line);
      res.write(`event: you\ndata: ${JSON.stringify(personalState(pid))}\n\n`);
    } catch {
      sseByPlayer.delete(pid);
    }
  }
  for (const [pid, sock] of wsByPlayer) {
    wsSend(sock, { t: "state", data: payload });
    wsSend(sock, { t: "you", data: personalState(pid) });
  }
}

function broadcastShot(bullet) {
  if (!bullet) return;
  const shot = {
    id: bullet.id,
    x: bullet.x,
    z: bullet.z,
    vx: bullet.vx,
    vz: bullet.vz,
  };
  const data = JSON.stringify(shot);
  for (const res of sseByPlayer.values()) {
    try {
      res.write(`event: shot\ndata: ${data}\n\n`);
    } catch {
      /* */
    }
  }
  for (const sock of wsByPlayer.values()) {
    wsSend(sock, { t: "shot", data: shot });
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1e5) reject(new Error("large"));
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(res, urlPath) {
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "");
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC, safe);
  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/api/events") {
    const playerId = url.searchParams.get("playerId");
    if (!playerId || !players.has(playerId)) {
      res.writeHead(400);
      res.end("bad player");
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(": ok\n\n");
    sseByPlayer.set(playerId, res);
    res.write(`event: state\ndata: ${JSON.stringify(publicState())}\n\n`);
    res.write(`event: you\ndata: ${JSON.stringify(personalState(playerId))}\n\n`);
    req.on("close", () => {
      if (!wsByPlayer.has(playerId)) {
        removePlayer(playerId);
        broadcast();
      } else {
        sseByPlayer.delete(playerId);
      }
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/session") {
    const playerId = url.searchParams.get("playerId");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: Boolean(playerId && players.has(playerId)) }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/join") {
    const id = `p_${crypto.randomBytes(6).toString("hex")}`;
    const spawn = randomSpawn();
    players.set(id, {
      id,
      name: `Боец ${players.size + 1}`,
      x: spawn.x,
      z: spawn.z,
      yaw: 0,
      hp: PLAYER_HP,
      lastShot: 0,
      kills: 0,
    });
    broadcast();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ playerId: id, name: players.get(id).name }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/shoot") {
    const body = await readBody(req);
    if (!players.has(body.playerId)) {
      res.writeHead(404);
      res.end("{}");
      return;
    }
    const bullet = shoot(body.playerId, Number(body.yaw) || 0);
    if (bullet) {
      bullets.push(bullet);
      broadcastShot(bullet);
    }
    broadcast();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: Boolean(bullet),
        bulletId: bullet?.id ?? null,
        bullet: bullet
          ? { id: bullet.id, x: bullet.x, z: bullet.z, vx: bullet.vx, vz: bullet.vz }
          : null,
      })
    );
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    const pid = url.searchParams.get("playerId");
    const payload = publicState();
    if (pid && players.has(pid)) payload.you = personalState(pid);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/input") {
    const body = await readBody(req);
    if (!players.has(body.playerId)) {
      res.writeHead(404);
      res.end("{}");
      return;
    }
    handlePlayerInput(body.playerId, body.keys, body.yaw);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "GET") {
    serveStatic(res, url.pathname);
    return;
  }

  res.writeHead(404);
  res.end();
});

setInterval(gameTick, TICK_MS);
setInterval(() => {
  for (const res of sseByPlayer.values()) {
    try {
      res.write(": ping\n\n");
    } catch {
      /* */
    }
  }
}, 12000);

server.on("upgrade", (req, socket) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }
  const playerId = url.searchParams.get("playerId");
  if (!playerId || !players.has(playerId)) {
    socket.destroy();
    return;
  }
  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }
  const accept = crypto
    .createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );

  wsByPlayer.set(playerId, socket);
  socket._wsBuf = Buffer.alloc(0);
  wsSend(socket, { t: "state", data: publicState() });
  wsSend(socket, { t: "you", data: personalState(playerId) });

  socket.on("data", (chunk) => {
    socket._wsBuf = Buffer.concat([socket._wsBuf, chunk]);
    for (;;) {
      const frame = wsParseFrame(socket._wsBuf);
      if (!frame) break;
      socket._wsBuf = frame.rest;
      if (frame.close) {
        socket.destroy();
        return;
      }
      if (frame.text) handleWsMessage(playerId, frame.text);
    }
  });

  socket.on("close", () => {
    wsByPlayer.delete(playerId);
    if (!sseByPlayer.has(playerId)) {
      removePlayer(playerId);
      broadcast();
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Arena Shooter: http://localhost:${PORT}`);
  for (const ip of lanAddresses()) console.log(`  LAN: http://${ip}:${PORT}`);
  console.log(__dirname);
});

function lanAddresses() {
  const ips = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces || []) {
      if (iface.family === "IPv4" && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
}
