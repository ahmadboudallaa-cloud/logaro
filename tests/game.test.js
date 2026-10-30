// =============================================================
// TESTS AUTOMATIQUES — lancer avec : npm test   (ou node --test tests/)
// Les règles pures sont testées, puis des parties complètes sont
// simulées avec un meneur et plusieurs joueurs partageant une base en mémoire.
// =============================================================
import { test } from "node:test";
import assert from "node:assert/strict";

import { PHASES, NIGHT_STEPS } from "../js/core/constants.js";
import { validateRoleConfig, assignRoles, suggestRoleConfig } from "../js/core/roles.js";
import {
  validateName, nameKey, generateRoomCode, normalizeRoomCode, checkWinner,
  countVotes, getTopCandidates, resolveWolfVotes, resolveNightDeaths
} from "../js/core/rules.js";
import { createTimer, remainingMs, pauseTimer, resumeTimer, addTime, formatDuration } from "../js/core/timer.js";
import { narrate } from "../js/core/narrator.js";
import { HostEngine } from "../js/core/engine.js";
import { PlayerClient } from "../js/core/player-client.js";
import { LocalStore, createMemoryTransport } from "../js/store/local-store.js";

// ---------------- Règles pures ----------------

test("validation des prénoms", () => {
  assert.equal(validateName("  Ahmed  ").value, "Ahmed");
  assert.equal(validateName("Jean   Paul").value, "Jean Paul");
  assert.equal(validateName("").ok, false);
  assert.equal(validateName("<script>").ok, false);
  assert.equal(validateName("a".repeat(17)).ok, false);
  assert.equal(nameKey("Élodie"), nameKey("ELODIE"));
});

test("codes de salle", () => {
  for (let i = 0; i < 50; i++) assert.match(generateRoomCode(), /^[A-HJ-NP-Z]{4}$/);
  assert.equal(normalizeRoomCode(" abcd "), "ABCD");
  assert.equal(normalizeRoomCode("AB1D"), null);
});

test("composition des rôles", () => {
  assert.equal(validateRoleConfig({ wolf: 1, seer: true, witch: true }, 4).ok, true);
  assert.equal(validateRoleConfig({ wolf: 2, seer: true, witch: true }, 4).ok, false); // 2 loups contre 2
  assert.equal(validateRoleConfig({ wolf: 0, seer: true, witch: false }, 6).ok, false);
  assert.equal(validateRoleConfig({ wolf: 3, seer: true, witch: true }, 4).ok, false);
  const roles = assignRoles(["a", "b", "c", "d", "e", "f", "g"], suggestRoleConfig(7));
  const values = Object.values(roles);
  assert.equal(values.filter((r) => r === "wolf").length, 2);
  assert.equal(values.filter((r) => r === "seer").length, 1);
  assert.equal(values.filter((r) => r === "witch").length, 1);
  assert.equal(values.length, 7);
});

test("conditions de victoire", () => {
  const p = (id, alive = true) => ({ id, name: id, inGame: true, alive });
  const roles = { w1: "wolf", w2: "wolf", v1: "villager", v2: "villager", v3: "seer" };
  assert.equal(checkWinner([p("w1"), p("w2"), p("v1"), p("v2"), p("v3")], roles), null);
  assert.equal(checkWinner([p("w1", false), p("w2", false), p("v1"), p("v2"), p("v3")], roles), "village");
  assert.equal(checkWinner([p("w1"), p("w2"), p("v1"), p("v2"), p("v3", false)], roles), "wolves");
  // Il ne reste qu'un loup face à deux villageois : la partie continue.
  assert.equal(checkWinner([p("w1"), p("w2", false), p("v1"), p("v2"), p("v3", false)], roles), null);
  assert.equal(checkWinner([p("w1"), p("w2", false), p("v1"), p("v2", false), p("v3", false)], roles), "wolves");
});

test("comptage des votes : votes invalides ignorés, égalité détectée", () => {
  const voterIds = new Set(["a", "b", "c", "d"]);
  const { counts, valid } = countVotes(
    { a: "b", b: "b", c: "x", d: "a", z: "a" }, // b vote pour lui-même, cible x inconnue, z n'est pas électeur
    { voterIds, targetIds: voterIds }
  );
  assert.deepEqual(counts, { b: 1, a: 1 });
  assert.equal(valid.length, 2);
  assert.deepEqual(getTopCandidates(counts).ids.sort(), ["a", "b"]);
  assert.deepEqual(getTopCandidates({}), { ids: [], max: 0 });
});

