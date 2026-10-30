// =============================================================
// MOTEUR DU MENEUR (HostEngine)
// -------------------------------------------------------------
// Le navigateur du meneur est l'« arbitre » de la partie :
//  - les joueurs écrivent seulement leurs intentions (vote, action de nuit) ;
//  - le moteur les valide puis fait avancer la machine à états ;
//  - chaque transition est écrite en UNE seule mise à jour multi-chemins
//    (atomique sur Firebase), via l'objet `u` = { "chemin/relatif": valeur }.
// Aucun accès au DOM ici : ce fichier est testé sous Node.
// =============================================================
import { PHASES, PHASE_LABELS, NIGHT_STEPS, NIGHT_ORDER, STEP_ROLE, STEP_LABELS } from "./constants.js";
import { TEAMS, assignRoles, suggestRoleConfig, validateRoleConfig, isWolf, roleName } from "./roles.js";
import {
  listPlayers, checkWinner, countVotes, getTopCandidates, resolveWolfVotes,
  resolveNightDeaths, pickRandom, generateRoomCode, createEventId, sameEntries, nameKey
} from "./rules.js";
import { createTimer, isExpired, pauseTimer, resumeTimer, addTime } from "./timer.js";
import { narrate, STEP_NARRATION } from "./narrator.js";
import { DEFAULT_SETTINGS, GAME_LIMITS, mergeSettings } from "../config.js";

// Réglages modifiables et leur validation.
const SETTING_VALIDATORS = {
  "durations/night": (v) => clampInt(v, 10, 600),
  "durations/debate": (v) => clampInt(v, 10, 1800),
  "durations/vote": (v) => clampInt(v, 10, 600),
  autoAdvance: (v) => v === true,
  tieRule: (v) => (["none", "revote", "random"].includes(v) ? v : "none"),
  roles: (v) => (v === null ? null : { wolf: clampInt(v.wolf, 1, 10), seer: Boolean(v.seer), witch: Boolean(v.witch) })
};

function clampInt(value, min, max) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/** Une action de nuit n'est prise en compte que si elle concerne la nuit et l'étape en cours. */
function currentAction(action, round, step) {
  return action && action.round === round && action.step === step ? action : null;
}

export function initialPublicState(now) {
  return {
    phase: PHASES.WAITING,
    round: 0,
    settings: structuredClone(DEFAULT_SETTINGS),
    narrator: { text: narrate("waiting"), at: now }
  };
}

export class HostEngine {
  constructor(store, code, { random = Math.random, tickMs = 1000 } = {}) {
    this.store = store;
    this.code = code;
    this.random = random;
    this.tickMs = tickMs;
    this.room = null;
    this.listeners = new Set();
    this.queue = Promise.resolve();
    this.reactQueued = false;
    this.presence = null;
    this.eventSeq = 0;
    this.onError = (err) => console.error("[HostEngine]", err);
  }

  get base() { return `rooms/${this.code}`; }
  get pub() { return this.room?.public || {}; }
  get hostData() { return this.room?.host || {}; }

  // ================= Création / démarrage =================

