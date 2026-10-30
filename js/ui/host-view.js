// =============================================================
// INTERFACE DU MENEUR (ordinateur / vidéoprojecteur)
// -------------------------------------------------------------
// La vue écoute le moteur (engine.onChange) et redessine chaque zone.
// Les boutons portent data-action="…" : un seul gestionnaire de clics
// (délégation) appelle la méthode correspondante du moteur.
// Les informations secrètes (rôles, actions de nuit) sont masquées
// par défaut, car l'écran est souvent projeté devant les joueurs.
// =============================================================
import { PHASES, NIGHT_ORDER, STEP_LABELS, TIE_RULES } from "../core/constants.js";
import { ROLES, TEAMS, suggestRoleConfig, validateRoleConfig, describeComposition } from "../core/roles.js";
import { listPlayers, countVotes } from "../core/rules.js";
import { remainingMs, formatDuration } from "../core/timer.js";
import { GAME_LIMITS, mergeSettings } from "../config.js";
import { icon } from "./icons.js";
import { roleBadge, phaseTitle, emptyState } from "./components.js";
import {
  $, escapeHtml, setHtml, delegate, toast, runAction, copyText, buildUrl, renderQrCode, loadPref, savePref
} from "./dom.js";

export function mountHostView(root, { store, engine, code }) {
  const prefs = { showSecrets: loadPref("host.showSecrets", false), voice: loadPref("host.voice", false) };
  const joinUrl = buildUrl({ room: code });
  let room = null;
  let lastNarratorAt = null;

  root.innerHTML = layoutHtml(code, joinUrl, store.mode);
  document.body.classList.add("is-host");
  renderQrCode($("#h-qr"), joinUrl);
  try { localStorage.setItem("thiercelieux:lastHostRoom", code); } catch { /* ignoré */ }

  const zones = {
    phase: $("#h-phase"), narrator: $("#h-narrator"), controls: $("#h-controls"), main: $("#h-main"),
    players: $("#h-players"), playerCount: $("#h-player-count"), history: $("#h-history"),
    composition: $("#h-composition"), timer: $("#h-timer"), timerControls: $("#h-timer-controls"), toggles: $("#h-toggles")
  };

  engine.onError = (err) => toast(err.message || String(err), "error");
  engine.onChange((nextRoom) => { room = nextRoom; render(); });
  setInterval(renderTimer, 250);

  // ------------------------------------------------------------
  // Données dérivées de la salle
  // ------------------------------------------------------------
  function viewModel() {
    const pub = room.public;
    const hostData = room.host || {};
    const players = listPlayers(pub.players);
    const living = players.filter((p) => p.inGame && p.alive);
    const livingIds = new Set(living.map((p) => p.id));
    const candidates = pub.voteCandidates ? new Set(Object.keys(pub.voteCandidates)) : livingIds;
    const { counts, valid } = countVotes(pub.votes || {}, { voterIds: livingIds, targetIds: candidates });
    return {
      pub, hostData, players, living,
      inGame: players.filter((p) => p.inGame),
      roles: hostData.roles || {},
      settings: mergeSettings(pub.settings),
      counts, votedIds: new Set(valid.map((v) => v.voter)),
      nameOf: (id) => players.find((p) => p.id === id)?.name || "?"
    };
  }

  // ------------------------------------------------------------
  // Rendu
  // ------------------------------------------------------------
  function render() {
    if (!room?.public) {
      root.innerHTML = `<section class="panel fatal"><h2>Salle introuvable</h2><p>La salle ${escapeHtml(code)} n'existe plus.</p><a class="btn" href="${buildUrl({})}">Retour à l'accueil</a></section>`;
      return;
    }
    const vm = viewModel();
    document.body.dataset.phase = vm.pub.phase;
    setHtml(zones.phase, `<span class="phase-label">${escapeHtml(phaseTitle(vm.pub))}</span>`);
    setHtml(zones.narrator, `<p>${escapeHtml(vm.pub.narrator?.text || "")}</p>`);
    setHtml(zones.toggles, togglesHtml());
    setHtml(zones.controls, controlsHtml(vm));
    setHtml(zones.main, mainHtml(vm));
    setHtml(zones.playerCount, `${vm.players.length}`);
    setHtml(zones.players, playersHtml(vm));
    setHtml(zones.history, historyHtml(vm));
    syncSettingsForm(vm);
    renderTimer();
    speakNarrator(vm.pub.narrator);
  }

  function togglesHtml() {
    return `
      <button class="btn btn-ghost" data-action="toggle-secrets" title="Afficher ou masquer les rôles et les actions secrètes">
        ${icon(prefs.showSecrets ? "eye" : "eyeOff")}${prefs.showSecrets ? "Secrets visibles" : "Secrets masqués"}
      </button>
      <button class="btn btn-ghost" data-action="toggle-voice" title="Lire les annonces du narrateur à voix haute">
        ${icon(prefs.voice ? "volume" : "volumeOff")}Voix
      </button>`;
  }

  function renderTimer() {
    const timer = room?.public?.timer;
    if (!timer) {
      zones.timer.textContent = "--:--";
      zones.timer.className = "timer is-idle";
      setHtml(zones.timerControls, "");
      return;
    }
    const ms = remainingMs(timer, store.now());
    zones.timer.textContent = formatDuration(ms);
    zones.timer.className = `timer ${timer.paused ? "is-paused" : ""} ${ms <= 10000 ? "is-urgent" : ""}`;
    setHtml(zones.timerControls, `
      ${timer.paused
        ? `<button class="btn btn-small" data-action="timer-resume" title="Reprendre">${icon("play")}</button>`
        : `<button class="btn btn-small" data-action="timer-pause" title="Pause">${icon("pause")}</button>`}
      <button class="btn btn-small" data-action="timer-add" title="Ajouter 30 secondes">${icon("plus")}30 s</button>
      <button class="btn btn-small" data-action="timer-restart" title="Recommencer le minuteur">${icon("rotate")}</button>`);
  }

  function controlsHtml(vm) {
    const { pub } = vm;
    const button = (action, label, iconName, kind = "btn-primary", disabled = false) =>
      `<button class="btn ${kind}" data-action="${action}" ${disabled ? "disabled" : ""}>${icon(iconName)}${label}</button>`;

    switch (pub.phase) {
      case PHASES.WAITING: {
        const reason = startBlocker(vm);
        return `${button("start-game", "Distribuer les rôles", "play", "btn-primary btn-large", Boolean(reason))}
          ${reason ? `<p class="hint">${escapeHtml(reason)}</p>` : ""}`;
      }
      case PHASES.ROLE_REVEAL: {
        const unseen = vm.inGame.filter((p) => !p.roleSeen).length;
        return unseen === 0
          ? button("start-night", "Lancer la nuit", "moon", "btn-primary btn-large")
          : `${button("force-night", `Forcer la nuit (${unseen} carte${unseen > 1 ? "s" : ""} non vue${unseen > 1 ? "s" : ""})`, "moon", "btn-warning")}
             <p class="hint">En attente que chaque joueur découvre sa carte.</p>`;
      }
      case PHASES.NIGHT:
        return `${button("skip-step", `Passer l'étape : ${STEP_LABELS[pub.nightStep] || ""}`, "skip", "btn-warning")}
          <p class="hint">L'étape avance seule dès que le rôle a joué. Utilisez ce bouton si un joueur ne répond pas.</p>`;
      case PHASES.DAY:
        return button("start-vote", "Passer au vote", "vote", "btn-primary btn-large");
      case PHASES.VOTING:
        return `${button("close-vote", `Clôturer le vote (${vm.votedIds.size}/${vm.living.length})`, "check", "btn-warning")}
          <p class="hint">Le vote se clôture seul quand tous les vivants ont voté.</p>`;
      case PHASES.RESULT:
        return `${button("start-night", `Lancer la nuit ${pub.round + 1}`, "moon", "btn-primary btn-large")}
          ${pub.lastResult?.type === "tie" ? button("revote", "Second vote entre ex æquo", "vote", "btn-secondary") : ""}`;
      case PHASES.END:
        return button("new-game", "Nouvelle partie (mêmes joueurs)", "rotate", "btn-primary btn-large");
      default:
        return "";
    }
  }

  function startBlocker(vm) {
    const n = vm.players.length;
    if (n < GAME_LIMITS.minPlayers) return `Il faut au moins ${GAME_LIMITS.minPlayers} joueurs (${n} connecté${n > 1 ? "s" : ""}).`;
    const check = validateRoleConfig(vm.settings.roles || suggestRoleConfig(n), n);
    return check.ok ? null : check.error;
  }

  function mainHtml(vm) {
    switch (vm.pub.phase) {
      case PHASES.WAITING: return lobbyHtml(vm);
      case PHASES.ROLE_REVEAL: return revealProgressHtml(vm);
      case PHASES.NIGHT: return nightHtml(vm);
      case PHASES.DAY: return nightSummaryHtml(vm.pub.lastNight);
      case PHASES.VOTING: return tallyHtml(vm, "Votes en cours");
      case PHASES.RESULT: return resultHtml(vm);
      case PHASES.END: return endHtml(vm);
      default: return "";
    }
  }

  function lobbyHtml(vm) {
    const n = vm.players.length;
    const config = vm.settings.roles || suggestRoleConfig(n);
    return `
      <div class="lobby-hero">
        <p class="eyebrow">Rejoignez la partie sur votre téléphone</p>
        <div class="big-code">${escapeHtml(code)}</div>
        <p class="muted">${n} joueur${n > 1 ? "s" : ""} dans la salle · minimum ${GAME_LIMITS.minPlayers}</p>
        ${n >= 1 ? `<p class="composition">${icon("users")}Composition : ${escapeHtml(describeComposition(config, Math.max(n, config.wolf + 1)))}</p>` : ""}
      </div>`;
  }

  function revealProgressHtml(vm) {
    const seen = vm.inGame.filter((p) => p.roleSeen).length;
    const total = vm.inGame.length;
    const missing = vm.inGame.filter((p) => !p.roleSeen).map((p) => escapeHtml(p.name));
    return `
      <div class="progress-block">
        <p class="big-number">${seen}<span>/${total}</span></p>
        <p class="muted">cartes découvertes</p>
        <div class="progress"><div style="width:${total ? (seen / total) * 100 : 0}%"></div></div>
        ${missing.length ? `<p class="hint">En attente : ${missing.join(", ")}</p>` : `<p class="ok-text">${icon("check")}Tout le monde connaît son rôle.</p>`}
      </div>`;
  }

  function nightHtml(vm) {
    const current = vm.pub.nightStep;
    const currentIndex = NIGHT_ORDER.indexOf(current);
    const steps = NIGHT_ORDER.map((step, index) => {
      const state = index < currentIndex ? "is-done" : index === currentIndex ? "is-active" : "";
      return `<li class="${state}">${escapeHtml(STEP_LABELS[step])}</li>`;
    }).join("");
    return `<ol class="night-steps">${steps}</ol>${prefs.showSecrets ? nightSecretsHtml(vm) : secretsHiddenHtml()}`;
  }

  function secretsHiddenHtml() {
    return `<p class="muted secret-hidden">${icon("lock")}Actions de la nuit masquées (mode projection). Cliquez sur « Secrets masqués » pour les afficher.</p>`;
  }

  /** Actions réalisées pendant la nuit (visibles uniquement en mode secrets). */
  function nightSecretsHtml(vm) {
    const night = vm.hostData.night || {};
    const potions = vm.hostData.potions || {};
    const actions = room.actions || {};
    const wolves = vm.living.filter((p) => vm.roles[p.id] === "wolf");
    const wolfChoices = wolves.map((w) => {
      const action = actions[w.id];
      const target = action && action.round === vm.pub.round && action.step === "WOLVES" ? vm.nameOf(action.target) : "…";
      return `<li>${escapeHtml(w.name)} → ${escapeHtml(target)}</li>`;
    }).join("");
    const seerLine = night.seerTarget
      ? `${escapeHtml(vm.nameOf(night.seerTarget))} : ${night.seerResult ? "Loup-Garou" : "pas Loup-Garou"}`
      : "aucune vision pour l'instant";
    const witchLine = [
      night.witchSave ? `a sauvé ${escapeHtml(vm.nameOf(night.wolfTarget))}` : "",
      night.witchKill ? `a empoisonné ${escapeHtml(vm.nameOf(night.witchKill))}` : ""
    ].filter(Boolean).join(" et ") || "aucune potion utilisée cette nuit";
    return `
      <div class="secret-grid">
        <article class="secret-card" style="--role:${ROLES.seer.color}"><h4>${icon("eye")}Voyante</h4><p>${seerLine}</p></article>
        <article class="secret-card" style="--role:${ROLES.wolf.color}"><h4>${icon("claw")}Loups-Garous</h4>
          <ul>${wolfChoices || "<li>Aucun loup vivant</li>"}</ul>
          <p>Victime : <strong>${night.wolfTarget ? escapeHtml(vm.nameOf(night.wolfTarget)) : "pas encore choisie"}</strong></p></article>
        <article class="secret-card" style="--role:${ROLES.witch.color}"><h4>${icon("flask")}Sorcière</h4><p>${witchLine}</p>
          <p class="small muted">Potions restantes : vie ${potions.life ? "oui" : "non"} · mort ${potions.death ? "oui" : "non"}</p></article>
      </div>`;
  }

  function nightSummaryHtml(lastNight) {
    const deaths = lastNight?.deaths || [];
    if (!deaths.length) return `<div class="summary"><p class="big-text">${icon("sun")}Personne n'est mort cette nuit.</p></div>`;
    return `<div class="summary"><p class="eyebrow">Victime${deaths.length > 1 ? "s" : ""} de la nuit</p>
      <div class="death-list">${deaths.map((d) => `<div class="death-card">${icon("skull")}<strong>${escapeHtml(d.name)}</strong>${roleBadge(d.role)}</div>`).join("")}</div></div>`;
  }

  function tallyHtml(vm, title) {
    const candidates = vm.pub.voteCandidates ? vm.living.filter((p) => vm.pub.voteCandidates[p.id]) : vm.living;
    const max = Math.max(1, ...candidates.map((p) => vm.counts[p.id] || 0));
    const rows = [...candidates]
      .sort((a, b) => (vm.counts[b.id] || 0) - (vm.counts[a.id] || 0))
      .map((p) => {
        const count = vm.counts[p.id] || 0;
        return `<li><span class="tally-name">${escapeHtml(p.name)}</span>
          <span class="tally-bar"><span style="width:${(count / max) * 100}%"></span></span>
          <span class="tally-count">${count}</span></li>`;
      }).join("");
    return `<div class="tally"><p class="eyebrow">${title}${vm.pub.isRevote ? " · second vote" : ""}</p><ul>${rows}</ul>
      <p class="muted">${vm.votedIds.size} vote${vm.votedIds.size > 1 ? "s" : ""} sur ${vm.living.length}</p></div>`;
  }

  function resultHtml(vm) {
    const result = vm.pub.lastResult || {};
    if (result.type === "eliminated") {
      return `<div class="summary"><p class="eyebrow">Éliminé par le village</p>
        <div class="death-card is-large">${icon("skull")}<strong>${escapeHtml(result.name)}</strong>${roleBadge(result.role)}
        <span class="muted">${result.votes} vote${result.votes > 1 ? "s" : ""}${result.random ? " · tirage au sort" : ""}</span></div></div>`;
    }
    if (result.type === "tie") {
      return `<div class="summary"><p class="big-text">Égalité entre ${result.tiedNames.map(escapeHtml).join(", ")}</p>
        <p class="muted">${result.votes} vote(s) chacun · personne n'est éliminé. Vous pouvez organiser un second vote.</p></div>`;
    }
    return `<div class="summary"><p class="big-text">Aucun vote : personne n'est éliminé.</p></div>`;
  }

  function endHtml(vm) {
    const winner = vm.pub.winner;
    const reveal = vm.pub.revealAll || {};
    const cards = vm.inGame.map((p) => `
      <li class="${p.alive ? "" : "is-dead"}"><strong>${escapeHtml(p.name)}</strong>${roleBadge(reveal[p.id])}${p.alive ? "" : icon("skull", "dim")}</li>`).join("");
    return `<div class="victory victory-${winner}">
        <div class="victory-emblem">${icon(winner === "wolves" ? "claw" : "crown")}</div>
        <h2>Victoire : ${escapeHtml(TEAMS[winner] || "")}</h2>
      </div>
      <ul class="reveal-list">${cards}</ul>`;
  }

  function playersHtml(vm) {
    if (!vm.players.length) return emptyState("Aucun joueur pour l'instant. Scannez le QR code pour rejoindre.");
    const { pub } = vm;
    return vm.players.map((p) => {
      const tags = [];
      if (!p.inGame && pub.phase !== PHASES.WAITING) tags.push('<span class="tag">prochaine partie</span>');
      if (pub.phase === PHASES.ROLE_REVEAL && p.inGame) {
        tags.push(p.roleSeen ? `<span class="tag tag-ok">${icon("check")}carte vue</span>` : '<span class="tag">carte cachée</span>');
      }
      if (p.inGame && !p.alive) tags.push(`<span class="tag tag-dead">${icon("skull")}éliminé</span>`);
      const role = prefs.showSecrets || pub.phase === PHASES.END ? vm.roles[p.id] : p.revealedRole;
      if (p.inGame && role) tags.push(roleBadge(role));
      if (pub.phase === PHASES.VOTING && p.inGame && p.alive) {
        tags.push(`<span class="vote-count" title="Votes reçus">${vm.counts[p.id] || 0}</span>`);
        if (vm.votedIds.has(p.id)) tags.push(`<span class="tag tag-ok">${icon("check")}a voté</span>`);
      }
      const remove = pub.phase === PHASES.WAITING
        ? `<button class="icon-btn" data-action="remove-player" data-id="${escapeHtml(p.id)}" data-name="${escapeHtml(p.name)}" title="Retirer ${escapeHtml(p.name)}">${icon("x")}</button>`
        : "";
      return `<li class="player-row ${p.inGame && !p.alive ? "is-dead" : ""}">
        <span class="presence ${p.connected === false ? "is-off" : "is-on"}" title="${p.connected === false ? "Déconnecté" : "Connecté"}"></span>
        <span class="player-name">${escapeHtml(p.name)}</span>
        <span class="player-tags">${tags.join("")}</span>${remove}</li>`;
    }).join("");
  }

  function historyHtml(vm) {
    const events = Object.entries(vm.hostData.history || {})
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([, e]) => e)
      .filter((e) => prefs.showSecrets || !e.secret)
      .slice(0, 100);
    if (!events.length) return emptyState("Aucun événement.");
    return events.map((e) => `
      <li class="${e.secret ? "is-secret" : ""}">
        <time>${new Date(e.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</time>
        <span>${e.secret ? icon("lock") : ""}${escapeHtml(e.text)}</span>
      </li>`).join("");
  }

  // ------------------------------------------------------------
  // Formulaire des réglages
  // ------------------------------------------------------------
  function syncSettingsForm(vm) {
    const { settings, players, pub } = vm;
    const roles = settings.roles || suggestRoleConfig(Math.max(players.length, GAME_LIMITS.minPlayers));
    const values = {
      "role-wolf": roles.wolf, "role-seer": roles.seer, "role-witch": roles.witch,
      "durations/night": settings.durations.night, "durations/debate": settings.durations.debate,
      "durations/vote": settings.durations.vote, tieRule: settings.tieRule, autoAdvance: settings.autoAdvance
    };
    for (const [name, value] of Object.entries(values)) {
      const input = root.querySelector(`[name="${name}"]`);
      if (!input || input === document.activeElement) continue;
      if (input.type === "checkbox") input.checked = Boolean(value);
      else input.value = value;
    }
    const locked = pub.phase !== PHASES.WAITING;
    root.querySelectorAll("[data-role-input]").forEach((input) => { input.disabled = locked; });
    $("#h-roles-auto").disabled = locked || !settings.roles;
    const n = players.length;
    const check = n ? validateRoleConfig(roles, n) : { ok: true };
    setHtml(zones.composition, `
      <span class="${settings.roles ? "" : "tag"}">${settings.roles ? "Composition personnalisée" : "Composition automatique"}</span>
      ${n ? `<span class="${check.ok ? "muted" : "error-text"}">${escapeHtml(check.ok ? describeComposition(roles, Math.max(n, roles.wolf + 1)) : check.error)}</span>` : ""}`);
  }

  function readRoleInputs() {
    return {
      wolf: Number(root.querySelector('[name="role-wolf"]').value),
      seer: root.querySelector('[name="role-seer"]').checked,
      witch: root.querySelector('[name="role-witch"]').checked
    };
  }

  // ------------------------------------------------------------
  // Narrateur à voix haute (synthèse vocale du navigateur)
  // ------------------------------------------------------------
  function speakNarrator(narrator) {
    if (!narrator || narrator.at === lastNarratorAt) return;
    const isFirstRender = lastNarratorAt === null;
    lastNarratorAt = narrator.at;
    if (isFirstRender || !prefs.voice || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(narrator.text);
    utterance.lang = "fr-FR";
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  }

  // ------------------------------------------------------------
  // Événements
  // ------------------------------------------------------------
  const confirmThen = (message, task) => (button) => {
    if (window.confirm(message)) runAction(button, task);
  };

  delegate(root, "click", {
    "copy-link": (button) => runAction(button, async () => { await copyText(joinUrl); toast("Lien d'invitation copié.", "success"); }),
    "open-player-tab": () => window.open(joinUrl, "_blank", "noopener"),
    "toggle-qr": () => $("#h-invite").classList.toggle("is-collapsed"),
    "toggle-secrets": () => { prefs.showSecrets = !prefs.showSecrets; savePref("host.showSecrets", prefs.showSecrets); render(); },
    "toggle-voice": () => { prefs.voice = !prefs.voice; savePref("host.voice", prefs.voice); render(); },
    "start-game": (button) => runAction(button, () => engine.startGame()),
    "start-night": (button) => runAction(button, () => engine.startNight()),
    "force-night": confirmThen("Certains joueurs n'ont pas vu leur carte. Lancer la nuit quand même ?", () => engine.startNight({ force: true })),
    "skip-step": (button) => runAction(button, () => engine.skipStep()),
    "start-vote": (button) => runAction(button, () => engine.startVote()),
    "close-vote": (button) => runAction(button, () => engine.closeVote()),
    revote: (button) => runAction(button, () => engine.revote()),
    "new-game": (button) => runAction(button, () => engine.newGame()),
    "new-game-confirm": confirmThen("Arrêter la partie en cours et revenir à la salle d'attente (joueurs conservés) ?", () => engine.newGame()),
    "reset-room": confirmThen("Réinitialiser complètement la salle ? Tous les joueurs seront retirés.", () => engine.resetRoom()),
    "close-room": confirmThen("Fermer définitivement la salle ? Elle sera supprimée et les joueurs seront renvoyés à l'accueil.", async () => {
      await engine.closeRoom();
      try { localStorage.removeItem("thiercelieux:lastHostRoom"); } catch { /* ignoré */ }
      location.href = buildUrl({});
    }),
    "remove-player": (button) => {
      if (window.confirm(`Retirer ${button.dataset.name} de la salle ?`)) runAction(button, () => engine.removePlayer(button.dataset.id));
    },
    "timer-pause": (button) => runAction(button, () => engine.pauseTimer()),
    "timer-resume": (button) => runAction(button, () => engine.resumeTimer()),
    "timer-add": (button) => runAction(button, () => engine.addTime(30)),
    "timer-restart": (button) => runAction(button, () => engine.restartTimer()),
    "roles-auto": (button) => runAction(button, () => engine.updateSetting("roles", null))
  });

  root.addEventListener("change", (event) => {
    const input = event.target;
    if (input.dataset.roleInput !== undefined) {
      runAction(null, () => engine.updateSetting("roles", readRoleInputs()));
    } else if (input.dataset.setting) {
      const value = input.type === "checkbox" ? input.checked : input.value;
      runAction(null, () => engine.updateSetting(input.dataset.setting, value));
    }
  });
}

