const TYPES = ["p", "n", "b", "r", "q", "k"];

const SYMBOLS = {
  w: { p: "♙", n: "♘", b: "♗", r: "♖", q: "♕", k: "♔" },
  b: { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚" },
};

const TYPE_NAMES = {
  p: "пешка",
  n: "конь",
  b: "слон",
  r: "ладья",
  q: "ферзь",
  k: "король",
};

function inBounds(x, y, w, h) {
  return x >= 0 && y >= 0 && x < w && y < h;
}

function pieceAt(pieces, x, y) {
  return pieces.find((p) => p.x === x && p.y === y) || null;
}

function isEnemy(piece, other) {
  return other && other.ownerId !== piece.ownerId;
}

function isAlly(piece, other) {
  return other && other.ownerId === piece.ownerId;
}

function addSlide(moves, piece, pieces, w, h, dx, dy) {
  let x = piece.x + dx;
  let y = piece.y + dy;
  while (inBounds(x, y, w, h)) {
    const occ = pieceAt(pieces, x, y);
    if (!occ) {
      moves.push({ x, y });
    } else {
      if (isEnemy(piece, occ)) moves.push({ x, y });
      break;
    }
    x += dx;
    y += dy;
  }
}

function getLegalMoves(piece, boardW, boardH, pieces) {
  const moves = [];
  const w = boardW;
  const h = boardH;
  const forward = piece.color === "w" ? -1 : 1;
  const startRank = piece.color === "w" ? h - 2 : 1;

  if (piece.type === "p") {
    const oneY = piece.y + forward;
    if (inBounds(piece.x, oneY, w, h) && !pieceAt(pieces, piece.x, oneY)) {
      moves.push({ x: piece.x, y: oneY });
      if (!piece.hasMoved && piece.y === startRank) {
        const twoY = piece.y + forward * 2;
        if (inBounds(piece.x, twoY, w, h) && !pieceAt(pieces, piece.x, twoY)) {
          moves.push({ x: piece.x, y: twoY });
        }
      }
    }
    for (const dx of [-1, 1]) {
      const cx = piece.x + dx;
      const cy = piece.y + forward;
      if (!inBounds(cx, cy, w, h)) continue;
      const target = pieceAt(pieces, cx, cy);
      if (isEnemy(piece, target)) moves.push({ x: cx, y: cy });
    }
    return moves;
  }

  if (piece.type === "n") {
    const jumps = [
      [1, 2],
      [2, 1],
      [2, -1],
      [1, -2],
      [-1, -2],
      [-2, -1],
      [-2, 1],
      [-1, 2],
    ];
    for (const [dx, dy] of jumps) {
      const x = piece.x + dx;
      const y = piece.y + dy;
      if (!inBounds(x, y, w, h)) continue;
      const occ = pieceAt(pieces, x, y);
      if (!occ || isEnemy(piece, occ)) moves.push({ x, y });
    }
    return moves;
  }

  if (piece.type === "b") {
    for (const [dx, dy] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      addSlide(moves, piece, pieces, w, h, dx, dy);
    }
    return moves;
  }

  if (piece.type === "r") {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      addSlide(moves, piece, pieces, w, h, dx, dy);
    }
    return moves;
  }

  if (piece.type === "q") {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      addSlide(moves, piece, pieces, w, h, dx, dy);
    }
    return moves;
  }

  if (piece.type === "k") {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      const x = piece.x + dx;
      const y = piece.y + dy;
      if (!inBounds(x, y, w, h)) continue;
      const occ = pieceAt(pieces, x, y);
      if (!occ || isEnemy(piece, occ)) moves.push({ x, y });
    }
  }

  return moves;
}

function canMove(piece, toX, toY, boardW, boardH, pieces) {
  return getLegalMoves(piece, boardW, boardH, pieces).some((m) => m.x === toX && m.y === toY);
}

function randomPieceType() {
  return TYPES[Math.floor(Math.random() * TYPES.length)];
}

function randomColor() {
  return Math.random() < 0.5 ? "w" : "b";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TYPES,
    SYMBOLS,
    TYPE_NAMES,
    getLegalMoves,
    canMove,
    randomPieceType,
    randomColor,
  };
}
