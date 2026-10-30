// =============================================================
// STOCKAGE FIREBASE (mode multijoueur réel)
// -------------------------------------------------------------
// Même API que LocalStore, mais branchée sur Firebase Realtime Database.
// Chaque appareil se connecte avec l'authentification ANONYME :
// l'identifiant `uid` sert d'identité de joueur et permet aux règles
// de sécurité (database.rules.json) de protéger les données secrètes.
// =============================================================
import { FIREBASE_SDK_VERSION } from "../config.js";

const SDK_FILES = ["firebase-app-compat.js", "firebase-auth-compat.js", "firebase-database-compat.js"];

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Chargement impossible : ${src}`));
    document.head.appendChild(script);
  });
}

/** Traduit les erreurs Firebase en messages compréhensibles. */
export function friendlyFirebaseError(error) {
  const code = String(error?.code || error?.message || "");
  if (/permission/i.test(code)) return "Action refusée par les règles de sécurité Firebase.";
  if (/network|unavailable|disconnect/i.test(code)) return "Connexion au serveur impossible. Vérifiez votre réseau.";
  if (/operation-not-allowed|admin-restricted/i.test(code)) return "Activez la connexion anonyme dans Firebase Authentication.";
  return error?.message || "Erreur Firebase inconnue.";
}

function wrap(promise) {
  return promise.catch((err) => { throw new Error(friendlyFirebaseError(err)); });
}

export class FirebaseStore {
  constructor(config) {
    this.mode = "firebase";
    this.config = config;
    this.offset = 0;
    this.connected = false;
    this.connectionListeners = new Set();
  }

  async init() {
    for (const file of SDK_FILES) {
      await loadScript(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/${file}`);
    }
    const firebase = window.firebase;
    if (!firebase.apps.length) firebase.initializeApp(this.config);

    this.auth = firebase.auth();
    await this.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    const existingUser = await new Promise((resolve) => {
      const off = this.auth.onAuthStateChanged((user) => { off(); resolve(user); });
    });
    const user = existingUser || (await wrap(this.auth.signInAnonymously())).user;
    this.uid = user.uid;

    this.db = firebase.database();
    // Décalage entre l'horloge locale et celle du serveur (minuteur identique sur tous les appareils).
    this.db.ref(".info/serverTimeOffset").on("value", (snap) => { this.offset = snap.val() || 0; });
    this.db.ref(".info/connected").on("value", (snap) => {
      this.connected = snap.val() === true;
      this.connectionListeners.forEach((cb) => cb(this.connected));
    });
    return this;
  }

  now() { return Date.now() + this.offset; }
  ref(path) { return this.db.ref(path); }

  async get(path) {
    const snapshot = await wrap(this.ref(path).get());
    return snapshot.val();
  }

  set(path, value) { return wrap(this.ref(path).set(value)); }
  update(path, values) { return wrap(this.ref(path).update(values)); }
  remove(path) { return wrap(this.ref(path).remove()); }

  async transaction(path, fn) {
    const result = await wrap(this.ref(path).transaction(fn));
    return { committed: result.committed, value: result.snapshot.val() };
  }

  subscribe(path, callback, onError) {
    const ref = this.ref(path);
    const handler = (snapshot) => callback(snapshot.val());
    ref.on("value", handler, (err) => (onError || console.error)(new Error(friendlyFirebaseError(err))));
    return () => ref.off("value", handler);
  }

  /** onDisconnect : le serveur passe `connected` à false si l'appareil disparaît. */
  setPresence(path) {
    const ref = this.ref(path);
    this.db.ref(".info/connected").on("value", (snap) => {
      if (snap.val() !== true) return;
      ref.onDisconnect().set(false)
        .then(() => ref.set(true))
        .catch((err) => console.warn("[Firebase] présence", friendlyFirebaseError(err)));
    });
  }

  onConnectionChange(callback) {
    this.connectionListeners.add(callback);
    callback(this.connected);
  }
}
