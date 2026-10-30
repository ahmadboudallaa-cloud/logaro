// =============================================================
// CHOIX AUTOMATIQUE DU STOCKAGE
// Firebase configuré → FirebaseStore ; sinon (ou ?mode=local) → LocalStore.
// =============================================================
import { firebaseConfig, isFirebaseConfigured } from "../config.js";
import { LocalStore } from "./local-store.js";
import { FirebaseStore } from "./firebase-store.js";

export function wantsLocalMode() {
  return new URLSearchParams(location.search).get("mode") === "local";
}

export async function createStore() {
  if (!isFirebaseConfigured() || wantsLocalMode()) return LocalStore.createForBrowser();
  try {
    return await new FirebaseStore(firebaseConfig).init();
  } catch (err) {
    const error = new Error(`Connexion à Firebase impossible : ${err.message}`);
    error.firebaseFailed = true;
    throw error;
  }
}
