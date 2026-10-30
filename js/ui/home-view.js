// =============================================================
// PAGE D'ACCUEIL : créer une salle (meneur) ou rejoindre (joueur)
// =============================================================
import { normalizeRoomCode } from "../core/rules.js";
import { icon } from "./icons.js";
import { joinFormHtml } from "./player-view.js";
import { escapeHtml, buildUrl, runAction } from "./dom.js";

export function mountHomeView(root, { store, onCreateRoom, onJoin }) {
  let lastRoom = null;
  try { lastRoom = localStorage.getItem("thiercelieux:lastHostRoom"); } catch { /* ignoré */ }
  document.body.dataset.phase = "HOME";

  root.innerHTML = `
    <section class="home">
      <header class="home-hero">
        <div class="hero-moon">${icon("moon")}</div>
        <h1>Thiercelieux</h1>
        <p class="tagline">Les Loups-Garous rôdent. Le village saura-t-il les démasquer ?</p>
        <span class="mode-badge mode-${store.mode}">${store.mode === "firebase" ? "Multijoueur Firebase" : "Mode local (onglets d'un même navigateur)"}</span>
      </header>
      <div class="home-grid">
        <article class="panel home-card">
          <h2>${icon("crown")}Meneur</h2>
          <p class="muted">Créez une salle sur l'ordinateur, projetez-la et pilotez la partie.</p>
          <button class="btn btn-primary btn-large" data-action="create">${icon("plus")}Créer une salle</button>
          ${lastRoom ? `<a class="btn btn-ghost" href="${buildUrl({ host: lastRoom })}">${icon("rotate")}Reprendre la salle ${escapeHtml(lastRoom)}</a>` : ""}
        </article>
        <article class="panel home-card">
          <h2>${icon("user")}Joueur</h2>
          <p class="muted">Entrez le code affiché par le meneur ou scannez le QR code.</p>
          ${joinFormHtml()}
        </article>
      </div>
    </section>`;

  root.querySelector('[data-action="create"]').addEventListener("click", (event) => {
    runAction(event.currentTarget, onCreateRoom);
  });

  root.querySelector("[data-join-form]").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const code = normalizeRoomCode(form.code.value);
    if (!code) {
      form.querySelector("[data-join-error]").textContent = "Le code doit contenir 4 lettres.";
      return;
    }
    onJoin(code, form.name.value);
  });
}