  /** Crée une salle avec un code libre et retourne ce code. */
  static async createRoom(store, { random = Math.random } = {}) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const code = generateRoomCode(random);
      if (await store.get(`rooms/${code}/meta`)) continue;
      await store.set(`rooms/${code}/meta`, { hostUid: store.uid, createdAt: store.now(), mode: store.mode });
      await store.set(`rooms/${code}/public`, initialPublicState(store.now()));
      return code;
    }
    throw new Error("Impossible de trouver un code de salle libre. Réessayez.");
  }

  /** Vérifie que l'on est bien le meneur puis écoute la salle en temps réel. */
  async start() {
    const meta = await this.store.get(`${this.base}/meta`);
    if (!meta) throw new Error(`La salle ${this.code} n'existe pas.`);
    if (meta.hostUid !== this.store.uid) {
      throw new Error("Vous n'êtes pas le meneur de cette salle (ce navigateur n'a pas créé la salle).");
    }
    this.unsubscribe = this.store.subscribe(this.base, (room) => {
      this.room = room;
      this.listeners.forEach((cb) => cb(room));
      this.scheduleReact();
    }, (err) => this.onError(err));
    if (this.tickMs > 0) this.ticker = setInterval(() => this.scheduleReact(), this.tickMs);
  }

  stop() {
    this.unsubscribe?.();
    clearInterval(this.ticker);
  }

  onChange(callback) {
    this.listeners.add(callback);
    if (this.room) callback(this.room);
    return () => this.listeners.delete(callback);
  }

  // ================= File d'exécution =================
  // Toutes les opérations passent par une file : deux transitions
  // ne peuvent jamais s'exécuter en même temps.

  exclusive(task) {
    const run = this.queue.then(task);
    this.queue = run.catch(() => {});
    return run;
  }

  scheduleReact() {
    if (this.reactQueued) return;
    this.reactQueued = true;
    this.exclusive(async () => {
      this.reactQueued = false;
      await this.react();
    }).catch((err) => this.onError(err));
  }

  // ================= Lecture de l'état =================

  settings() { return mergeSettings(this.pub.settings); }
  players() { return listPlayers(this.pub.players); }
  inGame() { return this.players().filter((p) => p.inGame); }
  living() { return this.players().filter((p) => p.inGame && p.alive); }
  roles() { return this.hostData.roles || {}; }
  roleOf(id) { return this.roles()[id] || null; }
  livingWithRole(role) { return this.living().filter((p) => this.roleOf(p.id) === role); }
  player(id) { return this.players().find((p) => p.id === id) || null; }
  nameOf(id) { return this.player(id)?.name || "?"; }
  night() { return { round: this.pub.round || 0, ...(this.hostData.night || {}) }; }
  potions() { return { life: false, death: false, ...(this.hostData.potions || {}) }; }

  effectiveRoleConfig(playerCount) {
    return this.settings().roles || suggestRoleConfig(playerCount);
  }

  // ================= Écriture =================

  async commit(updates) {
    if (Object.keys(updates).length) await this.store.update(this.base, updates);
  }

  addEvent(u, text, { secret = false } = {}) {
    const now = this.store.now();
    this.eventSeq += 1;
    u[`host/history/${createEventId(now, this.eventSeq)}`] = { text, at: now, secret };
  }

  setNarrator(u, text) {
    u["public/narrator"] = { text, at: this.store.now() };
  }

  setTimer(u, seconds, label) {
    u["public/timer"] = createTimer(seconds, this.store.now(), label);
  }

  assertPhase(...phases) {
    if (!phases.includes(this.pub.phase)) {
      throw new Error(`Action impossible pendant la phase « ${PHASE_LABELS[this.pub.phase] || this.pub.phase} ».`);
    }
  }

  // ================= Réactions automatiques =================
  // Appelée à chaque changement de la base et chaque seconde.

  async react() {
    if (!this.room?.public) return;
    const presenceUpdates = this.collectPresenceEvents();
    if (presenceUpdates) await this.commit(presenceUpdates);

    const pub = this.pub;
    const timerPhases = [PHASES.NIGHT, PHASES.DAY, PHASES.VOTING];
    if (timerPhases.includes(pub.phase) && isExpired(pub.timer, this.store.now()) && !pub.timer.expired) {
      return this.handleTimerExpired();
    }
    if (pub.phase === PHASES.NIGHT) return this.reactNight();
    if (pub.phase === PHASES.VOTING) return this.reactVoting();
  }

  /** Historise les arrivées, déconnexions et reconnexions des joueurs. */
  collectPresenceEvents() {
    const current = new Map(this.players().map((p) => [p.id, { name: p.name, connected: p.connected !== false }]));
    const previous = this.presence;
    this.presence = current;
    if (!previous) return null; // premier chargement : on mémorise sans historiser

    const u = {};
    const lateJoin = this.pub.phase !== PHASES.WAITING;
    for (const [id, info] of current) {
      const before = previous.get(id);
      if (!before) this.addEvent(u, `${info.name} a rejoint la salle${lateJoin ? " (jouera à la prochaine partie)" : ""}.`);
      else if (before.connected && !info.connected) this.addEvent(u, `${info.name} s'est déconnecté.`);
      else if (!before.connected && info.connected) this.addEvent(u, `${info.name} s'est reconnecté.`);
    }
    return Object.keys(u).length ? u : null;
  }

  async handleTimerExpired() {
    const u = {};
    if (!this.settings().autoAdvance) {
      u["public/timer/expired"] = true;
      this.addEvent(u, "Temps écoulé : en attente du meneur.");
      return this.commit(u);
    }
    this.addEvent(u, "Temps écoulé : passage automatique à la suite.");
    if (this.pub.phase === PHASES.NIGHT) this.forceNightStep(u);
    else if (this.pub.phase === PHASES.DAY) this.applyVoteStart(u, null, false);
    else if (this.pub.phase === PHASES.VOTING) this.applyCloseVote(u);
    return this.commit(u);
  }

  // ================= Phase : attente → distribution =================

  startGame() {
    return this.exclusive(async () => {
      this.assertPhase(PHASES.WAITING);
      const players = this.players();
      if (players.length < GAME_LIMITS.minPlayers) {
        throw new Error(`Il faut au moins ${GAME_LIMITS.minPlayers} joueurs (actuellement ${players.length}).`);
      }
      const config = this.effectiveRoleConfig(players.length);
      const check = validateRoleConfig(config, players.length);
      if (!check.ok) throw new Error(check.error);

      const roles = assignRoles(players.map((p) => p.id), config, this.random);
      const wolfTeam = {};
      players.filter((p) => isWolf(roles[p.id])).forEach((p) => { wolfTeam[p.id] = p.name; });

      const u = {};
      for (const p of players) {
        u[`public/players/${p.id}/inGame`] = true;
        u[`public/players/${p.id}/alive`] = true;
        u[`public/players/${p.id}/roleSeen`] = false;
        u[`public/players/${p.id}/revealedRole`] = null;
        u[`private/${p.id}`] = isWolf(roles[p.id]) ? { role: roles[p.id], wolfTeam } : { role: roles[p.id] };
      }
      u["host/roles"] = roles;
      u["host/potions"] = { life: true, death: true };
      u["host/night"] = null;
      u["actions"] = null;
      Object.assign(u, this.clearedRoundState());
      u["public/phase"] = PHASES.ROLE_REVEAL;
      u["public/round"] = 0;
      u["public/winner"] = null;
      u["public/revealAll"] = null;
      u["public/lastNight"] = null;
      u["public/timer"] = null;
      this.setNarrator(u, narrate("rolesDealt"));
      this.addEvent(u, `Rôles distribués à ${players.length} joueurs.`);
      this.addEvent(u, `Rôles : ${players.map((p) => `${p.name} = ${roleName(roles[p.id])}`).join(", ")}.`, { secret: true });
      await this.commit(u);
    });
  }

  /** Champs propres à un tour qu'il faut vider entre deux phases. */
  clearedRoundState() {
    return {
      "public/votes": null,
      "public/voteCandidates": null,
      "public/isRevote": null,
      "public/lastResult": null,
      "public/nightStep": null
    };
  }

  // ================= Phase : nuit =================

  startNight({ force = false } = {}) {
    return this.exclusive(async () => {
      this.assertPhase(PHASES.ROLE_REVEAL, PHASES.RESULT);
      if (this.pub.phase === PHASES.ROLE_REVEAL && !force) {
        const unseen = this.inGame().filter((p) => !p.roleSeen);
        if (unseen.length) throw new Error(`${unseen.length} joueur(s) n'ont pas encore découvert leur carte.`);
      }
      const round = (this.pub.round || 0) + 1;
      const night = { round };
      const u = { ...this.clearedRoundState() };
      u["public/phase"] = PHASES.NIGHT;
      u["public/round"] = round;
      u["public/lastNight"] = null;
      u["actions"] = null;
      for (const wolf of this.livingWithRole("wolf")) u[`private/${wolf.id}/wolfVotes`] = null;
      for (const witch of this.livingWithRole("witch")) u[`private/${witch.id}/witchInfo`] = null;
      if (force) this.addEvent(u, "Nuit lancée par le meneur sans attendre toutes les cartes.");
      this.addEvent(u, `Début de la nuit ${round}.`);
      u["host/night"] = night;

      const firstStep = this.nextStep(null);
      if (firstStep) this.enterStep(u, firstStep, night, narrate("nightStart"));
      else this.finishNight(u, night);
      await this.commit(u);
    });
  }

  /** Une étape n'a lieu que si le rôle concerné est encore vivant. */
  nextStep(fromStep) {
    const start = fromStep ? NIGHT_ORDER.indexOf(fromStep) + 1 : 0;
    return NIGHT_ORDER.slice(start).find((step) => this.livingWithRole(STEP_ROLE[step]).length > 0) || null;
  }

  enterStep(u, step, night, prefix = "") {
    u["public/nightStep"] = step;
    this.setTimer(u, this.settings().durations.night, STEP_LABELS[step]);
    this.setNarrator(u, [prefix, narrate(STEP_NARRATION[step])].filter(Boolean).join(" "));
    this.addEvent(u, `Nuit ${night.round} : ${STEP_LABELS[step]} se réveille.`);

    if (step === NIGHT_STEPS.WITCH) {
      // La Sorcière apprend en privé qui est la victime des loups.
      const witch = this.livingWithRole("witch")[0];
      const victimId = night.wolfTarget || null;
      const potions = this.potions();
      u[`private/${witch.id}/witchInfo`] = {
        round: night.round,
        victimId,
        victimName: victimId ? this.nameOf(victimId) : null,
        life: potions.life,
        death: potions.death
      };
    }
  }

  /** Passe à l'étape suivante, ou termine la nuit s'il n'y en a plus. */
  advanceNight(u, night, fromStep) {
    u["host/night"] = night;
    const next = this.nextStep(fromStep);
    if (next) this.enterStep(u, next, night);
    else this.finishNight(u, night);
  }

  async reactNight() {
    const step = this.pub.nightStep;
    const round = this.pub.round;
    const actions = this.room.actions || {};
    const u = {};

    if (!step) {
      this.finishNight(u, this.night());
    } else if (step === NIGHT_STEPS.SEER) {
      const seer = this.livingWithRole("seer")[0];
      const action = seer && currentAction(actions[seer.id], round, step);
      if (!seer) this.advanceNight(u, this.night(), step);
      else if (action && this.isValidSeerTarget(action.target, seer.id)) this.resolveSeer(u, seer, action.target);
    } else if (step === NIGHT_STEPS.WOLVES) {
      this.reactWolves(u);
    } else if (step === NIGHT_STEPS.WITCH) {
      const witch = this.livingWithRole("witch")[0];
      const action = witch && currentAction(actions[witch.id], round, step);
      if (!witch) this.advanceNight(u, this.night(), step);
      else if (action) this.resolveWitch(u, witch, action);
    }
    return this.commit(u);
  }

  isValidSeerTarget(targetId, seerId) {
    return targetId !== seerId && this.living().some((p) => p.id === targetId);
  }

  resolveSeer(u, seer, targetId) {
    const night = this.night();
    const targetIsWolf = isWolf(this.roleOf(targetId));
    night.seerTarget = targetId;
    night.seerResult = targetIsWolf;
    u[`private/${seer.id}/visions/${night.round}`] = { targetId, name: this.nameOf(targetId), isWolf: targetIsWolf };
    this.addEvent(u, `La Voyante a sondé ${this.nameOf(targetId)} : ${targetIsWolf ? "Loup-Garou" : "pas Loup-Garou"}.`, { secret: true });
    this.advanceNight(u, night, NIGHT_STEPS.SEER);
  }

  /** Choix valides de chaque loup vivant pour la nuit en cours. */
  collectWolfVotes() {
    const wolves = this.livingWithRole("wolf");
    const targets = new Set(this.living().filter((p) => !isWolf(this.roleOf(p.id))).map((p) => p.id));
    const actions = this.room?.actions || {};
    const votes = {};
    for (const wolf of wolves) {
      const action = currentAction(actions[wolf.id], this.pub.round, NIGHT_STEPS.WOLVES);
      if (action && targets.has(action.target)) votes[wolf.id] = action.target;
    }
    return { wolves, votes };
  }

  reactWolves(u) {
    const { wolves, votes } = this.collectWolfVotes();
    if (!wolves.length) return this.advanceNight(u, this.night(), NIGHT_STEPS.WOLVES);

    // Chaque loup voit en privé les choix de la meute.
    for (const wolf of wolves) {
      const shown = this.room.private?.[wolf.id]?.wolfVotes || {};
      if (!sameEntries(shown, votes)) u[`private/${wolf.id}/wolfVotes`] = Object.keys(votes).length ? votes : null;
    }
    const result = resolveWolfVotes(votes, wolves.map((w) => w.id));
    if (result.unanimous) this.resolveWolves(u, result.target, false);
  }

  resolveWolves(u, targetId, forced) {
    const night = this.night();
    night.wolfTarget = targetId || null;
    const suffix = forced ? " (étape forcée)" : "";
    this.addEvent(u, targetId
      ? `Les Loups-Garous ont choisi ${this.nameOf(targetId)}${suffix}.`
      : `Les Loups-Garous n'ont désigné aucune victime${suffix}.`, { secret: true });
    this.advanceNight(u, night, NIGHT_STEPS.WOLVES);
  }

  resolveWitch(u, witch, action) {
    const night = this.night();
    const potions = this.potions();
    const living = new Set(this.living().map((p) => p.id));

    const wantsSave = action.save === true;
    const save = wantsSave && potions.life && Boolean(night.wolfTarget);
    const kill = action.kill && potions.death && living.has(action.kill) && action.kill !== witch.id ? action.kill : null;
    if (wantsSave && !save) this.addEvent(u, "Potion de vie refusée (déjà utilisée ou aucune victime).", { secret: true });
    if (action.kill && !kill) this.addEvent(u, "Potion de mort refusée (déjà utilisée ou cible invalide).", { secret: true });

    night.witchSave = save;
    night.witchKill = kill;
    u["host/potions"] = { life: potions.life && !save, death: potions.death && !kill };
    if (save) this.addEvent(u, `La Sorcière a sauvé ${this.nameOf(night.wolfTarget)} (potion de vie).`, { secret: true });
    if (kill) this.addEvent(u, `La Sorcière a empoisonné ${this.nameOf(kill)} (potion de mort).`, { secret: true });
    if (!save && !kill) this.addEvent(u, "La Sorcière n'a utilisé aucune potion.", { secret: true });
    this.advanceNight(u, night, NIGHT_STEPS.WITCH);
  }

  /** Utilisé par « Passer l'étape » et par l'expiration du minuteur. */
  forceNightStep(u) {
    const step = this.pub.nightStep;
    if (step === NIGHT_STEPS.SEER) {
      this.addEvent(u, "La Voyante n'a sondé personne (étape passée).", { secret: true });
      this.advanceNight(u, this.night(), step);
    } else if (step === NIGHT_STEPS.WOLVES) {
      const { wolves, votes } = this.collectWolfVotes();
      const result = resolveWolfVotes(votes, wolves.map((w) => w.id));
      // Sans accord : on retient le choix majoritaire (tirage au sort en cas d'égalité).
      const target = result.unanimous ? result.target : pickRandom(result.pluralityIds, this.random);
      this.resolveWolves(u, target, true);
    } else if (step === NIGHT_STEPS.WITCH) {
      this.addEvent(u, "La Sorcière n'a rien fait (étape passée).", { secret: true });
      this.advanceNight(u, this.night(), step);
    } else {
      this.finishNight(u, this.night());
    }
  }

  skipStep() {
    return this.exclusive(async () => {
      this.assertPhase(PHASES.NIGHT);
      const u = {};
      this.forceNightStep(u);
      await this.commit(u);
    });
  }

  finishNight(u, night) {
    const living = new Set(this.living().map((p) => p.id));
    const deaths = resolveNightDeaths(night).filter((id) => living.has(id));
    const deathInfo = deaths.map((id) => ({ id, name: this.nameOf(id), role: this.roleOf(id) }));
    for (const dead of deathInfo) {
      u[`public/players/${dead.id}/alive`] = false;
      u[`public/players/${dead.id}/revealedRole`] = dead.role;
      this.addEvent(u, `${dead.name} (${roleName(dead.role)}) est mort pendant la nuit.`);
    }
    if (!deathInfo.length) this.addEvent(u, "Personne n'est mort cette nuit.");
    u["public/nightStep"] = null;
    u["public/lastNight"] = { round: night.round, deaths: deathInfo };

    const dawnText = narrate("dawn", { deaths: deathInfo });
    const winner = this.winnerAfter(deaths);
    if (winner) return this.applyEnd(u, winner, dawnText);

    u["public/phase"] = PHASES.DAY;
    this.setNarrator(u, `${dawnText} ${narrate("debate")}`);
    this.setTimer(u, this.settings().durations.debate, "Débat");
  }

  /** Vainqueur éventuel si les joueurs `deadIds` meurent maintenant. */
  winnerAfter(deadIds) {
    const players = this.players().map((p) => (deadIds.includes(p.id) ? { ...p, alive: false } : p));
    return checkWinner(players, this.roles());
  }

  // ================= Phase : jour et vote =================

  startVote() {
    return this.exclusive(async () => {
      this.assertPhase(PHASES.DAY);
      const u = {};
      this.applyVoteStart(u, null, false);
      await this.commit(u);
    });
  }

  /** Second vote limité aux ex æquo (bouton du meneur après une égalité). */
  revote() {
    return this.exclusive(async () => {
      this.assertPhase(PHASES.RESULT);
      const result = this.pub.lastResult;
      if (result?.type !== "tie") throw new Error("Le second vote n'est possible qu'après une égalité.");
      const u = {};
      this.applyVoteStart(u, result.tiedIds, true);
      await this.commit(u);
    });
  }

  applyVoteStart(u, candidateIds, isRevote) {
    const candidates = candidateIds ? Object.fromEntries(candidateIds.map((id) => [id, true])) : null;
    u["public/phase"] = PHASES.VOTING;
    u["public/votes"] = null;
    u["public/voteCandidates"] = candidates;
    u["public/isRevote"] = isRevote || null;
    u["public/lastResult"] = null;
    this.setTimer(u, this.settings().durations.vote, isRevote ? "Second vote" : "Vote");
    this.setNarrator(u, isRevote ? narrate("revote", { names: candidateIds.map((id) => this.nameOf(id)) }) : narrate("voteStart"));
    this.addEvent(u, isRevote ? "Début du second vote." : "Début du vote.");
  }

  /** Votes valides : électeurs vivants, cibles vivantes (et candidates en cas de second vote). */
  validDayVotes() {
    const voterIds = new Set(this.living().map((p) => p.id));
    const candidates = this.pub.voteCandidates ? Object.keys(this.pub.voteCandidates) : [...voterIds];
    const targetIds = new Set(candidates.filter((id) => voterIds.has(id)));
    return countVotes(this.pub.votes || {}, { voterIds, targetIds });
  }

  async reactVoting() {
    const living = this.living();
    const { valid } = this.validDayVotes();
    if (living.length > 0 && valid.length >= living.length) {
      const u = {};
      this.applyCloseVote(u);
      await this.commit(u);
    }
  }

  closeVote() {
    return this.exclusive(async () => {
      this.assertPhase(PHASES.VOTING);
      const u = {};
      this.applyCloseVote(u);
      await this.commit(u);
    });
  }

  applyCloseVote(u) {
    const { counts, valid } = this.validDayVotes();
    const { ids, max } = getTopCandidates(counts);
    this.addEvent(u, valid.length
      ? `Votes : ${valid.map((v) => `${this.nameOf(v.voter)} → ${this.nameOf(v.target)}`).join(", ")}.`
      : "Aucun vote enregistré.");
    u["public/timer"] = null;
    u["public/voteCandidates"] = null;
    u["public/isRevote"] = null;

    if (max === 0) return this.applyResult(u, { type: "none", counts }, narrate("noVote"));
    if (ids.length === 1) return this.applyElimination(u, ids[0], max, counts, false);

    const rule = this.settings().tieRule;
    if (rule === "revote" && !this.pub.isRevote) return this.applyVoteStart(u, ids, true);
    if (rule === "random") return this.applyElimination(u, pickRandom(ids, this.random), max, counts, true);

    const names = ids.map((id) => this.nameOf(id));
    this.addEvent(u, `Égalité entre ${names.join(", ")} : personne n'est éliminé.`);
    return this.applyResult(u, { type: "tie", tiedIds: ids, tiedNames: names, votes: max, counts }, narrate("tie", { names }));
  }

  applyElimination(u, id, votes, counts, random) {
    const role = this.roleOf(id);
    const name = this.nameOf(id);
    u[`public/players/${id}/alive`] = false;
    u[`public/players/${id}/revealedRole`] = role;
    const result = { type: "eliminated", id, name, role, votes, counts, random };
    this.addEvent(u, `${name} (${roleName(role)}) est éliminé par le village avec ${votes} vote(s)${random ? " après tirage au sort" : ""}.`);

    const text = narrate("eliminated", { name, role, votes, random });
    const winner = this.winnerAfter([id]);
    if (winner) {
      u["public/lastResult"] = result;
      return this.applyEnd(u, winner, text);
    }
    this.applyResult(u, result, text);
  }

  applyResult(u, result, text) {
    u["public/phase"] = PHASES.RESULT;
    u["public/lastResult"] = result;
    u["public/timer"] = null;
    this.setNarrator(u, text);
  }

  // ================= Fin de partie =================

  applyEnd(u, winner, prefixText = "") {
    u["public/phase"] = PHASES.END;
    u["public/winner"] = winner;
    u["public/revealAll"] = { ...this.roles() };
    u["public/timer"] = null;
    u["public/nightStep"] = null;
    u["public/voteCandidates"] = null;
    this.setNarrator(u, [prefixText, narrate("victory", { winner })].filter(Boolean).join(" "));
    this.addEvent(u, `Victoire : ${TEAMS[winner]} !`);
  }

  /** Nouvelle partie avec les mêmes joueurs (y compris ceux arrivés en cours de partie). */
  newGame() {
    return this.exclusive(async () => {
      const u = { ...this.clearedRoundState() };
      for (const p of this.players()) {
        u[`public/players/${p.id}/inGame`] = null;
        u[`public/players/${p.id}/alive`] = null;
        u[`public/players/${p.id}/roleSeen`] = false;
        u[`public/players/${p.id}/revealedRole`] = null;
      }
      Object.assign(u, this.clearedGameState());
      this.setNarrator(u, narrate("newGame"));
      this.addEvent(u, "Nouvelle partie : retour à la salle d'attente.");
      await this.commit(u);
    });
  }

  clearedGameState() {
    return {
      "public/phase": PHASES.WAITING,
      "public/round": 0,
      "public/winner": null,
      "public/revealAll": null,
      "public/lastNight": null,
      "public/timer": null,
      "private": null,
      "actions": null,
      "host/roles": null,
      "host/potions": null,
      "host/night": null
    };
  }

  /** Réinitialisation complète : joueurs, prénoms et historique sont effacés. */
  resetRoom() {
    return this.exclusive(async () => {
      const now = this.store.now();
      const u = { ...this.clearedRoundState(), ...this.clearedGameState() };
      u["public/players"] = null;
      u["names"] = null;
      u["host/history"] = { [createEventId(now, ++this.eventSeq)]: { text: "Salle réinitialisée.", at: now, secret: false } };
      this.setNarrator(u, narrate("reset"));
      this.presence = new Map();
      await this.commit(u);
    });
  }

  /** Fermeture définitive : la salle est supprimée de la base, les joueurs en sont informés. */
  closeRoom() {
    return this.exclusive(async () => {
      this.stop();
      await this.store.remove(this.base);
    });
  }

  /** Retirer un joueur (uniquement en salle d'attente). */
  removePlayer(playerId) {
    return this.exclusive(async () => {
      this.assertPhase(PHASES.WAITING);
      const player = this.player(playerId);
      if (!player) throw new Error("Joueur introuvable.");
      const u = {};
      u[`public/players/${playerId}`] = null;
      u[`private/${playerId}`] = null;
      const key = nameKey(player.name);
      if (this.room.names?.[key] === playerId) u[`names/${key}`] = null;
      this.addEvent(u, `${player.name} a été retiré de la salle par le meneur.`);
      this.presence?.delete(playerId);
      await this.commit(u);
    });
  }

  // ================= Réglages et minuteur =================

  updateSetting(key, value) {
    return this.exclusive(async () => {
      const validate = SETTING_VALIDATORS[key];
      if (!validate) throw new Error(`Réglage inconnu : ${key}`);
      if (key === "roles") this.assertPhase(PHASES.WAITING);
      await this.commit({ [`public/settings/${key}`]: validate(value) });
    });
  }

  updateTimer(transform) {
    return this.exclusive(async () => {
      const timer = this.pub.timer;
      if (!timer) throw new Error("Aucun minuteur en cours.");
      await this.commit({ "public/timer": transform(timer, this.store.now()) });
    });
  }

  pauseTimer() { return this.updateTimer((t, now) => (t.paused ? t : pauseTimer(t, now))); }
  resumeTimer() { return this.updateTimer((t, now) => (t.paused ? resumeTimer(t, now) : t)); }
  addTime(seconds) { return this.updateTimer((t, now) => addTime(t, seconds, now)); }
  restartTimer() { return this.updateTimer((t, now) => createTimer(t.duration, now, t.label)); }
}
