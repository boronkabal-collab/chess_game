const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { URL } = require("url");
const crypto = require("crypto");
const chess = require("./lib/chess-moves.js");

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
};

/** @type {Map<string, { id: string, name: string, pieceId: string | null }>} */
const players = new Map();
/** @type {Map<string, import('http').ServerResponse>} */
const sseByPlayer = new Map();

/** @type {Array<{ id: string, ownerId: string, x: number, y: number, type: string, color: string, symbol: string, hue: number, hasMoved: boolean }>} */
let pieces = [];
let boardW = 8;
let boardH = 8;

function boardSizeForPlayers(n) {
  const side = Math.max(8, Math.ceil(Math.sqrt(Math.max(1, n))) + 3);
  return { w: side, h: side };
}

function resizeBoard() {
  const { w, h } = boardSizeForPlayers(players.size);
  boardW = w;
  boardH = h;
}

function randomEmptyCell() {
  const occupied = new Set(pieces.map((p) => `${p.x},${p.y}`));
  for (let i = 0; i < 300; i++) {
    const x = Math.floor(Math.random() * boardW);
    const y = Math.floor(Math.random() * boardH);
    if (!occupied.has(`${x},${y}`)) return { x, y };
  }
  return { x: Math.floor(boardW / 2), y: Math.floor(boardH / 2) };
}

function createPieceForPlayer(playerId) {
  const pos = randomEmptyCell();
  const type = chess.randomPieceType();
  const color = chess.randomColor();
  const piece = {
    id: `piece_${playerId}`,
    ownerId: playerId,
    x: pos.x,
    y: pos.y,
    type,
    color,
    symbol: chess.SYMBOLS[color][type],
    hue: color === "w" ? 210 : 0,
    hasMoved: false,
  };
  pieces.push(piece);
  const pl = players.get(playerId);
  if (pl) pl.pieceId = piece.id;
  return piece;
}

function getPlayerPiece(playerId) {
  return pieces.find((p) => p.ownerId === playerId);
}

function applyMove(piece, toX, toY) {
  const target = pieces.find((p) => p.x === toX && p.y === toY && p.id !== piece.id);
  if (target) {
    pieces = pieces.filter((p) => p.id !== target.id);
    const victim = players.get(target.ownerId);
    if (victim) {
      victim.pieceId = null;
      createPieceForPlayer(target.ownerId);
    }
  }
  piece.x = toX;
  piece.y = toY;
  piece.hasMoved = true;

  if (piece.type === "p") {
    const promoRank = piece.color === "w" ? 0 : boardH - 1;
    if (piece.y === promoRank) {
      piece.type = "q";
      piece.symbol = chess.SYMBOLS[piece.color].q;
    }
  }
}

function publicState() {
  return {
    boardW,
    boardH,
    playerCount: players.size,
    pieces: pieces.map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      type: p.type,
      color: p.color,
      symbol: p.symbol,
      hue: p.hue,
      ownerId: p.ownerId,
      hasMoved: p.hasMoved,
    })),
  };
}

function personalState(playerId) {
  const pl = players.get(playerId);
  const piece = getPlayerPiece(playerId);
  let legalMoves = [];
  if (piece) {
    legalMoves = chess.getLegalMoves(piece, boardW, boardH, pieces);
  }
  return {
    playerId,
    name: pl?.name,
    pieceId: piece?.id ?? null,
    piece: piece
      ? {
          id: piece.id,
          x: piece.x,
          y: piece.y,
          type: piece.type,
          color: piece.color,
          symbol: piece.symbol,
          typeName: chess.TYPE_NAMES[piece.type],
        }
      : null,
    legalMoves,
  };
}

function broadcast() {
  const stateLine = `event: state\ndata: ${JSON.stringify(publicState())}\n\n`;
  for (const [pid, res] of sseByPlayer) {
    try {
      res.write(stateLine);
      res.write(`event: you\ndata: ${JSON.stringify(personalState(pid))}\n\n`);
    } catch {
      sseByPlayer.delete(pid);
    }
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
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}

function removePlayer(playerId) {
  players.delete(playerId);
  pieces = pieces.filter((p) => p.ownerId !== playerId);
  resizeBoard();
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
      sseByPlayer.delete(playerId);
      removePlayer(playerId);
      broadcast();
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/session") {
    const playerId = url.searchParams.get("playerId");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: Boolean(playerId && players.has(playerId)) }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/legal-moves") {
    const playerId = url.searchParams.get("playerId");
    const piece = getPlayerPiece(playerId);
    const moves = piece ? chess.getLegalMoves(piece, boardW, boardH, pieces) : [];
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ moves }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/join") {
    const id = `p_${crypto.randomBytes(6).toString("hex")}`;
    const name = `Игрок ${players.size + 1}`;
    players.set(id, { id, name, pieceId: null });
    resizeBoard();
    const piece = createPieceForPlayer(id);
    broadcast();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        playerId: id,
        name,
        piece: {
          symbol: piece.symbol,
          typeName: chess.TYPE_NAMES[piece.type],
          x: piece.x,
          y: piece.y,
        },
      })
    );
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/move") {
    const body = await readBody(req);
    const { playerId, toX, toY } = body;
    const piece = getPlayerPiece(playerId);
    if (!piece) {
      res.writeHead(400);
      res.end(JSON.stringify({ ok: false, error: "no_piece" }));
      return;
    }
    const tx = Number(toX);
    const ty = Number(toY);
    if (!chess.canMove(piece, tx, ty, boardW, boardH, pieces)) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "illegal" }));
      return;
    }
    applyMove(piece, tx, ty);
    broadcast();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/reroll-piece") {
    const body = await readBody(req);
    const playerId = body.playerId;
    if (!players.has(playerId)) {
      res.writeHead(404);
      res.end("{}");
      return;
    }
    pieces = pieces.filter((p) => p.ownerId !== playerId);
    resizeBoard();
    createPieceForPlayer(playerId);
    broadcast();
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

resizeBoard();

function lanAddresses() {
  const ips = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces || []) {
      if (iface.family === "IPv4" && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Crowd Chess (этот ПК):  http://localhost:${PORT}`);
  for (const ip of lanAddresses()) {
    console.log(`Crowd Chess (в сети):    http://${ip}:${PORT}`);
  }
  console.log(`Папка: ${__dirname}`);
});
