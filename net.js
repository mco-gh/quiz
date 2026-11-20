// The links between the host's browser and every player's browser, in a star:
// each player connects to the host only, never to each other. PeerJS's public
// broker introduces them; after that, every message travels over a WebRTC data
// channel directly between the host and that player. The host's browser is the
// game server: it holds the questions and answers, keeps the clock and the
// scores, and tells each player only what they need to see.
/* global Peer */
import { iceServers } from './ice.js';

const PREFIX = 'mco-quiz-';
// How long a joining player tries before being told the link can't be made.
const CONNECT_TIMEOUT = 20000;
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';   // no look-alikes

export function newCode() {
  const pick = crypto.getRandomValues(new Uint8Array(6));
  const chars = [...pick].map((n) => ALPHABET[n % ALPHABET.length]).join('');
  return `${chars.slice(0, 3)}-${chars.slice(3)}`;
}

/** Tidy whatever someone typed or pasted (a code or a whole link) into a code. */
export function cleanCode(text) {
  const raw = text.includes('#') ? text.slice(text.lastIndexOf('#') + 1) : text;
  const chars = raw.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6);
  return chars.length > 3 ? `${chars.slice(0, 3)}-${chars.slice(3)}` : chars;
}

export const isFullCode = (code) => /^[a-z0-9]{3}-[a-z0-9]{3}$/.test(code);

// Lets the host recognise a returning player (after a reload or a dropped
// link) and give them back their name and score.
export function playerId() {
  try {
    let id = sessionStorage.getItem('quiz-player');
    if (!id) sessionStorage.setItem('quiz-player', (id = crypto.randomUUID()));
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

const brokerReason = (err) => ({
  'peer-unavailable': 'noroom',
  'unavailable-id': 'taken',
  'browser-incompatible': 'browser',
  'network': 'network',
  'server-error': 'network',
  'socket-error': 'network',
  'socket-closed': 'network',
}[err.type]);

/**
 * Open a room as the host.
 * on: ready(), join(id, hello), message(id, obj), leave(id), ended(reason)
 * A player is identified by the id their browser chose, so a reconnecting
 * player replaces their own old link rather than appearing twice.
 */
export function hostRoom({ code, on }) {
  const links = new Map();        // player id → DataConnection
  let peer = null;
  let closed = false;

  const end = (reason) => {
    if (closed) return;
    closed = true;
    try { peer?.destroy(); } catch {}
    on.ended?.(reason);
  };

  const drop = (id, c) => {
    if (links.get(id) !== c) return;      // an old link that was already replaced
    links.delete(id);
    on.leave?.(id);
  };

  iceServers().then((servers) => {
    if (closed) return;
    peer = new Peer(PREFIX + code, { config: { iceServers: servers } });
    peer.on('open', () => on.ready?.());

    peer.on('connection', (c) => {
      const id = String(c.metadata?.id ?? '').slice(0, 64);
      if (!id) return c.close();
      const timer = setTimeout(() => { if (!c.open) try { c.close(); } catch {} }, CONNECT_TIMEOUT);
      c.on('open', () => {
        clearTimeout(timer);
        const old = links.get(id);
        links.set(id, c);
        if (old && old !== c) try { old.close(); } catch {}
      });
      c.on('data', (data) => {
        if (links.get(id) !== c || !data || typeof data !== 'object') return;
        if (data.t === 'bye') { drop(id, c); try { c.close(); } catch {} return; }
        if (data.t === 'hello') return on.join?.(id, data);
        on.message?.(id, data);
      });
      c.on('close', () => drop(id, c));
      c.on('error', () => drop(id, c));
    });

    // Losing the broker doesn't affect players already connected; quietly
    // reconnect so new players can still find the room.
    peer.on('disconnected', () => { if (!closed && !peer.destroyed) peer.reconnect(); });
    peer.on('error', (err) => {
      const reason = brokerReason(err);
      if (reason === 'network' && links.size) return;
      if (reason) end(reason);
    });
  });

  const sendTo = (c, message) => { try { if (c?.open) c.send(message); } catch {} };
  return {
    get count() { return links.size; },
    has: (id) => links.has(id),
    send(id, message) { sendTo(links.get(id), message); },
    broadcast(message) { for (const c of links.values()) sendTo(c, message); },
    /** Tell one player to go, then close their link. */
    kick(id, message) {
      const c = links.get(id);
      if (!c) return;
      sendTo(c, message);
      links.delete(id);
      setTimeout(() => { try { c.close(); } catch {} }, 300);
    },
    close(message) {
      if (closed) return;
      if (message) for (const c of links.values()) sendTo(c, message);
      closed = true;
      setTimeout(() => { try { peer?.destroy(); } catch {} }, 200);
    },
  };
}

/**
 * Join a room as a player.
 * on: open(), message(obj), ended(reason)
 * Reasons: 'lost' | 'noroom' | 'network' | 'browser' | 'unreachable'
 */
export function joinRoom({ code, hello, on }) {
  let peer = null;
  let conn = null;
  let closed = false;

  const end = (reason) => {
    if (closed) return;
    closed = true;
    try { peer?.destroy(); } catch {}
    on.ended?.(reason);
  };

  iceServers().then((servers) => {
    if (closed) return;
    peer = new Peer({ config: { iceServers: servers } });
    peer.on('open', () => {
      const c = peer.connect(PREFIX + code, { reliable: true, metadata: { id: playerId() } });
      conn = c;
      const timer = setTimeout(() => { if (!c.open) end('unreachable'); }, CONNECT_TIMEOUT);
      c.on('open', () => { clearTimeout(timer); c.send({ t: 'hello', ...hello }); on.open?.(); });
      c.on('data', (data) => { if (data && typeof data === 'object') on.message?.(data); });
      c.on('close', () => end('lost'));
    });
    peer.on('disconnected', () => { if (!closed && !peer.destroyed) peer.reconnect(); });
    peer.on('error', (err) => {
      const reason = brokerReason(err);
      if (reason === 'network' && conn?.open) return;
      if (reason) end(reason);
    });
  });

  return {
    send(message) { try { if (conn?.open) conn.send(message); } catch {} },
    close() {
      if (closed) return;
      try { if (conn?.open) conn.send({ t: 'bye' }); } catch {}
      closed = true;
      setTimeout(() => { try { peer?.destroy(); } catch {} }, 150);
    },
  };
}
