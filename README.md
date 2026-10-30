# Thiercelieux — Loup-Garou multijoueur

Application web temps réel pour jouer aux *Loups-Garous de Thiercelieux* :
le **meneur** pilote la partie sur un ordinateur (et un vidéoprojecteur),
les **joueurs** rejoignent depuis leur téléphone par QR code.

- HTML, CSS et JavaScript vanilla (modules ES), sans framework ni étape de compilation.
- **Mode local** : tous les onglets d'un même navigateur communiquent via `localStorage`.
- **Mode multijoueur** : Firebase Realtime Database et authentification anonyme.

---

## 1. Lancer le projet

Les modules ES (`<script type="module">`) ne fonctionnent pas en ouvrant `index.html`
par double-clic (`file://`). Il faut un serveur HTTP :

```bash
npm start          # = node serve.js (aucune dépendance à installer)
```

Puis ouvrir `http://localhost:8080`. Le serveur affiche aussi l'adresse du réseau local
(ex. `http://192.168.1.20:8080`), utile pour les téléphones en mode Firebase.
L'extension VS Code « Live Server » ou `npx serve` fonctionnent aussi.

### Tester en mode local (sans Firebase)

1. Laisser `firebaseConfig` vide dans `js/config.js`.
2. Onglet 1 : **Créer une salle** (vous êtes le meneur).
3. Cliquer sur **Onglet joueur** dans le panneau « Invitation » (ou coller le lien dans un nouvel onglet)
   — répéter pour au moins 4 joueurs.
4. Chaque onglet a sa propre identité (stockée dans `sessionStorage`) : on peut jouer
   tous les rôles depuis le même ordinateur.

> Astuce : ne pas utiliser « Dupliquer l'onglet » pour créer un joueur. Le navigateur copie alors
> `sessionStorage`, et le nouvel onglet reprend l'identité de l'onglet d'origine.

### Tests automatiques

```bash
npm test
```

14 tests (`tests/game.test.js`) : règles pures, puis des parties complètes simulées avec
un meneur et plusieurs joueurs qui partagent une base en mémoire (voyante, loups, sorcière,
votes, égalités, victoires, retardataire, réinitialisation…).

---

## 2. Architecture

```
index.html                 Page unique (les vues sont générées en JavaScript)
css/style.css              Design (thème nocturne, mobile first, tableau de bord meneur)
js/
  config.js                Configuration Firebase, limites et réglages par défaut
  app.js                   Point d'entrée : choisit le stockage et la vue selon l'URL
  core/                    LOGIQUE DU JEU (aucun accès au DOM → testable sous Node)
    constants.js           Phases, étapes de nuit, libellés
    roles.js               Rôles, composition conseillée, distribution aléatoire
    rules.js               Règles pures : votes, victoire, nuit, prénoms, codes
    timer.js               Minuteur synchronisé (basé sur une heure de fin)
    narrator.js            Fonction centrale narrate(clé, données)
    engine.js              HostEngine : machine à états, exécutée chez le meneur
    player-client.js       PlayerClient : actions et lectures d'un joueur
  store/                   STOCKAGE (même API pour les deux modes)
    local-store.js         localStorage + événement « storage »
    firebase-store.js      Firebase Realtime Database + authentification anonyme
    index.js               Choix automatique du mode
  ui/                      INTERFACES
    dom.js                 Utilitaires : échappement HTML, délégation, notifications…
    icons.js               Icônes SVG (aucun emoji)
    components.js          Carte de rôle, badges…
    home-view.js           Accueil (créer / rejoindre)
    host-view.js           Tableau de bord du meneur
    player-view.js         Écran du joueur
database.rules.json        Règles de sécurité Firebase
firebase.json              Configuration du déploiement Firebase Hosting
serve.js                   Mini serveur HTTP de développement
tests/game.test.js         Tests automatiques
```

### Le principe : le meneur fait autorité

```
 Téléphone joueur ──écrit son intention──►  Base (locale ou Firebase)  ◄──écoute── Navigateur du meneur
 (vote, action de nuit,                     │                                     (HostEngine)
  « j'ai vu ma carte »)                     │◄──── écrit la transition validée ───┘
                                            └──── tout le monde reçoit le nouvel état
```

1. Un joueur ne modifie jamais directement l'état de la partie. Il écrit uniquement
   **ses** données : son vote (`public/votes/{uid}`) ou son action de nuit (`actions/{uid}`).
