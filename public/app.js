const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const playerInfoEl = document.getElementById("playerInfo");
const boardMetaEl = document.getElementById("boardMeta");
const rerollBtn = document.getElementById("rerollPiece");

let playerId = sessionStorage.getItem("crowdChessPlayerId");
let myPieceId;
let state = { boardW: 8, boardH: 8, pieces: [] };
let eventSource;
let dpr = 1;
let layout = { cell: 0, offX: 0, offY: 0 };

let dragging = false;
let dragFrom = null;
let legalMoves = [];
let hoverCell = null;
let ghost = null;

async function api(path, body) {
  const res = await fetch(path, {
    method: body !== undefined ? "POST" : "GET",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}

function setStatus(text, isError) {
  playerInfoEl.textContent = text;
  playerInfoEl.style.color = isError ? "#ff8a8a" : "";
}

function cellLabel(x, y) {
  const rank = (state.boardH || 8) - y;
  return `${String.fromCharCode(97 + x)}${rank}`;
}

function myPiece() {
  return (state.pieces || []).find((p) => p.id === myPieceId);
}

function updateLayout() {
  const w = state.boardW || 8;
  const h = state.boardH || 8;
  const cw = canvas.width;
  const ch = canvas.height;
  const cell = Math.min(cw / w, ch / h);
  layout = {
    cell,
    offX: (cw - cell * w) / 2,
    offY: (ch - cell * h) / 2,
    boardW: w,
    boardH: h,
  };
}

function cellCenter(x, y) {
  return {
    cx: layout.offX + (x + 0.5) * layout.cell,
    cy: layout.offY + (y + 0.5) * layout.cell,
  };
}

function pixelToCell(px, py) {
  const x = Math.floor((px - layout.offX) / layout.cell);
  const y = Math.floor((py - layout.offY) / layout.cell);
  if (x < 0 || y < 0 || x >= layout.boardW || y >= layout.boardH) return null;
  return { x, y };
}

function isLegal(x, y) {
  return legalMoves.some((m) => m.x === x && m.y === y);
}

function refreshLegalMoves() {
  const piece = myPiece();
  if (!piece) {
    legalMoves = [];
    return;
  }
  legalMoves = ChessMoves.getLegalMoves(piece, state.boardW, state.boardH, state.pieces);
}

async function ensureSession() {
  if (playerId) {
    try {
      const check = await api(`/api/session?playerId=${encodeURIComponent(playerId)}`);
      if (check.ok) return playerId;
    } catch {
      /* join */
    }
  }
  sessionStorage.removeItem("crowdChessPlayerId");
  const data = await api("/api/join", {});
  playerId = data.playerId;
  sessionStorage.setItem("crowdChessPlayerId", playerId);
  if (data.piece) {
    setStatus(`${data.name}: ${data.piece.typeName} ${data.piece.symbol} · ${cellLabel(data.piece.x, data.piece.y)}`);
  }
  return playerId;
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  draw();
}

function draw() {
  const w = state.boardW || 8;
  const h = state.boardH || 8;
  const cw = canvas.width;
  const ch = canvas.height;
  if (!cw || !ch) return;

  updateLayout();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cw, ch);

  const { cell, offX, offY } = layout;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const light = (x + y) % 2 === 0;
      let fill = light ? "#c9b896" : "#7a5c42";
      if (dragging && isLegal(x, y)) fill = light ? "#9ccc7a" : "#5a8f48";
      if (hoverCell && hoverCell.x === x && hoverCell.y === y && dragging) {
        fill = isLegal(x, y) ? "#7ec8ff" : "#c96a6a";
      }
      ctx.fillStyle = fill;
      ctx.fillRect(offX + x * cell, offY + y * cell, cell + 0.5, cell + 0.5);
    }
  }

  for (const p of state.pieces || []) {
    if (dragging && p.id === myPieceId) continue;
    drawPiece(p);
  }

  if (ghost) drawPiece(ghost, true);
}

