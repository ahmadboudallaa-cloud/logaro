// =============================================================
// CONSTANTES : phases de la machine à états et étapes de la nuit
// WAITING → ROLE_REVEAL → NIGHT → DAY → VOTING → RESULT → NIGHT … → END
// =============================================================

export const PHASES = Object.freeze({
  WAITING: "WAITING",
  ROLE_REVEAL: "ROLE_REVEAL",
  NIGHT: "NIGHT",
  DAY: "DAY",
  VOTING: "VOTING",
  RESULT: "RESULT",
  END: "END"
});

export const PHASE_LABELS = Object.freeze({
  WAITING: "Salle d'attente",
  ROLE_REVEAL: "Distribution des rôles",
  NIGHT: "Nuit",
  DAY: "Jour",
  VOTING: "Vote du village",
  RESULT: "Résultat du vote",
  END: "Fin de partie"
});

export const NIGHT_STEPS = Object.freeze({
  SEER: "SEER",
  WOLVES: "WOLVES",
  WITCH: "WITCH"
});

// Ordre officiel des réveils pendant la nuit.
export const NIGHT_ORDER = Object.freeze([NIGHT_STEPS.SEER, NIGHT_STEPS.WOLVES, NIGHT_STEPS.WITCH]);

// Rôle qui agit à chaque étape.
export const STEP_ROLE = Object.freeze({
  SEER: "seer",
  WOLVES: "wolf",
  WITCH: "witch"
});

export const STEP_LABELS = Object.freeze({
  SEER: "La Voyante",
  WOLVES: "Les Loups-Garous",
  WITCH: "La Sorcière"
});

export const TIE_RULES = Object.freeze({
  none: "Personne n'est éliminé",
  revote: "Second vote entre les ex æquo",
  random: "Tirage au sort parmi les ex æquo"
});
