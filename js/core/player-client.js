// =============================================================
// CLIENT JOUEUR
// Le joueur n'écrit que ses propres données :
//  - public/players/{uid}/name, joinedAt, connected, roleSeen
//  - public/votes/{uid}          (vote du jour, une seule fois)
//  - actions/{uid}               (action de nuit, validée par le meneur)
// Il lit : public/ (état de la partie), private/{uid} (son rôle et ses
// informations secrètes) et actions/{uid} (sa dernière action).
// =============================================================
import { PHASES, NIGHT_STEPS, STEP_ROLE } from "./constants.js";
import { validateName, nameKey, listPlayers } from "./rules.js";
import { GAME_LIMITS } from "../config.js";

export class PlayerClient {
  constructor(store, code) {
    this.store = store;
    this.code = code;
    this.state = { pub: null, priv: null, action: null };
    this.unsubscribers = [];
  }

  get uid() { return this.store.uid; }
  get base() { return `rooms/${this.code}`; }
  get pub() { return this.state.pub || {}; }

  getMeta() {
    return this.store.get(`${this.base}/meta`);
  }

  async isMember() {
    const me = await this.store.get(`${this.base}/public/players/${this.uid}`);
    return Boolean(me && me.name);
  }

  /** Rejoindre la salle : validation du prénom puis réservation unique du prénom. */
  async join(rawName) {
    const check = validateName(rawName);
    if (!check.ok) throw new Error(check.error);
    const name = check.value;

    const meta = await this.getMeta();
    if (!meta) throw new Error("Cette salle n'existe pas. Vérifiez le code.");
    if (meta.hostUid === this.uid) {
      throw new Error("Ce navigateur est celui du meneur. Utilisez un autre appareil, un autre navigateur ou une fenêtre privée.");
    }
    if (await this.isMember()) return;

    const players = listPlayers(await this.store.get(`${this.base}/public/players`));
    if (players.length >= GAME_LIMITS.maxPlayers) throw new Error(`La salle est complète (${GAME_LIMITS.maxPlayers} joueurs maximum).`);

    // Transaction : le prénom n'est réservé que s'il est libre (protège contre deux inscriptions simultanées).
    const key = nameKey(name);
    const reservation = await this.store.transaction(`${this.base}/names/${key}`, (current) => {
      if (current === null || current === this.uid) return this.uid;
      return undefined; // annule la transaction
    });
    if (!reservation.committed || reservation.value !== this.uid) {
      throw new Error(`Le prénom « ${name} » est déjà utilisé dans cette salle. Choisissez-en un autre.`);
    }

    await this.store.update(`${this.base}/public/players/${this.uid}`, {
      name,
      joinedAt: this.store.now(),
      connected: true,
      roleSeen: false
    });
  }

  startPresence() {
    this.store.setPresence(`${this.base}/public/players/${this.uid}/connected`);
  }

  /** Écoute les trois nœuds lisibles par le joueur et fusionne leur contenu. */
  subscribe(callback) {
    this.stop();
    const watch = (path, key) => this.store.subscribe(path, (value) => {
      this.state = { ...this.state, [key]: value };
      callback(this.state);
    }, (err) => console.error(`[PlayerClient] ${path}`, err));
    this.unsubscribers = [
      watch(`${this.base}/public`, "pub"),
      watch(`${this.base}/private/${this.uid}`, "priv"),
      watch(`${this.base}/actions/${this.uid}`, "action")
    ];
  }

  stop() {
    this.unsubscribers.forEach((off) => off());
    this.unsubscribers = [];
  }

  // ---------- Lecture pratique ----------

  me() { return this.pub.players?.[this.uid] || null; }
  myRole() { return this.state.priv?.role || null; }
  isAlive() { const me = this.me(); return Boolean(me?.inGame && me.alive); }

  hasActed(step) {
    const action = this.state.action;
    return Boolean(action && action.round === this.pub.round && action.step === step);
  }

  // ---------- Actions ----------

  revealRole() {
    if (!this.myRole()) throw new Error("Votre rôle n'a pas encore été distribué.");
    return this.store.set(`${this.base}/public/players/${this.uid}/roleSeen`, true);
  }

  voteError(targetId) {
    const pub = this.pub;
    if (pub.phase !== PHASES.VOTING) return "Le vote n'est pas ouvert.";
    if (!this.isAlive()) return "Les joueurs éliminés ne peuvent plus voter.";
    if (pub.votes?.[this.uid]) return "Vous avez déjà voté.";
    if (targetId === this.uid) return "Vous ne pouvez pas voter pour vous-même.";
    const target = pub.players?.[targetId];
    if (!target?.inGame || !target.alive) return "Ce joueur ne peut pas être désigné.";
    if (pub.voteCandidates && !pub.voteCandidates[targetId]) return "Ce joueur ne fait pas partie du second vote.";
    return null;
  }

  async vote(targetId) {
    const error = this.voteError(targetId);
    if (error) throw new Error(error);
    await this.store.set(`${this.base}/public/votes/${this.uid}`, targetId);
  }

  nightActionError(step) {
    if (this.pub.phase !== PHASES.NIGHT || this.pub.nightStep !== step) return "Ce n'est pas votre tour.";
    if (!this.isAlive()) return "Les joueurs éliminés ne peuvent plus agir.";
    if (this.myRole() !== STEP_ROLE[step]) return "Votre rôle ne permet pas cette action.";
    return null;
  }

  async sendNightAction(step, payload) {
    const error = this.nightActionError(step) || this.payloadError(step, payload);
    if (error) throw new Error(error);
    await this.store.set(`${this.base}/actions/${this.uid}`, {
      round: this.pub.round,
      step,
      ...payload,
      at: this.store.now()
    });
  }

  payloadError(step, payload) {
    const players = this.pub.players || {};
    const isLiving = (id) => Boolean(players[id]?.inGame && players[id].alive);
    if (step === NIGHT_STEPS.SEER || step === NIGHT_STEPS.WOLVES) {
      if (!isLiving(payload.target)) return "Choisissez un joueur vivant.";
      if (payload.target === this.uid) return "Vous ne pouvez pas vous choisir vous-même.";
      if (step === NIGHT_STEPS.WOLVES && this.state.priv?.wolfTeam?.[payload.target]) return "Vous ne pouvez pas dévorer un membre de la meute.";
    }
    if (step === NIGHT_STEPS.WITCH) {
      if (this.hasActed(step)) return "Vous avez déjà joué cette nuit.";
      const info = this.state.priv?.witchInfo || {};
      if (payload.save && !info.life) return "Votre potion de vie a déjà été utilisée.";
      if (payload.save && !info.victimId) return "Personne n'est à sauver cette nuit.";
      if (payload.kill && !info.death) return "Votre potion de mort a déjà été utilisée.";
      if (payload.kill && (!isLiving(payload.kill) || payload.kill === this.uid)) return "Cible de la potion de mort invalide.";
    }
    return null;
  }
}