2. `HostEngine` (dans l'onglet du meneur) reçoit chaque changement, **valide** l'action
   (bon tour, bonne étape, joueur vivant, cible valide, potion disponible…) puis fait avancer
   la machine à états.
3. Chaque transition est écrite en **une seule mise à jour multi-chemins**
   (`store.update(base, { "public/phase": ..., "private/x/...": ... })`), atomique sur Firebase.
4. Toutes les opérations du moteur passent par une file (`exclusive()`) : deux transitions
   ne peuvent jamais se chevaucher, même si plusieurs joueurs agissent en même temps.

### Structure des données

```
rooms/
  ABCD/
    meta/          { hostUid, createdAt, mode }              lisible par tous
    public/        état visible par tous les joueurs
      phase, round, nightStep, timer, narrator, settings
      players/{uid}  { name, joinedAt, connected, roleSeen, inGame, alive, revealedRole }
      votes/{uid}    uid de la cible
      voteCandidates, isRevote, lastNight, lastResult, winner, revealAll
    names/{prénom normalisé}   uid du propriétaire (prénoms uniques)
    private/{uid}  { role, wolfTeam, wolfVotes, visions, witchInfo }   lisible par CE joueur seulement
    actions/{uid}  { round, step, target | save, kill }               action de nuit du joueur
    host/          { roles, potions, night, history }                 réservé au meneur
```

Les rôles ne sont **jamais** dans `public/` pendant la partie. Seuls apparaissent le rôle d'un joueur
mort (`revealedRole`) et, à la fin, tous les rôles (`revealAll`).

---

## 3. Fonctions principales

| Fichier | Fonction | Rôle |
|---|---|---|
| `engine.js` | `HostEngine.createRoom(store)` | Génère un code libre de 4 lettres et crée la salle |
| | `start()` | Vérifie que l'on est le meneur, puis écoute la salle |
| | `react()` | Réactions automatiques : actions de nuit, fin du vote, minuteur expiré, présence |
| | `startGame()` | Vérifie le nombre de joueurs et la composition, puis distribue les rôles |
| | `startNight({force})` | Ouvre une nuit et réveille le premier rôle vivant |
| | `enterStep` / `advanceNight` / `finishNight` | Enchaînement Voyante → Loups → Sorcière → aube |
| | `skipStep()` / `forceNightStep()` | Passer une étape (joueur absent ou minuteur écoulé) |
| | `startVote()` / `closeVote()` / `revote()` | Vote du village et second vote |
| | `applyElimination` / `applyEnd` | Élimination, vérification de victoire, fin de partie |
| | `newGame()` / `resetRoom()` / `removePlayer()` | Gestion de la salle |
| `player-client.js` | `join(name)` | Valide le prénom, le réserve par transaction, inscrit le joueur |
| | `vote(id)` / `sendNightAction(step, data)` | Actions du joueur, vérifiées avant l'envoi |
| `rules.js` | `checkWinner`, `countVotes`, `getTopCandidates`, `resolveWolfVotes`, `resolveNightDeaths` | Règles pures |
| `roles.js` | `suggestRoleConfig`, `validateRoleConfig`, `assignRoles`, `shuffle` | Composition et tirage |
| `narrator.js` | `narrate(clé, données)` | Tous les textes du narrateur |
| `timer.js` | `createTimer`, `remainingMs`, `pauseTimer`, `resumeTimer`, `addTime` | Minuteur |

---

## 4. Déroulement des phases

```
WAITING ──startGame──► ROLE_REVEAL ──startNight──► NIGHT ──(fin des étapes)──► DAY
                                                     ▲                           │ startVote (ou fin du minuteur)
                                                     │                           ▼
                           RESULT ◄──closeVote (ou tous ont voté / minuteur)── VOTING
                             │  └─(égalité)── revote ──► VOTING
                             └──startNight──► NIGHT …

À chaque mort (nuit ou vote) : vérification de victoire → END
END ──newGame──► WAITING (mêmes joueurs)
```

| Phase | Ce qui se passe |
|---|---|
| **WAITING** | Les joueurs rejoignent. Le bouton de démarrage est actif dès 4 joueurs et une composition valide. |
| **ROLE_REVEAL** | Chaque joueur touche « Découvrir mon rôle ». Le meneur voit qui a regardé sa carte et peut forcer la suite. |
| **NIGHT** | Étapes dans l'ordre : Voyante, puis Loups-Garous, puis Sorcière. Une étape est sautée si le rôle est mort. Elle avance seule dès que le rôle a agi, sinon à la fin du minuteur ou sur « Passer l'étape ». Les loups doivent tous choisir la même victime. S'ils sont forcés, le choix majoritaire est retenu, avec un tirage au sort en cas d'égalité. |
| **DAY** | Le narrateur annonce les morts de la nuit (avec leur rôle). Débat minuté. |
| **VOTING** | Chaque vivant vote une seule fois, pas pour lui-même. Décompte en direct. Clôture automatique quand tout le monde a voté. |
| **RESULT** | Joueur éliminé, son rôle et ses votes. En cas d'égalité, la règle choisie s'applique : personne n'est éliminé (avec possibilité de second vote), second vote automatique, ou tirage au sort. |
| **END** | Écran de victoire, minuteur arrêté, actions bloquées, rôles révélés, bouton « Nouvelle partie ». |

**Minuteur** : on stocke l'heure de fin (`endsAt`) et non le temps restant. Chaque appareil calcule
`endsAt - maintenant`. Avec Firebase, `.info/serverTimeOffset` corrige le décalage d'horloge
de chaque appareil. Le meneur peut mettre en pause, ajouter 30 s ou relancer le minuteur.
Si « Enchaîner à la fin du minuteur » est coché, l'expiration fait avancer la partie.

---

## 5. Conditions de victoire (`rules.js → checkWinner`)

- **Village** : plus aucun Loup-Garou vivant.
- **Loups-Garous** : loups vivants ≥ autres joueurs vivants.

La vérification a lieu après chaque mort : à l'aube (`finishNight`) et après un vote
(`applyElimination`).

---

## 6. Communication avec Firebase

`store/firebase-store.js` expose la même API que le stockage local :

| Méthode | Firebase |
|---|---|
| `get(path)` | `ref.get()` |
| `set` / `update` / `remove` | `ref.set()` / `ref.update()` (multi-chemins, atomique) / `ref.remove()` |
| `transaction(path, fn)` | `ref.transaction()` — utilisé pour réserver un prénom sans doublon |
| `subscribe(path, cb)` | `ref.on("value")` — temps réel |
| `setPresence(path)` | `.info/connected` + `onDisconnect().set(false)` — détecte un téléphone fermé |
| `now()` | `Date.now() + serverTimeOffset` |

Chaque appareil se connecte avec l'**authentification anonyme**. L'`uid` obtenu est l'identité
du joueur, conservée après un rechargement ou une fermeture du navigateur. C'est aussi lui
qui permet aux règles de sécurité de savoir qui écrit.

### Configurer Firebase (≈ 10 minutes)

1. Créer un projet sur <https://console.firebase.google.com>.
2. **Build → Realtime Database → Créer une base de données** (mode verrouillé).
3. **Build → Authentication → Commencer → Méthode de connexion → Anonyme → Activer.**
4. **Paramètres du projet → Vos applications → Web (`</>`)** : enregistrer l'application
   et copier l'objet de configuration dans `js/config.js` (`firebaseConfig`).
   Vérifier que `databaseURL` est bien présent.
5. **Realtime Database → Règles** : coller le contenu de `database.rules.json` et publier
   (ou `firebase deploy --only database`).
6. Recharger l'application : le badge indique « Multijoueur Firebase ».

> Pour tester le mode Firebase sur un seul ordinateur, utilisez des navigateurs différents ou des
> fenêtres privées. Dans un même navigateur, tous les onglets partagent la même identité Firebase.
> L'application refuse d'ailleurs qu'un joueur rejoigne depuis le navigateur du meneur.
> `?mode=local` force le mode local même si Firebase est configuré.

### Mettre en ligne (Firebase Hosting)

```bash
npm install -g firebase-tools
firebase login
firebase use --add            # choisir votre projet
firebase deploy               # publie le site ET les règles de la base
```

Le site est alors accessible en HTTPS (`https://<projet>.web.app`) et le QR code pointe vers cette adresse.
Tout hébergeur statique convient aussi : GitHub Pages, Netlify, etc.

### Sécurité : ce qui est protégé, et les limites

Les règles (`database.rules.json`) sont **appliquées par le serveur Firebase**, pas par l'interface :

- `private/{uid}` (rôle, visions, infos de la sorcière, votes de la meute) n'est lisible que par
  ce joueur. `host/` (tous les rôles, potions, historique secret) et `actions/` ne sont lisibles
  que par le meneur.
- Un joueur ne peut écrire que ses propres champs : prénom (une seule fois), présence,
  carte vue, vote et action de nuit.
- Un vote est refusé par le serveur si : la phase n'est pas `VOTING`, l'électeur est mort ou
  a déjà voté, il vote pour lui-même, la cible est morte ou hors du second vote.
- Seul le créateur de la salle (`meta/hostUid`) peut modifier l'état de la partie.

**Limites du prototype** (à expliquer en soutenance) :

- Le meneur est un client de confiance : un meneur malveillant voit tout. C'est normal, puisqu'il
  connaît les rôles dans le jeu réel.
- La logique d'arbitrage tourne dans le navigateur du meneur. Si son onglet est fermé, la partie
  est en pause jusqu'à son retour (l'état est conservé et repris au rechargement).
