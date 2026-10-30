// =============================================================
// RÔLES : définitions, composition et distribution aléatoire
// =============================================================

export const ROLES = Object.freeze({
  wolf: {
    id: "wolf",
    name: "Loup-Garou",
    article: "un",
    team: "wolves",
    color: "#9b1c1c",
    icon: "claw",
    description: "Chaque nuit, vous vous réveillez avec la meute pour dévorer un villageois. Le jour, cachez votre identité.",
    actions: ["La nuit : choisir une victime avec les autres loups.", "Le jour : débattre et voter comme un villageois."]
  },
  seer: {
    id: "seer",
    name: "Voyante",
    article: "une",
    team: "village",
    color: "#5b3fb5",
    icon: "eye",
    description: "Chaque nuit, vous pouvez sonder l'âme d'un joueur et découvrir s'il est Loup-Garou.",
    actions: ["La nuit : découvrir si un joueur est Loup-Garou.", "Le jour : guider le village sans vous dévoiler."]
  },
  witch: {
    id: "witch",
    name: "Sorcière",
    article: "une",
    team: "village",
    color: "#1f7a5a",
    icon: "flask",
    description: "Vous possédez une potion de vie et une potion de mort. Chacune ne peut servir qu'une seule fois dans la partie.",
    actions: ["La nuit : sauver la victime des loups (potion de vie).", "La nuit : éliminer un joueur (potion de mort)."]
  },
  villager: {
    id: "villager",
    name: "Villageois",
    article: "un",
    team: "village",
    color: "#8a6a2f",
    icon: "home",
    description: "Vous n'avez aucun pouvoir, seulement votre intuition. Démasquez les Loups-Garous.",
    actions: ["Le jour : débattre et voter pour éliminer un suspect."]
  }
});

export const TEAMS = Object.freeze({
  village: "Le Village",
  wolves: "Les Loups-Garous"
});

export function isWolf(roleId) {
  return roleId === "wolf";
}

export function roleName(roleId) {
  return ROLES[roleId]?.name || "Inconnu";
}

/** Composition conseillée selon le nombre de joueurs. */
export function suggestRoleConfig(playerCount) {
  return {
    wolf: playerCount >= 12 ? 3 : playerCount >= 7 ? 2 : 1,
    seer: true,
    witch: playerCount >= 5
  };
}

/** Vérifie qu'une composition est jouable pour `playerCount` joueurs. */
export function validateRoleConfig(config, playerCount) {
  const wolves = Number(config?.wolf);
  if (!Number.isInteger(wolves) || wolves < 1) {
    return { ok: false, error: "Il faut au moins un Loup-Garou." };
  }
  const specials = wolves + (config.seer ? 1 : 0) + (config.witch ? 1 : 0);
  if (specials > playerCount) {
    return { ok: false, error: `Trop de rôles (${specials}) pour ${playerCount} joueur(s).` };
  }
  if (wolves >= playerCount - wolves) {
    return { ok: false, error: "Trop de loups : ils seraient déjà aussi nombreux que les villageois." };
  }
  return { ok: true };
}

/** Construit le paquet de cartes : loups, rôles spéciaux, puis villageois. */
export function buildRoleDeck(config, playerCount) {
  const deck = [];
  for (let i = 0; i < config.wolf; i++) deck.push("wolf");
  if (config.seer) deck.push("seer");
  if (config.witch) deck.push("witch");
  while (deck.length < playerCount) deck.push("villager");
  return deck;
}

/** Mélange de Fisher-Yates (retourne une nouvelle liste). */
export function shuffle(list, random = Math.random) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Attribue un rôle à chaque joueur : { playerId: roleId }. */
export function assignRoles(playerIds, config, random = Math.random) {
  const deck = shuffle(buildRoleDeck(config, playerIds.length), random);
  const roles = {};
  playerIds.forEach((id, index) => { roles[id] = deck[index]; });
  return roles;
}

/** Texte lisible d'une composition : « 2 Loups-Garous, Voyante, 3 Villageois ». */
export function describeComposition(config, playerCount) {
  const villagers = playerCount - config.wolf - (config.seer ? 1 : 0) - (config.witch ? 1 : 0);
  const parts = [`${config.wolf} Loup${config.wolf > 1 ? "s" : ""}-Garou${config.wolf > 1 ? "s" : ""}`];
  if (config.seer) parts.push("Voyante");
  if (config.witch) parts.push("Sorcière");
  if (villagers > 0) parts.push(`${villagers} Villageois`);
  return parts.join(", ");
}
