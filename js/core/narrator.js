// =============================================================
// NARRATEUR : fonction centrale qui produit tous les textes annoncés
// Usage : narrate("dawn", { deaths: [...] })
// =============================================================
import { ROLES, TEAMS } from "./roles.js";

function joinNames(names) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} et ${names[names.length - 1]}`;
}

function withRole({ name, role }) {
  return `${name} (${ROLES[role]?.name || "rôle inconnu"})`;
}

const MESSAGES = {
  waiting: () => "Bienvenue à Thiercelieux. Les villageois se rassemblent sur la place du village…",
  rolesDealt: () => "Les cartes sont distribuées. Découvrez votre rôle en secret, sans le montrer à personne.",
  nightStart: () => "Le village s'endort. Tout le monde ferme les yeux.",
  seerWake: () => "La Voyante se réveille et désigne le joueur dont elle veut sonder l'âme.",
  wolvesWake: () => "Les Loups-Garous se réveillent, se reconnaissent et choisissent une victime.",
  witchWake: () => "La Sorcière se réveille. Elle découvre la victime des loups et peut utiliser ses potions.",
  dawn: ({ deaths }) => {
    if (!deaths.length) return "Le soleil se lève. Cette nuit, personne n'est mort.";
    const verb = deaths.length > 1 ? "ont été éliminés" : "a été éliminé";
    return `Le soleil se lève. Cette nuit, ${joinNames(deaths.map(withRole))} ${verb}.`;
  },
  debate: () => "Le village débat : qui sont les Loups-Garous ?",
  voteStart: () => "L'heure du vote a sonné. Chaque villageois désigne un suspect.",
  revote: ({ names }) => `Égalité ! Second vote entre ${joinNames(names)}.`,
  eliminated: ({ name, role, votes, random }) => {
    const roleInfo = ROLES[role];
    const how = random ? "après un tirage au sort entre les ex æquo" : `avec ${votes} vote${votes > 1 ? "s" : ""}`;
    return `Le village a tranché contre ${name}, ${how}. C'était ${roleInfo.article} ${roleInfo.name}.`;
  },
  tie: ({ names }) => `Égalité entre ${joinNames(names)}. Personne n'est éliminé aujourd'hui.`,
  noVote: () => "Personne n'a voté. Le village épargne tout le monde aujourd'hui.",
  victory: ({ winner }) => winner === "village"
    ? "Tous les Loups-Garous ont été éliminés. Le village est sauvé !"
    : `${TEAMS.wolves} sont aussi nombreux que les villageois. La meute a gagné !`,
  newGame: () => "Une nouvelle partie se prépare. Les villageois se rassemblent à nouveau…",
  reset: () => "La salle a été réinitialisée. En attente de nouveaux joueurs…"
};

export function narrate(key, data = {}) {
  const message = MESSAGES[key];
  return message ? message(data) : "";
}

// Texte de réveil pour chaque étape de la nuit.
export const STEP_NARRATION = Object.freeze({
  SEER: "seerWake",
  WOLVES: "wolvesWake",
  WITCH: "witchWake"
});
