// =============================================================
// STOCKAGE LOCAL (mode sans Firebase)
// -------------------------------------------------------------
// Imite l'API utilisée avec Firebase (get, set, update, transaction,
// subscribe) sur un arbre JSON stocké dans localStorage.
// Les autres onglets sont prévenus grâce à l'événement « storage ».
// L'identité de l'onglet est gardée dans sessionStorage : chaque onglet
// est un joueur différent, et un rechargement conserve l'identité.
// =============================================================

const DB_KEY = "thiercelieux:db";
const UID_KEY = "thiercelieux:uid";

export function splitPath(path) {
  return String(path).split("/").filter(Boolean);
}

export function getAt(tree, parts) {
  let node = tree;
  for (const part of parts) {
    if (node === null || typeof node !== "object") return null;
    node = node[part];
  }
  return node === undefined ? null : node;
}

/** Écrit `value` au chemin `parts` (null = suppression). Modifie et retourne l'arbre. */
export function setAt(tree, parts, value) {
  if (!parts.length) return value;
  const base = tree && typeof tree === "object" ? tree : {};
  const [head, ...rest] = parts;
  const child = setAt(base[head], rest, value);
  if (child === null || child === undefined) delete base[head];
  else base[head] = child;
  return base;
}

/** Comme Firebase : retire les valeurs null et les objets vides. */
export function clean(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(clean).filter((v) => v !== null);
  if (typeof value !== "object") return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    const cleaned = clean(child);
    if (cleaned !== null) result[key] = cleaned;
  }
  return Object.keys(result).length ? result : null;
}

const clone = (value) => (value === null || value === undefined ? null : structuredClone(value));

/** Firebase refuse une mise à jour dont un chemin contient un autre : on vérifie la même chose. */
function assertNoOverlap(keys) {
  for (const a of keys) {
    for (const b of keys) {
      if (a !== b && b.startsWith(`${a}/`)) throw new Error(`Chemins qui se chevauchent : ${a} et ${b}`);
    }
  }
}

// ---------- Transports : où l'arbre JSON est réellement stocké ----------

export function createBrowserTransport() {
  const listeners = new Set();
  window.addEventListener("storage", (event) => {
    if (event.key === DB_KEY) listeners.forEach((listener) => listener());
  });
  return {
    read() {
      try { return JSON.parse(localStorage.getItem(DB_KEY)) || {}; }
      catch { return {}; }
    },
    write(tree) {
      try { localStorage.setItem(DB_KEY, JSON.stringify(tree)); }
      catch { throw new Error("Le stockage local du navigateur est plein ou bloqué."); }
      listeners.forEach((listener) => listener()); // l'événement « storage » ne prévient pas l'onglet courant
    },
    onChange(listener) { listeners.add(listener); }
  };
}

/** Transport en mémoire, partagé entre plusieurs « clients » dans les tests Node. */
export function createMemoryTransport() {
  let data = {};
  const listeners = new Set();
  return {
    read: () => structuredClone(data),
    write(tree) { data = structuredClone(tree); listeners.forEach((listener) => listener()); },
    onChange(listener) { listeners.add(listener); }
  };
}

function loadTabUid() {
  let uid = null;
  try { uid = sessionStorage.getItem(UID_KEY); } catch { /* stockage indisponible */ }
  if (!uid) {
    uid = `p_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
    try { sessionStorage.setItem(UID_KEY, uid); } catch { /* identité perdue au rechargement */ }
  }
  return uid;
}

export class LocalStore {
  constructor(transport, uid) {
    this.mode = "local";
    this.transport = transport;
    this.uid = uid;
    this.subscriptions = new Set();
    this.notifyQueued = false;
    transport.onChange(() => this.scheduleNotify());
  }

  static createForBrowser() {
    return new LocalStore(createBrowserTransport(), loadTabUid());
  }

  now() { return Date.now(); }

  async get(path) {
    return clone(getAt(this.transport.read(), splitPath(path)));
  }

  async set(path, value) {
    this.mutate((tree) => setAt(tree, splitPath(path), clean(clone(value))));
  }

  async update(path, values) {
    assertNoOverlap(Object.keys(values));
    const baseParts = splitPath(path);
    this.mutate((tree) => {
      let next = tree;
      for (const [key, value] of Object.entries(values)) {
        next = setAt(next, [...baseParts, ...splitPath(key)], clean(clone(value)));
      }
      return next;
    });
  }

  async remove(path) {
    return this.set(path, null);
  }

  /** `fn` reçoit la valeur actuelle et retourne la nouvelle (ou undefined pour annuler). */
  async transaction(path, fn) {
    const parts = splitPath(path);
    let result = { committed: false, value: null };
    this.mutate((tree) => {
      const current = getAt(tree, parts);
      const next = fn(clone(current));
      if (next === undefined) {
        result = { committed: false, value: current };
        return null; // aucune écriture
      }
      result = { committed: true, value: clean(clone(next)) };
      return setAt(tree, parts, result.value);
    });
    return result;
  }

  /** Lecture-modification-écriture synchrone de l'arbre entier. */
  mutate(fn) {
    const next = fn(this.transport.read());
    if (next !== null) this.transport.write(clean(next) || {});
  }

  subscribe(path, callback) {
    const subscription = { parts: splitPath(path), callback, lastJson: undefined };
    this.subscriptions.add(subscription);
    this.scheduleNotify();
    return () => this.subscriptions.delete(subscription);
  }

  /** Prévient les abonnés (de façon asynchrone) uniquement si leur nœud a changé. */
  scheduleNotify() {
    if (this.notifyQueued) return;
    this.notifyQueued = true;
    queueMicrotask(() => {
      this.notifyQueued = false;
      const tree = this.transport.read();
      for (const subscription of this.subscriptions) {
        const value = getAt(tree, subscription.parts);
        const json = JSON.stringify(value);
        if (json === subscription.lastJson) continue;
        subscription.lastJson = json;
        try { subscription.callback(clone(value)); }
        catch (err) { console.error("[LocalStore] abonné en erreur", err); }
      }
    });
  }

  /** Présence : `connected` passe à false quand l'onglet est fermé ou rechargé. */
  setPresence(path) {
    const parts = splitPath(path);
    const write = (value) => this.mutate((tree) => (getAt(tree, parts.slice(0, -1)) ? setAt(tree, parts, value) : null));
    write(true);
    if (typeof window === "undefined") return;
    window.addEventListener("pagehide", () => write(false));
    window.addEventListener("pageshow", () => write(true));
  }

  onConnectionChange(callback) {
    callback(true); // le stockage local est toujours disponible
  }
}
