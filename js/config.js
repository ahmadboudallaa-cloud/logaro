// =============================================================
// CONFIGURATION GÉNÉRALE
// -------------------------------------------------------------
// 1. Collez ici la configuration de votre projet Firebase
//    (console Firebase > Paramètres du projet > Vos applications).
// 2. Si les champs restent vides, l'application démarre en MODE LOCAL
//    (synchronisation entre onglets d'un même navigateur).
// 3. Ajoutez ?mode=local à l'URL pour forcer le mode local même
//    si Firebase est configuré.
// =============================================================

export const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  databaseURL: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

// Version du SDK Firebase chargée depuis le CDN officiel (gstatic).
export const FIREBASE_SDK_VERSION = "10.12.2";

// Limites du jeu.
export const GAME_LIMITS = {
  minPlayers: 4,
  maxPlayers: 20
};

// Réglages par défaut d'une salle (modifiables par le meneur).
export const DEFAULT_SETTINGS = {
  durations: {
    night: 45,   // secondes par étape de nuit
    debate: 180, // secondes de débat
    vote: 60     // secondes de vote
  },
  autoAdvance: true, // passer automatiquement à la suite quand le minuteur atteint 0
  tieRule: "none",   // "none" | "revote" | "random"
  roles: null        // null = composition suggérée automatiquement
};

/** Fusionne les réglages enregistrés avec les valeurs par défaut. */
export function mergeSettings(saved = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    durations: { ...DEFAULT_SETTINGS.durations, ...(saved.durations || {}) }
  };
}

/** Firebase est considéré comme configuré si les champs essentiels sont remplis. */
export function isFirebaseConfigured(config = firebaseConfig) {
  return Boolean(config.apiKey && config.databaseURL && config.projectId);
}