test("nuit : accord des loups et potions", () => {
  assert.equal(resolveWolfVotes({ w1: "a" }, ["w1", "w2"]).unanimous, false);
  assert.equal(resolveWolfVotes({ w1: "a", w2: "b" }, ["w1", "w2"]).unanimous, false);
  assert.equal(resolveWolfVotes({ w1: "a", w2: "a" }, ["w1", "w2"]).target, "a");
  assert.deepEqual(resolveNightDeaths({ wolfTarget: "a", witchSave: false, witchKill: null }), ["a"]);
  assert.deepEqual(resolveNightDeaths({ wolfTarget: "a", witchSave: true, witchKill: null }), []);
  assert.deepEqual(resolveNightDeaths({ wolfTarget: "a", witchSave: false, witchKill: "a" }), ["a"]);
  assert.deepEqual(resolveNightDeaths({ wolfTarget: null, witchSave: false, witchKill: "b" }), ["b"]);
});

test("minuteur", () => {
  const t = createTimer(60, 1000);
  assert.equal(remainingMs(t, 31000), 30000);
  const paused = pauseTimer(t, 31000);
  assert.equal(remainingMs(paused, 99999), 30000);
  const resumed = resumeTimer(paused, 50000);
  assert.equal(remainingMs(resumed, 50000), 30000);
  assert.equal(remainingMs(addTime(resumed, 30, 50000), 50000), 60000);
  assert.equal(formatDuration(83000), "01:23");
  assert.equal(formatDuration(0), "00:00");
});

test("narrateur", () => {
  assert.equal(narrate("nightStart"), "Le village s'endort. Tout le monde ferme les yeux.");
  assert.equal(narrate("dawn", { deaths: [] }), "Le soleil se lève. Cette nuit, personne n'est mort.");
  assert.match(narrate("dawn", { deaths: [{ name: "Ahmed", role: "villager" }] }), /Cette nuit, Ahmed \(Villageois\) a été éliminé\./);
});

// ---------------- Simulation d'une partie ----------------

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function settle(engine) {
  for (let i = 0; i < 8; i++) {
    await engine.queue;
    await tick();
  }
}

/** Crée une salle, N joueurs connectés et retourne tous les objets utiles. */
async function setupRoom(names, settings = {}) {
  const transport = createMemoryTransport();
  const hostStore = new LocalStore(transport, "host");
  const code = await HostEngine.createRoom(hostStore);
  const engine = new HostEngine(hostStore, code, { tickMs: 0, random: () => 0.42 });
  await engine.start();

  const players = {};
  for (const name of names) {
    const store = new LocalStore(transport, `uid_${name}`);
    const client = new PlayerClient(store, code);
    await client.join(name);
    client.subscribe(() => {});
    players[name] = client;
  }
  await settle(engine);
  for (const [key, value] of Object.entries(settings)) await engine.updateSetting(key, value);
  await settle(engine);
  return { transport, hostStore, engine, code, players };
}

const idOf = (players, name) => players[name].uid;
const rolesOf = (engine) => engine.roles();
const namesWithRole = (engine, players, role) =>
  Object.keys(players).filter((name) => rolesOf(engine)[idOf(players, name)] === role);

async function revealAll(engine, players) {
  for (const client of Object.values(players)) await client.revealRole();
  await settle(engine);
}

