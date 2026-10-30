// =============================================================
// INTERFACE JOUEUR (téléphone, Mobile First)
// -------------------------------------------------------------
// Écrans : rejoindre → salle d'attente → carte secrète → nuit / jour /
// vote / résultat → fin. L'écran est entièrement recalculé à partir de
// l'état reçu (public + privé), plus un petit état local `ui`
// (sélection en cours, carte affichée…).
// =============================================================
import { PHASES, NIGHT_STEPS, STEP_ROLE, STEP_LABELS } from "../core/constants.js";
import { ROLES, TEAMS, roleName } from "../core/roles.js";
import { listPlayers, normalizeRoomCode } from "../core/rules.js";
import { remainingMs, formatDuration } from "../core/timer.js";
import { PlayerClient } from "../core/player-client.js";
import { icon } from "./icons.js";
import { roleCardFace, cardBack, roleBadge, phaseTitle } from "./components.js";
import { $, escapeHtml, setHtml, delegate, toast, runAction, replaceUrl } from "./dom.js";

/** Formulaire « Rejoindre », aussi utilisé sur la page d'accueil. */
export function joinFormHtml({ code = "", name = "", error = "" } = {}) {
  return `
    <form class="join-form" data-join-form novalidate>
      <label>Code de la salle
        <input name="code" value="${escapeHtml(code)}" maxlength="4" autocomplete="off" autocapitalize="characters"
          placeholder="ABCD" required class="code-input">
      </label>
      <label>Votre prénom
        <input name="name" value="${escapeHtml(name)}" maxlength="16" autocomplete="given-name" placeholder="Ex. Ahmed" required>
      </label>
      <p class="error-text" data-join-error>${escapeHtml(error)}</p>
      <button class="btn btn-primary btn-large" type="submit">${icon("login")}Rejoindre la partie</button>
    </form>`;
}

