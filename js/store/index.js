// =============================================================
// CHOIX AUTOMATIQUE DU STOCKAGE
// Firebase configuré → FirebaseStore ; config vide (ou ?mode=local) → LocalStore.
// Config à moitié remplie → erreur explicite (sinon chaque téléphone
// serait en mode local et ne verrait pas la salle du meneur).
// =============================================================
import { firebaseConfig, isFirebaseConfigured, firebaseConfigProblem } from "../config.js";
import { LocalStore } from "./local-store.js";
import { FirebaseStore } from "./firebase-store.js";

export function wantsLocalMode() {
  return new URLSearchParams(location.search).get("mode") === "local";
}

function firebaseError(message) {
  const error = new Error(message);
  error.firebaseFailed = true;
  return error;
}

export async function createStore() {
  if (wantsLocalMode()) return LocalStore.createForBrowser();
  const problem = firebaseConfigProblem();
  if (problem) throw firebaseError(problem);
  if (!isFirebaseConfigured()) return LocalStore.createForBrowser();
  try {
    return await new FirebaseStore(firebaseConfig).init();
  } catch (err) {
    throw firebaseError(`Connexion à Firebase impossible : ${err.message}`);
  }
}
