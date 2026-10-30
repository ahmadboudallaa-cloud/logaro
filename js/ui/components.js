// =============================================================
// COMPOSANTS HTML RÉUTILISÉS PAR LES DEUX INTERFACES
// =============================================================
import { ROLES, TEAMS } from "../core/roles.js";
import { PHASE_LABELS, STEP_LABELS } from "../core/constants.js";
import { escapeHtml } from "./dom.js";
import { icon } from "./icons.js";

export function roleBadge(roleId) {
  const role = ROLES[roleId];
  if (!role) return "";
  return `<span class="role-badge" style="--role:${role.color}">${icon(role.icon)}${role.name}</span>`;
}

/** Face visible d'une carte de rôle. */
export function roleCardFace(roleId, { compact = false } = {}) {
  const role = ROLES[roleId];
  if (!role) return "";
  const actions = role.actions.map((a) => `<li>${escapeHtml(a)}</li>`).join("");
  return `
    <div class="role-face ${compact ? "is-compact" : ""}" style="--role:${role.color}">
      <div class="role-emblem">${icon(role.icon)}</div>
      <p class="role-team">${TEAMS[role.team]}</p>
      <h3 class="role-name">${role.name}</h3>
      ${compact ? "" : `<p class="role-description">${escapeHtml(role.description)}</p><ul class="role-actions">${actions}</ul>`}
    </div>`;
}

/** Dos de carte (avant la découverte du rôle). */
export function cardBack() {
  return `
    <div class="card-back">
      <div class="card-back-moon">${icon("moon")}</div>
      <p>Thiercelieux</p>
    </div>`;
}

export function phaseTitle(pub) {
  const label = PHASE_LABELS[pub.phase] || "";
  if (pub.phase === "NIGHT") return `Nuit ${pub.round}${pub.nightStep ? ` · ${STEP_LABELS[pub.nightStep]}` : ""}`;
  if (pub.phase === "DAY") return `Jour ${pub.round}`;
  return label;
}

export function emptyState(text) {
  return `<p class="muted empty">${escapeHtml(text)}</p>`;
}
