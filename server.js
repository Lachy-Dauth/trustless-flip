const express = require('express');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json());

const games = new Map();
const subs = new Map();

function genId() {
  return crypto.randomBytes(6).toString('hex');
}

function broadcast(gid, data) {
  const set = subs.get(gid);
  if (!set) return;
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const s of set) s.write(msg);
}

// POST /create - Create a new game
app.post('/create', (req, res) => {
  try {
    const { n, m, hash, code } = req.body;
    if (!Number.isInteger(n) || !Number.isInteger(m) || n < 1 || n > m) {
      return res.status(400).json({ error: 'N and M must satisfy 1 ≤ N ≤ M' });
    }
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) {
      return res.status(400).json({ error: 'Invalid SHA-256 hash' });
    }
    if (typeof code !== 'string' || !/^\d+_\d{12}$/.test(code)) {
      return res.status(400).json({ error: 'Invalid code format (expected R_SSSSSSSSSSSS)' });
    }
    const gid = genId();
    games.set(gid, {
      n, m, hash, code,
      player2Numbers: null,
      status: 'waiting',
      createdAt: Date.now(),
    });
    subs.set(gid, new Set());
    res.json({ id: gid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /game/:id - Get game state (code is hidden until completed)
app.get('/game/:id', (req, res) => {
  const g = games.get(req.params.id);
  if (!g) return res.status(404).json({ error: 'Game not found' });
  const { code, ...pub } = g;
  if (g.status === 'completed') pub.code = g.code;
  res.json(pub);
});

// POST /submit/:id - Player 2 submits their numbers
app.post('/submit/:id', (req, res) => {
  const g = games.get(req.params.id);
  if (!g) return res.status(404).json({ error: 'Game not found' });
  if (g.status !== 'waiting') return res.status(400).json({ error: 'Game already resolved' });

  const { numbers } = req.body;
  if (!Array.isArray(numbers) || numbers.length !== Number(g.n)) {
    return res.status(400).json({ error: `Expected exactly ${g.n} numbers` });
  }

  const sorted = [...numbers].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    const v = sorted[i];
    if (!Number.isInteger(v) || v < 1 || v > g.m) {
      return res.status(400).json({ error: `Number ${v} out of range [1, ${g.m}]` });
    }
    if (i > 0 && v === sorted[i - 1]) {
      return res.status(400).json({ error: 'Duplicate numbers detected' });
    }
  }

  g.player2Numbers = numbers;
  g.status = 'completed';
  broadcast(req.params.id, { type: 'completed', ...g });
  res.json({ status: 'completed' });
});

// GET /events/:id - SSE stream
app.get('/events/:id', (req, res) => {
  const g = games.get(req.params.id);
  if (!g) return res.status(404).json({ error: 'Game not found' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const set = subs.get(req.params.id);
  set.add(res);

  // Send current state immediately
  const { code, ...pub } = g;
  if (g.status === 'completed') pub.code = g.code;
  res.write(`data: ${JSON.stringify({ type: 'state', ...pub })}\n\n`);

  req.on('close', () => set.delete(res));
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// SPA fallback - serve index.html for any unmatched routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = parseInt(process.env.PORT) || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Trustless Flip running on http://0.0.0.0:${PORT}`);
});
