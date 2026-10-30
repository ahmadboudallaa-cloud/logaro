// =============================================================
// UTILITAIRES D'INTERFACE (partagés par les vues meneur et joueur)
// =============================================================

export const $ = (selector, root = document) => root.querySelector(selector);

/** Protège contre l'injection HTML : tout texte saisi par un joueur passe par ici. */
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

/** Ne remplace le contenu que s'il a changé (évite de perdre le focus ou une sélection). */
export function setHtml(element, html) {
  if (element && element.__html !== html) {
    element.innerHTML = html;
    element.__html = html;
  }
}

/**
 * Délégation d'événements : un seul écouteur pour tous les éléments
 * portant data-action="nom". Les gestionnaires reçoivent (élément, événement).
 */
export function delegate(root, eventName, handlers) {
  root.addEventListener(eventName, (event) => {
    const target = event.target.closest("[data-action]");
    if (!target || !root.contains(target)) return;
    const handler = handlers[target.dataset.action];
    if (handler) handler(target, event);
  });
}

export function toast(message, type = "info") {
  const container = $("#toasts");
  if (!container) return;
  const item = document.createElement("div");
  item.className = `toast toast-${type}`;
  item.textContent = message;
  container.appendChild(item);
  setTimeout(() => item.classList.add("is-leaving"), 3600);
  setTimeout(() => item.remove(), 4000);
}

/** Exécute une action asynchrone : bouton désactivé pendant l'appel, erreur affichée en notification. */
export async function runAction(button, task) {
  if (button) button.disabled = true;
  try {
    await task();
    return true;
  } catch (err) {
    console.error(err);
    toast(err.message || "Une erreur est survenue.", "error");
    return false;
  } finally {
    if (button) button.disabled = false;
  }
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const input = document.createElement("textarea");
    input.value = text;
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }
}

/** Construit une URL de l'application en conservant ?mode=local si présent. */
export function buildUrl(params) {
  const url = new URL(location.pathname, location.origin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  if (new URLSearchParams(location.search).get("mode") === "local") url.searchParams.set("mode", "local");
  return url.toString();
}

export function replaceUrl(params) {
  history.replaceState(null, "", buildUrl(params));
}

export function renderQrCode(element, text) {
  element.innerHTML = "";
  if (!window.QRCode) {
    element.innerHTML = '<p class="muted small">QR code indisponible (bibliothèque non chargée, connexion internet requise).</p>';
    return;
  }
  new window.QRCode(element, {
    text,
    width: 220,
    height: 220,
    colorDark: "#0b1020",
    colorLight: "#f4f1e8",
    correctLevel: window.QRCode.CorrectLevel.M
  });
}

// Préférences d'affichage (localStorage) : simples confort, jamais l'état du jeu.
export function loadPref(key, fallback) {
  try {
    const value = localStorage.getItem(`thiercelieux:pref:${key}`);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function savePref(key, value) {
  try { localStorage.setItem(`thiercelieux:pref:${key}`, JSON.stringify(value)); } catch { /* ignoré */ }
}
