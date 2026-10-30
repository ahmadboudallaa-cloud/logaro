// =============================================================
// POINT D'ENTRÉE DE L'APPLICATION
// -------------------------------------------------------------
// Routes (paramètres d'URL) :
//   index.html               → accueil
//   index.html?host=ABCD     → interface du meneur
//   index.html?room=ABCD     → interface joueur (lien du QR code)
//   …&mode=local             → force le mode local
// =============================================================
import { createStore, wantsLocalMode } from "./store/index.js";
import { HostEngine } from "./core/engine.js";
import { normalizeRoomCode } from "./core/rules.js";
import { mountHomeView } from "./ui/home-view.js";
import { mountHostView } from "./ui/host-view.js";
import { mountPlayerView } from "./ui/player-view.js";
import { $, escapeHtml, buildUrl } from "./ui/dom.js";
import { icon } from "./ui/icons.js";

async function boot() {
  const root = $("#app");
  let store;
  try {
    store = await createStore();
  } catch (err) {
    return renderFatal(root, err.message, err.firebaseFailed && !wantsLocalMode());
  }
  watchConnection(store);

  const params = new URLSearchParams(location.search);
  const hostCode = normalizeRoomCode(params.get("host"));
  const roomCode = normalizeRoomCode(params.get("room"));

  if (hostCode) return openHost(root, store, hostCode);
  if (params.has("room")) return mountPlayerView(root, { store, code: roomCode || "" });

  mountHomeView(root, {
    store,
    onCreateRoom: async () => {
      const code = await HostEngine.createRoom(store);
      location.href = buildUrl({ host: code });
    },
    onJoin: (code, name) => mountPlayerView(root, { store, code, name })
  });
}

async function openHost(root, store, code) {
  const engine = new HostEngine(store, code);
  try {
    await engine.start();
  } catch (err) {
    return renderFatal(root, err.message);
  }
  mountHostView(root, { store, engine, code });
}

function renderFatal(root, message, offerLocalMode = false) {
  const localUrl = new URL(location.href);
  localUrl.searchParams.set("mode", "local");
  root.innerHTML = `
    <section class="panel fatal">
      <h2>${icon("x")}Impossible de continuer</h2>
      <p>${escapeHtml(message)}</p>
      <div class="btn-row">
        <a class="btn btn-primary" href="${buildUrl({})}">Retour à l'accueil</a>
        ${offerLocalMode ? `<a class="btn btn-ghost" href="${escapeHtml(localUrl.toString())}">Utiliser le mode local</a>` : ""}
      </div>
    </section>`;
}

/** Bandeau affiché quand la connexion au serveur est perdue. */
function watchConnection(store) {
  const banner = $("#net-banner");
  let wasConnected = null;
  store.onConnectionChange((connected) => {
    // Firebase signale « déconnecté » pendant la toute première connexion : on l'ignore.
    if (wasConnected === null && !connected) { wasConnected = false; return; }
    banner.hidden = connected;
    wasConnected = connected;
  });
}

boot();