// ------------------------------------------------------------
// Squelette HTML (créé une seule fois)
// ------------------------------------------------------------
function layoutHtml(code, joinUrl, mode) {
  const tieOptions = Object.entries(TIE_RULES).map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
  return `
  <div class="host">
    <header class="host-top">
      <div class="brand">${icon("moon")}<span>Thiercelieux</span></div>
      <div class="room-code" title="Code de la salle">Salle <strong>${escapeHtml(code)}</strong></div>
      <div id="h-phase" class="phase-chip"></div>
      <div class="timer-box">${icon("timer")}<span id="h-timer" class="timer is-idle">--:--</span><div id="h-timer-controls" class="timer-controls"></div></div>
      <div id="h-toggles" class="host-toggles"></div>
      <span class="mode-badge mode-${mode}">${mode === "firebase" ? "Firebase" : "Mode local"}</span>
    </header>

    <aside class="host-left">
      <section id="h-invite" class="panel invite">
        <div class="panel-head"><h2>${icon("link")}Invitation</h2>
          <button class="icon-btn" data-action="toggle-qr" title="Afficher / masquer le QR code">${icon("eye")}</button></div>
        <div class="invite-body">
          <div id="h-qr" class="qr"></div>
          <p class="invite-url">${escapeHtml(joinUrl)}</p>
          <div class="btn-row">
            <button class="btn btn-secondary" data-action="copy-link">${icon("copy")}Copier le lien</button>
            ${mode === "local" ? `<button class="btn btn-ghost" data-action="open-player-tab">${icon("external")}Onglet joueur</button>` : ""}
          </div>
          ${mode === "local" ? '<p class="hint">Mode local : les joueurs doivent ouvrir le lien dans d\'autres onglets de ce navigateur.</p>' : ""}
          ${mode === "firebase" && ["localhost", "127.0.0.1"].includes(location.hostname)
            ? '<p class="error-text">Ce lien utilise « localhost » : les téléphones ne peuvent pas l\'ouvrir. Ouvrez la page avec l\'adresse « Réseau local » affichée par npm start, ou mettez le site en ligne.</p>'
            : ""}
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>${icon("users")}Joueurs <span id="h-player-count" class="count"></span></h2></div>
        <ul id="h-players" class="player-list"></ul>
      </section>
    </aside>

    <main class="host-center">
      <section id="h-narrator" class="narrator" aria-live="polite"></section>
      <section id="h-main" class="panel stage"></section>
      <section id="h-controls" class="controls"></section>
    </main>

    <aside class="host-right">
      <section class="panel settings">
        <div class="panel-head"><h2>${icon("sliders")}Réglages</h2></div>
        <fieldset>
          <legend>Rôles</legend>
          <label class="field-inline">Loups-Garous <input type="number" name="role-wolf" min="1" max="10" data-role-input></label>
          <label class="check"><input type="checkbox" name="role-seer" data-role-input> Voyante</label>
          <label class="check"><input type="checkbox" name="role-witch" data-role-input> Sorcière</label>
          <p id="h-composition" class="composition-line"></p>
          <button id="h-roles-auto" class="btn btn-small btn-ghost" data-action="roles-auto">${icon("rotate")}Composition automatique</button>
        </fieldset>
        <fieldset>
          <legend>Durées (secondes)</legend>
          <label class="field-inline">Action de nuit <input type="number" name="durations/night" min="10" max="600" data-setting="durations/night"></label>
          <label class="field-inline">Débat <input type="number" name="durations/debate" min="10" max="1800" data-setting="durations/debate"></label>
          <label class="field-inline">Vote <input type="number" name="durations/vote" min="10" max="600" data-setting="durations/vote"></label>
          <label class="check"><input type="checkbox" name="autoAdvance" data-setting="autoAdvance"> Enchaîner à la fin du minuteur</label>
        </fieldset>
        <fieldset>
          <legend>En cas d'égalité</legend>
          <select name="tieRule" data-setting="tieRule">${tieOptions}</select>
        </fieldset>
        <div class="danger-zone">
          <button class="btn btn-ghost" data-action="new-game-confirm">${icon("rotate")}Nouvelle partie</button>
          <button class="btn btn-danger" data-action="reset-room">${icon("rotate")}Réinitialiser la salle</button>
          <button class="btn btn-danger" data-action="close-room">${icon("trash")}Fermer la salle</button>
        </div>
      </section>
      <section class="panel history">
        <div class="panel-head"><h2>${icon("scroll")}Historique</h2></div>
        <ol id="h-history" class="history-list"></ol>
      </section>
    </aside>
  </div>`;
}

