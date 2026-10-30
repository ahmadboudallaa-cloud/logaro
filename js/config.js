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
  apiKey: "AIzaSyBeIMigPKEiwryU4wxvU2grEnfcG1s_kLo",
  authDomain: "thiercelieux-2a451.firebaseapp.com",
  databaseURL: "https://thiercelieux-2a451-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "thiercelieux-2a451",
  storageBucket: "thiercelieux-2a451.firebasestorage.app",
  messagingSenderId: "1015955798068",
  appId: "1:1015955798068:web:53381fbd525437d6f83261"
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

/** Configuration commencée mais incomplète : on préfère une erreur claire à un mode local silencieux. */
export function firebaseConfigProblem(config = firebaseConfig) {
  const filled = Object.values(config).some(Boolean);
  if (!filled || isFirebaseConfigured(config)) return null;
  const missing = ["apiKey", "databaseURL", "projectId"].filter((key) => !config[key]);
  return `Configuration Firebase incomplète dans js/config.js : ${missing.join(", ")} manquant. `
    + "Créez une « Realtime Database » dans la console Firebase et copiez son adresse dans databaseURL.";
}