test("salle : prénom en double, salle inconnue, meneur qui tente de jouer, nombre minimum", async () => {
  const { transport, engine, code, players, hostStore } = await setupRoom(["Ahmed", "Lina", "Tom"]);

  const duplicate = new PlayerClient(new LocalStore(transport, "uid_other"), code);
  await assert.rejects(() => duplicate.join("ahmed"), /déjà utilisé/);

  const lost = new PlayerClient(new LocalStore(transport, "uid_lost"), "ZZZZ");
  await assert.rejects(() => lost.join("Zoé"), /n'existe pas/);

  const hostAsPlayer = new PlayerClient(hostStore, code);
  await assert.rejects(() => hostAsPlayer.join("Meneur"), /meneur/);

  await assert.rejects(() => engine.startGame(), /au moins 4 joueurs/);
  assert.equal(Object.keys(players).length, 3);

  // Rejoindre deux fois avec la même identité ne crée pas de doublon.
  await players.Ahmed.join("Ahmed");
  assert.equal(engine.players().length, 3);
});

test("partie complète : voyante, loups, sorcière, vote, victoire du village", async () => {
  const names = ["Ahmed", "Lina", "Tom", "Sara", "Yanis", "Inès"];
  const { engine, players, transport, code } = await setupRoom(names, { roles: { wolf: 1, seer: true, witch: true } });

  await engine.startGame();
  await settle(engine);
  assert.equal(engine.pub.phase, PHASES.ROLE_REVEAL);

  // Un joueur ne voit que son propre rôle.
  for (const client of Object.values(players)) {
    assert.ok(client.myRole());
    assert.equal(client.state.pub.revealAll, undefined);
  }

  // Le meneur ne peut pas lancer la nuit tant que toutes les cartes ne sont pas vues.
  await assert.rejects(() => engine.startNight(), /pas encore découvert/);
  await revealAll(engine, players);

  // Un joueur qui arrive en cours de partie attend la prochaine.
  const late = new PlayerClient(new LocalStore(transport, "uid_late"), code);
  await late.join("Retard");
  await settle(engine);
  assert.equal(engine.inGame().length, 6);

  const [wolf] = namesWithRole(engine, players, "wolf");
  const [seer] = namesWithRole(engine, players, "seer");
  const [witch] = namesWithRole(engine, players, "witch");
  const villagers = names.filter((n) => ![wolf, seer, witch].includes(n));

  // ---- Nuit 1
  await engine.startNight();
  await settle(engine);
  assert.equal(engine.pub.phase, PHASES.NIGHT);
  assert.equal(engine.pub.nightStep, NIGHT_STEPS.SEER);

  // Un villageois ne peut pas agir à la place de la voyante.
  await assert.rejects(() => players[villagers[0]].sendNightAction(NIGHT_STEPS.SEER, { target: idOf(players, wolf) }), /rôle/);

  await players[seer].sendNightAction(NIGHT_STEPS.SEER, { target: idOf(players, wolf) });
  await settle(engine);
  assert.equal(players[seer].state.priv.visions[1].isWolf, true);
  assert.equal(engine.pub.nightStep, NIGHT_STEPS.WOLVES);

  const victim = villagers[0];
  await assert.rejects(() => players[wolf].sendNightAction(NIGHT_STEPS.WOLVES, { target: idOf(players, wolf) }), /vous-même/);
  await players[wolf].sendNightAction(NIGHT_STEPS.WOLVES, { target: idOf(players, victim) });
  await settle(engine);
  assert.equal(engine.pub.nightStep, NIGHT_STEPS.WITCH);
  assert.equal(players[witch].state.priv.witchInfo.victimName, victim);

  // La sorcière sauve la victime.
  await players[witch].sendNightAction(NIGHT_STEPS.WITCH, { save: true, kill: null });
  await settle(engine);
  assert.equal(engine.pub.phase, PHASES.DAY);
  assert.equal(engine.pub.lastNight.deaths.length, 0);
  assert.match(engine.pub.narrator.text, /personne n'est mort/);
  assert.equal(engine.potions().life, false);

  // ---- Vote 1 : le village élimine le loup
  await engine.startVote();
  await settle(engine);
  assert.equal(engine.pub.phase, PHASES.VOTING);

  const wolfId = idOf(players, wolf);
  await assert.rejects(() => players[seer].vote(idOf(players, seer)), /vous-même/);
  for (const name of names) {
    const target = name === wolf ? idOf(players, seer) : wolfId;
    await players[name].vote(target);
  }
  await assert.rejects(() => players[seer].vote(wolfId), /déjà voté/);
  await settle(engine);

  assert.equal(engine.pub.phase, PHASES.END);
  assert.equal(engine.pub.winner, "village");
  assert.equal(engine.pub.lastResult.id, wolfId);
  assert.equal(engine.pub.lastResult.votes, 5);
  assert.equal(engine.pub.timer, undefined);
  // À la fin, tous les rôles sont révélés.
  assert.equal(Object.keys(players[seer].state.pub.revealAll).length, 6);
  // Les actions sont bloquées.
  await assert.rejects(() => players[seer].vote(wolfId), /pas ouvert/);

  // ---- Nouvelle partie avec les mêmes joueurs (le retardataire est inclus)
  await engine.newGame();
  await settle(engine);
  assert.equal(engine.pub.phase, PHASES.WAITING);
  assert.equal(engine.players().length, 7);
  assert.equal(players[seer].state.priv, null);
  await engine.startGame();
  await settle(engine);
  assert.equal(engine.inGame().length, 7);
});

test("victoire des loups, potion de mort et potion déjà consommée", async () => {
  const names = ["A", "B", "C", "D", "E"];
  const { engine, players } = await setupRoom(names, { roles: { wolf: 1, seer: false, witch: true } });
  await engine.startGame();
  await settle(engine);
  await revealAll(engine, players);

  const [wolf] = namesWithRole(engine, players, "wolf");
  const [witch] = namesWithRole(engine, players, "witch");
  const others = names.filter((n) => n !== wolf && n !== witch);

  await engine.startNight();
  await settle(engine);
  assert.equal(engine.pub.nightStep, NIGHT_STEPS.WOLVES); // pas de voyante : étape sautée

  await players[wolf].sendNightAction(NIGHT_STEPS.WOLVES, { target: idOf(players, others[0]) });
  await settle(engine);
  // La sorcière laisse mourir la victime et empoisonne un villageois.
  await players[witch].sendNightAction(NIGHT_STEPS.WITCH, { save: false, kill: idOf(players, others[1]) });
  await settle(engine);
  assert.equal(engine.pub.phase, PHASES.DAY);
  assert.equal(engine.pub.lastNight.deaths.length, 2);
  assert.equal(engine.potions().death, false);
  assert.equal(engine.living().length, 3);

  // Un joueur éliminé ne peut pas voter.
  await engine.startVote();
  await settle(engine);
  await assert.rejects(() => players[others[0]].vote(idOf(players, wolf)), /éliminés/);
  // Le vote est clôturé manuellement sans aucun vote.
  await engine.closeVote();
  await settle(engine);
  assert.equal(engine.pub.phase, PHASES.RESULT);
  assert.equal(engine.pub.lastResult.type, "none");

  // Nuit 2 : la potion de mort est déjà consommée.
  await engine.startNight();
  await settle(engine);
  await players[wolf].sendNightAction(NIGHT_STEPS.WOLVES, { target: idOf(players, others[2]) });
  await settle(engine);
  await assert.rejects(
    () => players[witch].sendNightAction(NIGHT_STEPS.WITCH, { save: false, kill: idOf(players, wolf) }),
    /déjà été utilisée/
  );
  await players[witch].sendNightAction(NIGHT_STEPS.WITCH, { save: false, kill: null });
  await settle(engine);
  // Il reste le loup et la sorcière : 1 contre 1 → victoire des loups.
  assert.equal(engine.pub.phase, PHASES.END);
  assert.equal(engine.pub.winner, "wolves");
});

test("égalité : règle « personne », second vote, puis tirage au sort", async () => {
  const names = ["A", "B", "C", "D", "E", "F"];
  const { engine, players } = await setupRoom(names, { roles: { wolf: 1, seer: false, witch: false } });
  await engine.startGame();
  await settle(engine);
  await revealAll(engine, players);

  const [wolf] = namesWithRole(engine, players, "wolf");
  const villagers = names.filter((n) => n !== wolf);

  async function playQuietNight() {
    await engine.startNight();
    await settle(engine);
    await engine.skipStep(); // les loups ne répondent pas : le meneur force l'étape
    await settle(engine);
    await engine.startVote();
    await settle(engine);
  }

  await playQuietNight();
  assert.equal(engine.living().length, 6); // aucun choix des loups → personne n'est mort

  // 3 votes contre villagers[0], 3 contre villagers[1] → égalité, personne n'est éliminé.
  const [x, y] = [idOf(players, villagers[0]), idOf(players, villagers[1])];
  const alive = () => names.filter((n) => engine.living().some((p) => p.id === idOf(players, n)));
  // x vote pour y, y vote pour x, les 4 autres se répartissent : 3 voix chacun.
  async function voteTie() {
    const others = alive().filter((n) => ![x, y].includes(idOf(players, n)));
    for (const [i, name] of others.entries()) await players[name].vote(i % 2 === 0 ? x : y);
    await players[villagers[0]].vote(y);
    await players[villagers[1]].vote(x);
  }
  await voteTie();
  await settle(engine);
  assert.equal(engine.pub.phase, PHASES.RESULT);
  assert.equal(engine.pub.lastResult.type, "tie");

  // Le meneur organise un second vote limité aux ex æquo.
  await engine.revote();
  await settle(engine);
  assert.equal(engine.pub.phase, PHASES.VOTING);
  assert.equal(Object.keys(engine.pub.voteCandidates).length, 2);
  const outsider = alive().find((n) => ![x, y].includes(idOf(players, n)) && n !== wolf);
  const voter = alive().find((n) => n !== outsider);
  await assert.rejects(() => players[voter].vote(idOf(players, outsider)), /second vote/);
  await engine.closeVote();
  await settle(engine);

  // Règle « tirage au sort » : une égalité élimine quelqu'un au hasard.
  await engine.updateSetting("tieRule", "random");
  await playQuietNight();
  await voteTie();
  await settle(engine);
  assert.equal(engine.pub.lastResult.type, "eliminated");
  assert.equal(engine.pub.lastResult.random, true);
});

test("deux loups doivent se mettre d'accord ; minuteur expiré avec passage automatique", async () => {
  const names = ["A", "B", "C", "D", "E", "F", "G"];
  const { engine, players, hostStore } = await setupRoom(names, { roles: { wolf: 2, seer: false, witch: false } });
  await engine.startGame();
  await settle(engine);
  await engine.startNight({ force: true }); // le meneur force : personne n'a regardé sa carte
  await settle(engine);

  const wolves = namesWithRole(engine, players, "wolf");
  const villagers = names.filter((n) => !wolves.includes(n));
  await players[wolves[0]].sendNightAction(NIGHT_STEPS.WOLVES, { target: idOf(players, villagers[0]) });
  await players[wolves[1]].sendNightAction(NIGHT_STEPS.WOLVES, { target: idOf(players, villagers[1]) });
  await settle(engine);
  // Désaccord : on attend, et chaque loup voit les choix de la meute.
  assert.equal(engine.pub.nightStep, NIGHT_STEPS.WOLVES);
  assert.equal(Object.keys(players[wolves[0]].state.priv.wolfVotes).length, 2);
  // Un loup ne peut pas cibler un autre loup.
  await assert.rejects(() => players[wolves[0]].sendNightAction(NIGHT_STEPS.WOLVES, { target: idOf(players, wolves[1]) }), /meute/);

  await players[wolves[1]].sendNightAction(NIGHT_STEPS.WOLVES, { target: idOf(players, villagers[0]) });
  await settle(engine);
  assert.equal(engine.pub.phase, PHASES.DAY);
  assert.equal(engine.pub.lastNight.deaths[0].name, villagers[0]);

  // Le minuteur du débat expire : passage automatique au vote.
  const realNow = hostStore.now;
  hostStore.now = () => realNow.call(hostStore) + 10 * 60 * 1000;
  engine.scheduleReact();
  await settle(engine);
  assert.equal(engine.pub.phase, PHASES.VOTING);
  hostStore.now = realNow;
});

test("réinitialisation complète et retrait d'un joueur", async () => {
  const { engine, players, transport, code } = await setupRoom(["A", "B", "C", "D"]);
  await engine.removePlayer(players.D.uid);
  await settle(engine);
  assert.equal(engine.players().length, 3);
  // Le prénom libéré peut être réutilisé.
  const again = new PlayerClient(new LocalStore(transport, "uid_D2"), code);
  await again.join("D");
  await settle(engine);
  assert.equal(engine.players().length, 4);

  await engine.resetRoom();
  await settle(engine);
  assert.equal(engine.players().length, 0);
  assert.equal(engine.pub.phase, PHASES.WAITING);
  assert.equal(players.A.state.pub.players, undefined);
});

test("fermeture de la salle : la salle est supprimée et les joueurs le voient", async () => {
  const { engine, players, hostStore, code } = await setupRoom(["A", "B", "C", "D"]);
  await engine.closeRoom();
  await settle(engine);
  assert.equal(await hostStore.get(`rooms/${code}`), null);
  assert.equal(players.A.state.pub, null);
});