export function mountPlayerView(root, { store, code = "", name = "" }) {
  const ui = { selected: null, witchSave: false, witchKill: "", showCard: false, contextKey: "", justRevealed: false };
  let client = null;
  let state = null;

  document.body.classList.add("is-player");
  root.addEventListener("submit", onJoinSubmit);
  setInterval(renderTimer, 250);
  start();

  // ------------------------------------------------------------
  // Connexion à la salle
  // ------------------------------------------------------------
  async function start() {
    if (!code) return showJoin({ name });
    client = new PlayerClient(store, code);
    try {
      const meta = await client.getMeta();
      if (!meta) return showJoin({ code, name, error: "Cette salle n'existe pas. Vérifiez le code." });
      if (await client.isMember()) return enterGame();
      if (name) return join(code, name);
      showJoin({ code });
    } catch (err) {
      showJoin({ code, name, error: err.message });
    }
  }

  function showJoin({ code: c = "", name: n = "", error = "", info = "" } = {}) {
    document.body.dataset.phase = "JOIN";
    root.innerHTML = `
      <section class="player-shell">
        <header class="player-brand">${icon("moon")}<h1>Thiercelieux</h1></header>
        <div class="panel">
          <h2>Rejoindre une partie</h2>
          ${info ? `<p class="hint">${escapeHtml(info)}</p>` : ""}
          ${joinFormHtml({ code: c, name: n, error })}
        </div>
      </section>`;
    root.querySelector(c ? '[name="name"]' : '[name="code"]')?.focus();
  }

  async function onJoinSubmit(event) {
    if (!event.target.matches("[data-join-form]")) return;
    event.preventDefault();
    const form = event.target;
    const enteredCode = normalizeRoomCode(form.code.value);
    const errorBox = form.querySelector("[data-join-error]");
    if (!enteredCode) { errorBox.textContent = "Le code doit contenir 4 lettres."; return; }
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    await join(enteredCode, form.name.value);
    button.disabled = false;
  }

  async function join(roomCode, rawName) {
    code = roomCode;
    client = new PlayerClient(store, code);
    try {
      await client.join(rawName);
      replaceUrl({ room: code });
      enterGame();
    } catch (err) {
      showJoin({ code, name: rawName, error: err.message });
    }
  }

  function enterGame() {
    replaceUrl({ room: code });
    root.innerHTML = `<section class="player-shell" id="p-shell"><p class="muted">Connexion à la salle…</p></section>`;
    client.startPresence();
    client.subscribe((next) => { state = next; render(); });
  }

  // ------------------------------------------------------------
  // Rendu principal
  // ------------------------------------------------------------
  function render() {
    const shell = $("#p-shell");
    if (!shell || !state) return;
    const pub = state.pub;
    if (!pub) {
      client.stop();
      return showJoin({ error: "Cette salle n'existe plus." });
    }
    const me = pub.players?.[client.uid];
    if (!me?.name) {
      client.stop();
      return showJoin({ code, info: "Vous ne faites plus partie de cette salle (retiré par le meneur ou salle réinitialisée)." });
    }
    resetSelectionIfContextChanged(pub);
    document.body.dataset.phase = me.inGame ? pub.phase : "WAITING";
    setHtml(shell, me.inGame ? gameHtml(pub, me) : lobbyHtml(pub, me));
    renderTimer();
  }

  /** La sélection en cours est oubliée à chaque nouvelle phase ou étape. */
  function resetSelectionIfContextChanged(pub) {
    const key = `${pub.phase}|${pub.round}|${pub.nightStep || ""}|${pub.isRevote ? 1 : 0}`;
    if (key === ui.contextKey) return;
    ui.contextKey = key;
    ui.selected = null;
    ui.witchSave = false;
    ui.witchKill = "";
  }

  function renderTimer() {
    const element = $("#p-timer");
    const timer = state?.pub?.timer;
    if (!element) return;
    if (!timer) { element.textContent = ""; element.hidden = true; return; }
    const ms = remainingMs(timer, store.now());
    element.hidden = false;
    element.innerHTML = `${icon("timer")}${formatDuration(ms)}`;
    element.className = `p-timer ${ms <= 10000 && !timer.paused ? "is-urgent" : ""} ${timer.paused ? "is-paused" : ""}`;
  }

  function headerHtml(pub, me) {
    const role = client.myRole();
    const status = !me.inGame ? "Spectateur" : me.alive ? "Vivant" : "Éliminé";
    return `
      <header class="p-header">
        <div>
          <p class="p-name">${escapeHtml(me.name)}</p>
          <p class="p-status ${me.inGame && !me.alive ? "is-dead" : ""}">${me.inGame && !me.alive ? icon("skull") : icon("user")}${status} · Salle ${escapeHtml(code)}</p>
        </div>
        <div class="p-header-right">
          <span id="p-timer" class="p-timer" hidden></span>
          ${role && me.roleSeen ? `<button class="btn btn-small btn-ghost" data-action="toggle-card">${icon(ui.showCard ? "eyeOff" : "eye")}Ma carte</button>` : ""}
        </div>
      </header>
      <p class="p-phase">${escapeHtml(phaseTitle(pub))}</p>`;
  }

  function lobbyHtml(pub, me) {
    const players = listPlayers(pub.players);
    const waitingForNext = pub.phase !== PHASES.WAITING;
    return `
      ${headerHtml(pub, me)}
      <div class="panel center">
        <div class="pulse-moon">${icon("moon")}</div>
        <h2>${waitingForNext ? "Partie en cours" : "Vous êtes dans la salle"}</h2>
        <p class="muted">${waitingForNext
          ? "Une partie a déjà commencé. Vous jouerez dès la prochaine partie."
          : "Le meneur va bientôt distribuer les rôles. Gardez cette page ouverte."}</p>
      </div>
      <div class="panel">
        <h3>${icon("users")}${players.length} joueur${players.length > 1 ? "s" : ""}</h3>
        <ul class="chip-list">${players.map((p) => `<li class="${p.id === client.uid ? "is-me" : ""}">${escapeHtml(p.name)}</li>`).join("")}</ul>
      </div>`;
  }

  function gameHtml(pub, me) {
    const role = client.myRole();
    const narrator = pub.narrator?.text ? `<section class="narrator is-compact"><p>${escapeHtml(pub.narrator.text)}</p></section>` : "";
    const cardModal = ui.showCard && role ? `
      <div class="card-modal" data-action="toggle-card">
        <div class="role-card is-flipped is-static">${roleCardFace(role)}</div>
        <p class="muted small">Touchez pour masquer</p>
      </div>` : "";
    return `${headerHtml(pub, me)}${narrator}<section class="p-main">${phaseHtml(pub, me, role)}</section>${cardModal}`;
  }

  function phaseHtml(pub, me, role) {
    if (pub.phase === PHASES.END) return endHtml(pub, role);
    if (pub.phase === PHASES.ROLE_REVEAL) return revealHtml(pub, me, role);
    if (!me.alive) return deadHtml(pub, me, role);
    switch (pub.phase) {
      case PHASES.NIGHT: return nightHtml(pub, role);
      case PHASES.DAY: return dayHtml(pub);
      case PHASES.VOTING: return voteHtml(pub);
      case PHASES.RESULT: return resultHtml(pub);
      default: return "";
    }
  }

  // ------------------------------------------------------------
  // Écrans par phase
  // ------------------------------------------------------------
  function revealHtml(pub, me, role) {
    const players = listPlayers(pub.players).filter((p) => p.inGame);
    const seen = players.filter((p) => p.roleSeen).length;
    if (!me.roleSeen) {
      return `
        <div class="reveal">
          <div class="role-card">${cardBack()}</div>
          <p class="muted center">Assurez-vous que personne ne regarde votre écran.</p>
          <button class="btn btn-primary btn-large" data-action="reveal-role" ${role ? "" : "disabled"}>${icon("eye")}Découvrir mon rôle</button>
        </div>`;
    }
    return `
      <div class="reveal">
        <div class="role-card is-flipped is-static ${ui.justRevealed ? "is-revealing" : ""}">${roleCardFace(role)}</div>
        ${teamHtml()}
        <p class="muted center">En attente des autres joueurs : ${seen}/${players.length} cartes découvertes.</p>
      </div>`;
  }

  /** Les loups connaissent les membres de leur meute. */
  function teamHtml() {
    const team = state.priv?.wolfTeam;
    if (!team) return "";
    const mates = Object.entries(team).filter(([id]) => id !== client.uid).map(([, name]) => escapeHtml(name));
    return `<p class="team-line">${icon("claw")}${mates.length ? `Votre meute : ${mates.join(", ")}` : "Vous êtes le seul Loup-Garou."}</p>`;
  }

  function nightHtml(pub, role) {
    const step = pub.nightStep;
    if (!step || STEP_ROLE[step] !== role) return sleepHtml(pub);
    if (step === NIGHT_STEPS.SEER) return seerHtml(pub);
    if (step === NIGHT_STEPS.WOLVES) return wolvesHtml(pub);
    if (step === NIGHT_STEPS.WITCH) return witchHtml(pub);
    return sleepHtml(pub);
  }

  function sleepHtml(pub) {
    const vision = state.priv?.visions?.[pub.round];
    return `
      <div class="sleep">
        <div class="pulse-moon">${icon("moon")}</div>
        <h2>Fermez les yeux</h2>
        <p class="muted">${pub.nightStep ? `${escapeHtml(STEP_LABELS[pub.nightStep])} agit en ce moment.` : "Le village dort."}</p>
        ${vision ? visionHtml(vision) : ""}
      </div>`;
  }

  function visionHtml(vision) {
    return `<div class="vision ${vision.isWolf ? "is-wolf" : ""}">${icon("eye")}
      <p><strong>${escapeHtml(vision.name)}</strong> ${vision.isWolf ? "est un Loup-Garou !" : "n'est pas un Loup-Garou."}</p></div>`;
  }

  /** Liste de joueurs à choisir (boutons). */
  function choicesHtml(players, { action, selectedId = null, markers = {}, counts = null, disabled = false }) {
    if (!players.length) return '<p class="muted">Aucun joueur disponible.</p>';
    return `<ul class="choices">${players.map((p) => `
      <li><button class="choice ${p.id === selectedId ? "is-selected" : ""}" data-action="${action}" data-id="${escapeHtml(p.id)}" ${disabled ? "disabled" : ""}>
        <span class="choice-name">${escapeHtml(p.name)}</span>
        ${markers[p.id] ? `<span class="choice-marker">${markers[p.id]}</span>` : ""}
        ${counts ? `<span class="vote-count">${counts[p.id] || 0}</span>` : ""}
      </button></li>`).join("")}</ul>`;
  }

  function livingOthers(pub) {
    return listPlayers(pub.players).filter((p) => p.inGame && p.alive && p.id !== client.uid);
  }

  function seerHtml(pub) {
    const vision = state.priv?.visions?.[pub.round];
    if (vision) return `<div class="action-panel">${visionHtml(vision)}<p class="muted center">Rendormez-vous.</p></div>`;
    if (client.hasActed(NIGHT_STEPS.SEER)) return waitingHtml("Vision en cours…");
    const selected = ui.selected;
    return `
      <div class="action-panel" style="--role:${ROLES.seer.color}">
        <h2>${icon("eye")}Qui voulez-vous sonder ?</h2>
        ${choicesHtml(livingOthers(pub), { action: "select", selectedId: selected })}
        <button class="btn btn-primary btn-large" data-action="seer-confirm" ${selected ? "" : "disabled"}>Découvrir son rôle</button>
      </div>`;
  }

  function wolvesHtml(pub) {
    const team = state.priv?.wolfTeam || {};
    const wolfVotes = state.priv?.wolfVotes || {};
    const targets = livingOthers(pub).filter((p) => !team[p.id]);
    const myAction = client.hasActed(NIGHT_STEPS.WOLVES) ? state.action.target : null;
    const markers = {};
    for (const [wolfId, targetId] of Object.entries(wolfVotes)) {
      const label = wolfId === client.uid ? "vous" : escapeHtml(team[wolfId] || "?");
      markers[targetId] = markers[targetId] ? `${markers[targetId]}, ${label}` : label;
    }
    const teamSize = Object.keys(team).filter((id) => pub.players?.[id]?.alive).length;
    return `
      <div class="action-panel" style="--role:${ROLES.wolf.color}">
        <h2>${icon("claw")}Choisissez votre victime</h2>
        ${teamSize > 1 ? '<p class="muted">La victime est retenue quand toute la meute choisit le même joueur. Vous pouvez changer d\'avis.</p>' : ""}
        ${teamHtml()}
        ${choicesHtml(targets, { action: "wolf-vote", selectedId: myAction, markers })}
      </div>`;
  }

  function witchHtml(pub) {
    const info = state.priv?.witchInfo;
    if (!info || info.round !== pub.round) return waitingHtml("Préparation de vos potions…");
    if (client.hasActed(NIGHT_STEPS.WITCH)) return waitingHtml("Votre choix est enregistré. Rendormez-vous.");
    const targets = livingOthers(pub);
    const victimLine = info.victimId
      ? `Les Loups-Garous ont choisi <strong>${escapeHtml(info.victimName)}</strong>${info.victimId === client.uid ? " (vous !)" : ""}.`
      : "Les Loups-Garous n'ont fait aucune victime cette nuit.";
    return `
      <div class="action-panel" style="--role:${ROLES.witch.color}">
        <h2>${icon("flask")}Vos potions</h2>
        <p>${victimLine}</p>
        <div class="potion ${info.life ? "" : "is-used"}">
          <h3>Potion de vie</h3>
          ${!info.life ? '<p class="muted">Déjà utilisée.</p>'
            : !info.victimId ? '<p class="muted">Personne à sauver.</p>'
            : `<button class="btn ${ui.witchSave ? "btn-primary" : "btn-secondary"}" data-action="witch-save">${icon(ui.witchSave ? "check" : "plus")}${ui.witchSave ? "Victime sauvée" : `Sauver ${escapeHtml(info.victimName)}`}</button>`}
        </div>
        <div class="potion ${info.death ? "" : "is-used"}">
          <h3>Potion de mort</h3>
          ${info.death ? `<select data-action="witch-kill" class="select">
              <option value="">Ne tuer personne</option>
              ${targets.map((p) => `<option value="${escapeHtml(p.id)}" ${ui.witchKill === p.id ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}
            </select>` : '<p class="muted">Déjà utilisée.</p>'}
        </div>
        <div class="btn-row">
          <button class="btn btn-primary btn-large" data-action="witch-confirm">${icon("check")}Valider</button>
          <button class="btn btn-ghost" data-action="witch-skip">Ne rien faire</button>
        </div>
      </div>`;
  }

  function waitingHtml(text) {
    return `<div class="sleep"><div class="pulse-moon">${icon("moon")}</div><p class="muted">${escapeHtml(text)}</p></div>`;
  }

  function dayHtml(pub) {
    const deaths = pub.lastNight?.deaths || [];
    return `
      <div class="panel center">
        <div class="sun-icon">${icon("sun")}</div>
        ${deaths.length
          ? `<p class="eyebrow">Cette nuit</p>${deaths.map((d) => `<p class="death-line">${icon("skull")}<strong>${escapeHtml(d.name)}</strong> ${roleBadge(d.role)}</p>`).join("")}`
          : "<h2>Personne n'est mort cette nuit.</h2>"}
        <p class="muted">Débattez : qui sont les Loups-Garous ?</p>
      </div>`;
  }

  function voteCounts(pub) {
    const counts = {};
    for (const [voter, target] of Object.entries(pub.votes || {})) {
      if (pub.players?.[voter]?.alive && voter !== target) counts[target] = (counts[target] || 0) + 1;
    }
    return counts;
  }

  function voteHtml(pub) {
    const myVote = pub.votes?.[client.uid];
    const candidates = livingOthers(pub).filter((p) => !pub.voteCandidates || pub.voteCandidates[p.id]);
    const counts = voteCounts(pub);
    if (myVote) {
      return `
        <div class="action-panel">
          <p class="ok-text">${icon("check")}Vous avez voté contre <strong>${escapeHtml(pub.players[myVote]?.name || "?")}</strong>.</p>
          <h3>Décompte en direct</h3>
          ${choicesHtml(candidates, { action: "none", counts, disabled: true })}
        </div>`;
    }
    const selected = ui.selected;
    return `
      <div class="action-panel">
        <h2>${icon("vote")}${pub.isRevote ? "Second vote" : "Qui éliminer ?"}</h2>
        <p class="muted">Un seul vote, définitif. Vous ne pouvez pas voter pour vous-même.</p>
        ${choicesHtml(candidates, { action: "select", selectedId: selected, counts })}
        <button class="btn btn-primary btn-large" data-action="vote-confirm" ${selected ? "" : "disabled"}>
          ${selected ? `Voter contre ${escapeHtml(pub.players[selected]?.name || "")}` : "Sélectionnez un joueur"}</button>
      </div>`;
  }

  function resultHtml(pub) {
    const result = pub.lastResult || {};
    let body = "<h2>Personne n'est éliminé.</h2>";
    if (result.type === "eliminated") {
      body = `<p class="eyebrow">Le village a éliminé</p><p class="death-line big">${icon("skull")}<strong>${escapeHtml(result.name)}</strong></p>
        ${roleBadge(result.role)}<p class="muted">${result.votes} vote${result.votes > 1 ? "s" : ""}</p>`;
    } else if (result.type === "tie") {
      body = `<h2>Égalité</h2><p class="muted">${result.tiedNames.map(escapeHtml).join(", ")} : personne n'est éliminé.</p>`;
    }
    return `<div class="panel center">${body}<p class="muted small">La nuit va bientôt tomber…</p></div>`;
  }

  function deadHtml(pub, me, role) {
    const counts = pub.phase === PHASES.VOTING ? voteCounts(pub) : null;
    const candidates = counts ? livingOthers(pub) : [];
    return `
      <div class="panel center is-dead-panel">
        <div class="pulse-moon">${icon("skull")}</div>
        <h2>Vous avez été éliminé</h2>
        <p>Vous étiez ${escapeHtml(ROLES[role]?.article || "")} <strong>${escapeHtml(roleName(role))}</strong>.</p>
        <p class="muted">Restez silencieux : vous ne pouvez plus voter ni agir.</p>
      </div>
      ${counts ? `<div class="panel"><h3>Décompte en direct</h3>${choicesHtml(candidates, { action: "none", counts, disabled: true })}</div>` : ""}`;
  }

  function endHtml(pub, role) {
    const winner = pub.winner;
    const won = ROLES[role]?.team === winner;
    const reveal = pub.revealAll || {};
    const players = listPlayers(pub.players).filter((p) => p.inGame);
    return `
      <div class="victory victory-${winner}">
        <div class="victory-emblem">${icon(winner === "wolves" ? "claw" : "crown")}</div>
        <h2>${won ? "Victoire !" : "Défaite…"}</h2>
        <p>${escapeHtml(TEAMS[winner] || "")} ${winner === "wolves" ? "ont" : "a"} gagné.</p>
      </div>
      <div class="panel"><h3>Les rôles de chacun</h3>
        <ul class="reveal-list">${players.map((p) => `<li class="${p.alive ? "" : "is-dead"}"><strong>${escapeHtml(p.name)}</strong>${roleBadge(reveal[p.id])}</li>`).join("")}</ul>
        <p class="muted small">Le meneur peut lancer une nouvelle partie.</p>
      </div>`;
  }

  // ------------------------------------------------------------
  // Événements
  // ------------------------------------------------------------
  const send = (button, task) => runAction(button, task).then(render);

  delegate(root, "click", {
    "toggle-card": () => { ui.showCard = !ui.showCard; render(); },
    "reveal-role": (button) => {
      // L'animation de retournement n'est jouée qu'au moment de la découverte.
      ui.justRevealed = true;
      setTimeout(() => { ui.justRevealed = false; render(); }, 1200);
      send(button, () => client.revealRole());
    },
    select: (button) => { ui.selected = button.dataset.id; render(); },
    "seer-confirm": (button) => send(button, () => client.sendNightAction(NIGHT_STEPS.SEER, { target: ui.selected })),
    "wolf-vote": (button) => send(button, () => client.sendNightAction(NIGHT_STEPS.WOLVES, { target: button.dataset.id })),
    "witch-save": () => { ui.witchSave = !ui.witchSave; render(); },
    "witch-confirm": (button) => send(button, () => client.sendNightAction(NIGHT_STEPS.WITCH, { save: ui.witchSave, kill: ui.witchKill || null })),
    "witch-skip": (button) => send(button, () => client.sendNightAction(NIGHT_STEPS.WITCH, { save: false, kill: null })),
    "vote-confirm": (button) => send(button, async () => {
      await client.vote(ui.selected);
      toast("Vote enregistré.", "success");
    })
  });

  root.addEventListener("change", (event) => {
    if (event.target.dataset.action === "witch-kill") {
      ui.witchKill = event.target.value;
      render();
    }
  });
}