- Les votes du jour sont publics : c'est voulu, ils se font à main levée dans le jeu.
- Pas de limite de débit ni de nettoyage automatique des vieilles salles.
- **Pour une vraie production**, il faudrait déplacer `HostEngine` dans des **Cloud Functions**
  déclenchées à chaque écriture dans `actions/` ou `public/votes/`. Le serveur deviendrait alors
  l'arbitre, et plus personne, pas même le meneur, ne lirait `host/`. Comme la logique est déjà
  séparée du DOM (`core/`), ce déplacement ne demanderait pas de la réécrire.
- **En mode local, il n'y a aucune sécurité** : tout est dans le `localStorage` du navigateur.
  Ce mode sert seulement à tester.

---

## 7. Cas limites gérés

| Cas | Comportement | Vérifié par |
|---|---|---|
| 1 joueur / minimum non atteint | Bouton désactivé avec explication ; le moteur refuse aussi | test + navigateur |
| Arrivée après le début | Le joueur rejoint en spectateur (« prochaine partie »), puis est inclus à la nouvelle partie | test |
| Prénom identique | Comparaison sans accents ni casse, réservation par transaction : refusé | test + navigateur |
| Prénom invalide / injection HTML | 1–16 caractères (lettres, chiffres, espace, `'`, `-`), et tout texte affiché est échappé | test |
| Code de salle inconnu | Message « Cette salle n'existe pas » | test |
| Navigateur fermé | `connected:false` (`pagehide` en local, `onDisconnect` sur Firebase) : point gris chez le meneur et entrée dans l'historique | navigateur |
| Rechargement d'un joueur | Même identité (`sessionStorage` / auth anonyme) : retour direct dans la partie | navigateur |
| Rechargement du meneur | `?host=ABCD` reprend la salle ; l'accueil propose aussi « Reprendre la salle » | navigateur |
| Joueur éliminé qui vote | Refusé (interface, client, règles Firebase et décompte du meneur) | test |
| Double vote | Refusé (`!data.exists()` côté serveur) | test |
| Vote pour soi-même | Non proposé dans l'interface et refusé à chaque niveau | test + navigateur |
| Tous les loups éliminés | Victoire du village | test + navigateur |
| Un seul loup restant | La partie continue tant qu'il est minoritaire | test |
| Égalité | Règle configurable (personne / second vote / tirage au sort) et bouton « Second vote » | test |
| Sorcière sans action | « Ne rien faire » | test + navigateur |
| Potion déjà utilisée | Bouton désactivé, refus côté client et côté moteur | test |
| Joueur qui ne répond pas la nuit | Fin du minuteur ou « Passer l'étape » | test |
| Loups en désaccord | La victime n'est retenue qu'à l'unanimité ; chaque loup voit les choix de la meute | test |
| Connexion Firebase coupée | Bandeau d'alerte ; le SDK met les écritures en attente et les renvoie au retour du réseau | non testé (pas de projet Firebase configuré) |
| Composition impossible | Trop de loups ou de rôles : message clair, démarrage bloqué | test |
| Retirer un joueur / réinitialiser | Le joueur retiré revient au formulaire avec un message | test + navigateur |

---

## 8. Interfaces

**Meneur** : code de la salle en grand, QR code, lien à copier, liste des joueurs (présence,
carte vue, vivant/mort, votes reçus), narrateur, minuteur, boutons adaptés à la phase, réglages
(rôles, durées, règle d'égalité) et historique.
Le bouton **« Secrets masqués / visibles »** cache les rôles et les actions de nuit quand l'écran est
projeté. Le bouton **« Voix »** lit le narrateur à voix haute (synthèse vocale du navigateur).

**Joueur** : prénom, statut, minuteur, carte secrète (retournement animé, consultable à tout moment
avec « Ma carte »), consignes de la phase et boutons d'action. Les joueurs sans action
voient « Fermez les yeux » pendant la nuit.
#   l o g a r o  
 