function drawPiece(p, isGhost) {
  const { cx, cy } = cellCenter(p.x, p.y);
  const r = layout.cell * 0.38;
  const mine = p.id === myPieceId;

  ctx.globalAlpha = isGhost ? 0.75 : 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = mine ? `hsl(${p.hue} 75% 58%)` : `hsl(${p.hue || 0} 50% 40%)`;
  ctx.fill();
  ctx.strokeStyle = mine ? "#fff" : "rgba(255,255,255,0.35)";
  ctx.lineWidth = (mine ? 3 : 1.5) * dpr;
  ctx.stroke();
  ctx.fillStyle = p.color === "w" ? "#fff" : "#f0f0f0";
  ctx.font = `${Math.floor(layout.cell * 0.5)}px serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(p.symbol, cx, cy);
  ctx.globalAlpha = 1;
}

function renderMeta() {
  boardMetaEl.textContent = `Поле ${state.boardW}×${state.boardH} · игроков: ${state.playerCount ?? 0}`;
}

function connect() {
  if (eventSource) eventSource.close();
  eventSource = new EventSource(`/api/events?playerId=${encodeURIComponent(playerId)}`);

  eventSource.addEventListener("state", (ev) => {
    state = JSON.parse(ev.data);
    if (!dragging) refreshLegalMoves();
    renderMeta();
    draw();
  });

  eventSource.addEventListener("you", (ev) => {
    const you = JSON.parse(ev.data);
    myPieceId = you.pieceId;
    if (you.piece && !dragging) {
      setStatus(`${you.name}: ${you.piece.typeName} ${you.piece.symbol} · ${cellLabel(you.piece.x, you.piece.y)}`);
      legalMoves = you.legalMoves || [];
    }
  });

  eventSource.onerror = () => {
    eventSource.close();
    reconnect();
  };
}

async function reconnect() {
  setStatus("Переподключение…", true);
  sessionStorage.removeItem("crowdChessPlayerId");
  playerId = null;
  await new Promise((r) => setTimeout(r, 600));
  await boot();
}

async function boot() {
  try {
    await ensureSession();
    connect();
  } catch {
    setStatus("Запустите сервер: cd E:\\crowd-chess && node server.js", true);
    setTimeout(boot, 3000);
  }
}

function canvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    px: (e.clientX - rect.left) * scaleX,
    py: (e.clientY - rect.top) * scaleY,
  };
}

function pieceAtPixel(px, py) {
  for (const p of state.pieces || []) {
    const { cx, cy } = cellCenter(p.x, p.y);
    const r = layout.cell * 0.45;
    const dx = px - cx;
    const dy = py - cy;
    if (dx * dx + dy * dy <= r * r) return p;
  }
  return null;
}

canvas.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  const { px, py } = canvasPos(e);
  const hit = pieceAtPixel(px, py);
  if (!hit || hit.id !== myPieceId) return;

  dragging = true;
  dragFrom = { x: hit.x, y: hit.y };
  refreshLegalMoves();
  ghost = { ...hit };
  hoverCell = pixelToCell(px, py);
  canvas.style.cursor = "grabbing";
  draw();
});

canvas.addEventListener("mousemove", (e) => {
  const { px, py } = canvasPos(e);
  if (!dragging) {
    const hit = pieceAtPixel(px, py);
    canvas.style.cursor = hit && hit.id === myPieceId ? "grab" : "default";
    return;
  }
  hoverCell = pixelToCell(px, py);
  if (hoverCell) {
    ghost.x = hoverCell.x;
    ghost.y = hoverCell.y;
  }
  draw();
});

async function finishDrag(e) {
  if (!dragging) return;
  const { px, py } = canvasPos(e);
  const cell = pixelToCell(px, py);
  dragging = false;
  canvas.style.cursor = "default";
  ghost = null;
  hoverCell = null;

  if (cell && isLegal(cell.x, cell.y)) {
    try {
      const res = await api("/api/move", {
        playerId,
        toX: cell.x,
        toY: cell.y,
      });
      if (!res.ok) setStatus("Недопустимый ход", true);
    } catch {
      await reconnect();
    }
  }
  refreshLegalMoves();
  draw();
}

canvas.addEventListener("mouseup", finishDrag);
canvas.addEventListener("mouseleave", (e) => {
  if (dragging) finishDrag(e);
});

rerollBtn.addEventListener("click", async () => {
  if (!playerId) return;
  try {
    await api("/api/reroll-piece", { playerId });
  } catch {
    await reconnect();
  }
});

window.addEventListener("resize", resizeCanvas);
resizeCanvas();
boot();
