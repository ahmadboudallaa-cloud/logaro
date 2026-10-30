// =============================================================
// RÈGLES DU JEU : fonctions pures (aucun accès au DOM ni à la base)
// Elles sont testées dans tests/game.test.js
// =============================================================
import { isWolf } from "./roles.js";

export const NAME_MAX_LENGTH = 16;
const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} '\-]*$/u;
const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // sans I ni O (confusion avec 1 et 0)

// ---------- Prénoms et codes de salle ----------

export function validateName(raw) {
  const name = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, error: "Veuillez saisir votre prénom." };
  if (name.length > NAME_MAX_LENGTH) {
    return { ok: false, error: `Le prénom ne doit pas dépasser ${NAME_MAX_LENGTH} caractères.` };
  }
  if (!NAME_PATTERN.test(name)) {
    return { ok: false, error: "Utilisez uniquement des lettres, chiffres, espaces, tirets ou apostrophes." };
  }
  return { ok: true, value: name };
}

/** Clé de comparaison : « Élodie », « elodie » et « ELODIE » sont le même prénom. */
export function nameKey(name) {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function generateRoomCode(random = Math.random) {
  let code = "";
  for (let i = 0; i < 4; i++) code += CODE_LETTERS[Math.floor(random() * CODE_LETTERS.length)];
  return code;
}

/** Retourne le code en majuscules s'il est valide, sinon null. */
export function normalizeRoomCode(input) {
  const code = String(input ?? "").trim().toUpperCase();
  return /^[A-Z]{4}$/.test(code) ? code : null;
}

// ---------- Joueurs ----------

/** Transforme l'objet `players` de la base en liste triée par ordre d'arrivée. */
export function listPlayers(playersObject) {
  return Object.entries(playersObject || {})
    .filter(([, p]) => p && p.name)
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0) || a.name.localeCompare(b.name));
}

export function livingPlayers(players) {
  return players.filter((p) => p.inGame && p.alive);
}

export function pickRandom(list, random = Math.random) {
  if (!list.length) return null;
  return list[Math.floor(random() * list.length)];
}

// ---------- Conditions de victoire ----------

/**
 * Village : plus aucun loup vivant.
 * Loups : loups vivants >= autres joueurs vivants.
 */
export function checkWinner(players, roles) {
  const alive = livingPlayers(players);
  const wolves = alive.filter((p) => isWolf(roles[p.id])).length;
  const others = alive.length - wolves;
  if (wolves === 0) return "village";
  if (wolves >= others) return "wolves";
  return null;
}

// ---------- Votes ----------

/**
 * Compte uniquement les votes valides :
 * électeur autorisé, cible autorisée, pas de vote pour soi-même.
 */
export function countVotes(votes, { voterIds, targetIds }) {
  const counts = {};
  const valid = [];
  for (const [voter, target] of Object.entries(votes || {})) {
    if (!voterIds.has(voter) || !targetIds.has(target) || voter === target) continue;
    counts[target] = (counts[target] || 0) + 1;
    valid.push({ voter, target });
  }
  return { counts, valid };
}

/** Joueur(s) ayant reçu le plus de votes. */
export function getTopCandidates(counts) {
  let max = 0;
  let ids = [];
  for (const [id, count] of Object.entries(counts)) {
    if (count > max) { max = count; ids = [id]; }
    else if (count === max) ids.push(id);
  }
  return { ids: max > 0 ? ids : [], max };
}

// ---------- Nuit ----------

/** Analyse les choix de la meute : la victime est retenue quand tous les loups sont d'accord. */
export function resolveWolfVotes(votes, wolfIds) {
  const chosen = wolfIds.map((id) => votes[id]).filter(Boolean);
  const complete = wolfIds.length > 0 && chosen.length === wolfIds.length;
  const unanimous = complete && new Set(chosen).size === 1;
  const counts = {};
  chosen.forEach((target) => { counts[target] = (counts[target] || 0) + 1; });
  return {
    complete,
    unanimous,
    target: unanimous ? chosen[0] : null,
    pluralityIds: getTopCandidates(counts).ids
  };
}

/** Morts de la nuit : victime des loups (sauf si sauvée) + cible de la potion de mort. */
export function resolveNightDeaths({ wolfTarget, witchSave, witchKill }) {
  const deaths = [];
  if (wolfTarget && !witchSave) deaths.push(wolfTarget);
  if (witchKill && !deaths.includes(witchKill)) deaths.push(witchKill);
  return deaths;
}

// ---------- Divers ----------

/** Identifiant d'événement triable chronologiquement. */
export function createEventId(now, sequence) {
  const rand = Math.random().toString(36).slice(2, 6);
  return `${String(now).padStart(14, "0")}_${String(sequence).padStart(4, "0")}_${rand}`;
}

/** Compare deux objets simples { clé: valeur } sans tenir compte de l'ordre des clés. */
export function sameEntries(a = {}, b = {}) {
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  return keysA.every((key) => a[key] === b[key]);
}
