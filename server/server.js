// Serveur en ligne de Neon Vanguard : salons, parties rapides, carte tirée au hasard, score et chrono, relais des joueurs.
// Démarrage : node server.js  (port : variable PORT, 8080 par défaut)
'use strict';
const http = require('http');
const { WebSocketServer } = require('ws');

const PROTO = 1, PORT = +process.env.PORT || 8080;
const MAPS = ['volt', 'kaira', 'kael', 'thorgar', 'elyndra', 'zyrra', 'titan', 'grakk', 'nyx', 'city', 'cave', 'island'];
const HEROES = ['volt', 'kaira', 'kael', 'thorgar', 'elyndra', 'zyrra', 'titan', 'grakk', 'nyx', 'drakar', 'mirae', 'vorgath'];
const BOT_HEROES = HEROES.slice(0, 9);
const BOT_NAMES = ['Vex', 'Morgane', 'Tarek', 'Séraph', 'Ryuken', 'Aster', 'Lyra', 'Corso', 'Bastion', 'Sombra', 'Zarok', 'Ilyan', 'Noxa', 'Elyo', 'Sorya', 'Dario', 'Mika', 'Yuki', 'Rook', 'Fenris'];
const ROUND_MS = +process.env.ROUND_MS || 4 * 60 * 1000, INTRO_MS = 7500, QUICK_WAIT_MS = 25000, QUICK_FULL_MS = 4000;
const target = (mode, size) => mode === 'tdm' ? size * 5 : 10;
const now = () => Date.now();
const pick = a => a[Math.floor(Math.random() * a.length)];
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const clean = (s, n = 16) => String(s || '').replace(/[<>&"'`\\]/g, '').trim().slice(0, n) || 'Joueur';
const codeChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const clients = new Map(), rooms = new Map(); let nextId = 1;
const stats = { started: now(), matches: 0, peak: 0 };

function send(c, m) { if (c && c.ws.readyState === 1) c.ws.send(typeof m === 'string' ? m : JSON.stringify(m)); }
function cast(room, m, except) { const s = JSON.stringify(m); for (const p of room.players) if (p !== except) send(p, s); }
function newCode() { let c; do { c = ''; for (let i = 0; i < 4; i++) c += pick(codeChars); } while (rooms.has(c)); return c; }

function lobbyView(r) { return { code: r.priv ? r.code : null, priv: r.priv, mode: r.mode, size: r.size, host: r.host && r.host.id, state: r.state, startsIn: r.startAt && r.state === 'lobby' ? Math.max(0, r.startAt - now()) : null,
  players: r.players.map(p => ({ id: p.id, name: p.name, hero: p.hero, team: p.team })) }; }
function sendLobby(r) { cast(r, { t: 'lobby', room: lobbyView(r) }); }
function makeRoom(mode, size, priv) { const r = { code: newCode(), mode, size, priv, players: [], host: null, state: 'lobby', startAt: 0, timer: null }; rooms.set(r.code, r); return r; }
function maxPlayers(r) { return r.size * 2; }
function balanceTeam(r) { if (r.mode !== 'tdm') return -1; const a = r.players.filter(p => p.team === 0).length, b = r.players.filter(p => p.team === 1).length; return r.priv ? (a < r.size ? 0 : 1) : (a <= b ? 0 : 1); }
function joinRoom(c, r) { leaveRoom(c); c.room = r; c.team = balanceTeam(r); r.players.push(c); if (!r.host) r.host = c; sendLobby(r); if (!r.priv) scheduleQuick(r); }
function leaveRoom(c) { const r = c.room; if (!r) return; c.room = null; r.players = r.players.filter(p => p !== c);
  if (!r.players.length) { clearTimeout(r.timer); clearTimeout(r.endTimer); rooms.delete(r.code); return; }
  if (r.host === c) r.host = r.players[0];
  if (r.state === 'play') { const s = r.slots.find(x => x.human === c.id); if (s) { s.human = null; s.name = s.name + ' (bot)'; }
    if (r.botOwner === c.id) r.botOwner = r.players[0].id; cast(r, { t: 'slot', slot: s ? s.slot : -1, human: null, name: s ? s.name : '', botOwner: r.botOwner }); }
  else { sendLobby(r); if (!r.priv) scheduleQuick(r); } }
// partie rapide : lancement dès que c'est plein, sinon au bout de 25 s (les places vides sont prises par des bots)
function scheduleQuick(r) { if (r.state !== 'lobby') return; clearTimeout(r.timer); const full = r.players.length >= maxPlayers(r), wait = full ? QUICK_FULL_MS : QUICK_WAIT_MS;
  if (!r.firstJoin) r.firstJoin = now(); r.startAt = full ? now() + wait : r.firstJoin + wait; r.timer = setTimeout(() => startMatch(r), Math.max(0, r.startAt - now())); sendLobby(r); }
function startMatch(r) { if (r.state !== 'lobby' || !r.players.length) return; clearTimeout(r.timer); r.state = 'play'; stats.matches++;
  const n = maxPlayers(r), slots = [], names = shuffle(BOT_NAMES.slice()); let bi = 0;
  if (r.mode === 'tdm') { for (const team of [0, 1]) { const hs = r.players.filter(p => p.team === team); for (let k = 0; k < r.size; k++) { const h = hs[k];
      slots.push(h ? { slot: slots.length, team, human: h.id, name: h.name, hero: h.hero, look: h.look } : { slot: slots.length, team, human: null, name: names[bi++ % names.length], hero: pick(BOT_HEROES) }); } }
    for (const p of r.players) if (!slots.some(s => s.human === p.id)) { const s = slots.find(x => !x.human); if (s) Object.assign(s, { human: p.id, name: p.name, hero: p.hero, look: p.look, team: s.team }); } }
  else { const hs = r.players.slice(0, n); for (let k = 0; k < n; k++) { const h = hs[k]; slots.push(h ? { slot: k, team: -1, human: h.id, name: h.name, hero: h.hero, look: h.look } : { slot: k, team: -1, human: null, name: names[bi++ % names.length], hero: pick(BOT_HEROES) }); } }
  const map = pick(r.lastMap ? MAPS.filter(m => m !== r.lastMap) : MAPS); r.lastMap = map;
  Object.assign(r, { done: false, slots, map, score: [0, 0], kills: slots.map(() => 0), deaths: slots.map(() => 0), startAt: now() + INTRO_MS, botOwner: r.players[0].id, goal: target(r.mode, r.size) });
  r.endsAt = r.startAt + ROUND_MS; clearTimeout(r.endTimer); r.endTimer = setTimeout(() => endMatch(r, 'time'), r.endsAt - now());
  cast(r, { t: 'start', map, mode: r.mode, size: r.size, slots, botOwner: r.botOwner, startAt: r.startAt, endsAt: r.endsAt, goal: r.goal, now: now() }); }
function endMatch(r, why) { if (r.state !== 'play') return; r.state = 'end'; clearTimeout(r.endTimer);
  cast(r, { t: 'end', why, score: r.score, kills: r.kills, deaths: r.deaths, slots: r.slots.map(s => ({ slot: s.slot, name: s.name, human: s.human })) });
  setTimeout(() => { if (rooms.get(r.code) !== r) return; r.state = 'lobby'; r.startAt = 0; r.firstJoin = 0; for (const p of r.players) p.team = r.mode === 'tdm' ? p.team : -1; if (r.priv) sendLobby(r); }, 1500); }
function ownerOf(r, slot) { const s = r.slots && r.slots[slot]; if (!s) return null; const id = s.human || r.botOwner; return r.players.find(p => p.id === id) || null; }

function onMessage(c, raw) { if (raw.length > 8192) return; let m; try { m = JSON.parse(raw); } catch (e) { return; } const r = c.room;
  switch (m.t) {
    case 'hello': c.name = clean(m.name); c.hero = HEROES.includes(m.hero) ? m.hero : 'volt'; c.look = m.look && typeof m.look === 'object' ? m.look : null;
      if (m.proto !== PROTO) return send(c, { t: 'error', code: 'version', msg: 'Ton jeu n’est pas à jour : fais la mise à jour pour jouer en ligne.' });
      return send(c, { t: 'welcome', id: c.id, now: now(), online: clients.size });
    case 'ping': return send(c, { t: 'pong', c: m.c, s: now() });
    case 'hero': c.hero = HEROES.includes(m.hero) ? m.hero : c.hero; if (m.look && typeof m.look === 'object') c.look = m.look; if (r && r.state === 'lobby') sendLobby(r); return;
    case 'quick': { const mode = m.mode === 'dm' ? 'dm' : 'tdm', size = Math.max(2, Math.min(4, m.size | 0 || 2));
      let room = [...rooms.values()].find(x => !x.priv && x.state === 'lobby' && x.mode === mode && x.size === size && x.players.length < maxPlayers(x));
      if (!room) room = makeRoom(mode, size, false); return joinRoom(c, room); }
    case 'create': { const mode = m.mode === 'dm' ? 'dm' : 'tdm', size = Math.max(2, Math.min(4, m.size | 0 || 2)); return joinRoom(c, makeRoom(mode, size, true)); }
    case 'join': { const room = rooms.get(String(m.code || '').toUpperCase().trim()); if (!room || !room.priv) return send(c, { t: 'error', code: 'nocode', msg: 'Aucun salon avec ce code.' });
      if (room.state !== 'lobby') return send(c, { t: 'error', code: 'busy', msg: 'La partie de ce salon a déjà commencé. Réessaie à la fin.' });
      if (room.players.length >= maxPlayers(room)) return send(c, { t: 'error', code: 'full', msg: 'Ce salon est complet.' }); return joinRoom(c, room); }
    case 'team': if (r && r.state === 'lobby' && r.mode === 'tdm') { const t = m.team ? 1 : 0; if (r.players.filter(p => p.team === t).length < r.size) { c.team = t; sendLobby(r); } } return;
    case 'start': if (r && r.state === 'lobby' && r.priv && r.host === c) startMatch(r); return;
    case 'leave': leaveRoom(c); return send(c, { t: 'left' });
    case 'st': if (r && r.state === 'play' && Array.isArray(m.u)) { const own = m.u.filter(a => Array.isArray(a) && ownerOf(r, a[0]) === c); if (own.length) cast(r, { t: 'st', u: own }, c); } return;
    case 'ev': if (r && r.state === 'play' && m.e && ownerOf(r, m.e.s) === c) cast(r, { t: 'ev', e: m.e }, c); return;
    case 'hit': if (r && r.state === 'play') { const o = ownerOf(r, m.v); if (o && ownerOf(r, m.a) === c) send(o, { t: 'hit', a: m.a, v: m.v, n: clean(m.n, 40), d: Math.min(500, +m.d || 0), h: !!m.h, k: clean(m.k, 10) }); } return;
    case 'kill': if (r && r.state === 'play' && !r.done && ownerOf(r, m.v) === c && r.slots[m.a]) { const a = r.slots[m.a], v = r.slots[m.v];
        if (m.a !== m.v) { r.kills[m.a]++; if (r.mode === 'tdm') { if (a.team !== v.team) r.score[a.team]++; } } r.deaths[m.v]++;
        cast(r, { t: 'kill', a: m.a, v: m.v, n: clean(m.n, 40), h: !!m.h, k: clean(m.k, 10), score: r.score, kills: r.kills });
        if (r.mode === 'tdm' ? Math.max(...r.score) >= r.goal : Math.max(...r.kills) >= r.goal) { r.done = true; setTimeout(() => endMatch(r, 'goal'), 400); } } return;
  } }

const server = http.createServer((req, res) => { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ ok: true, game: 'Neon Vanguard', proto: PROTO, online: clients.size, rooms: rooms.size, matches: stats.matches, up: Math.round((now() - stats.started) / 1000) })); });
const wss = new WebSocketServer({ server, maxPayload: 16384 });
wss.on('connection', ws => { const c = { id: nextId++, ws, name: 'Joueur', hero: 'volt', look: null, room: null, team: 0, alive: true, n: 0, t0: now() }; clients.set(c.id, c); stats.peak = Math.max(stats.peak, clients.size);
  ws.on('message', d => { c.n++; if (c.n > 400) { if (now() - c.t0 < 1000) return; c.n = 0; c.t0 = now(); } onMessage(c, d.toString()); });
  ws.on('pong', () => { c.alive = true; }); ws.on('close', () => { leaveRoom(c); clients.delete(c.id); }); ws.on('error', () => {}); });
setInterval(() => { for (const c of clients.values()) { if (!c.alive) { c.ws.terminate(); continue; } c.alive = false; try { c.ws.ping(); } catch (e) { /* fermé */ } } }, 20000);
server.listen(PORT, () => console.log('Neon Vanguard : serveur en ligne sur le port ' + PORT));
