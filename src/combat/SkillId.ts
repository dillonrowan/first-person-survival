/** The player's skills (Attack and Strength are one skill, Melee). No imports, so tools can use it. */
export type CombatSkillId = "melee" | "defence" | "ranged" | "magic" | "hitpoints";
/** The non-combat skills (no Agility, Prayer or Sailing). */
export type NonCombatSkillId =
    | "mining"
    | "smithing"
    | "herblore"
    | "fishing"
    | "thieving"
    | "cooking"
    | "crafting"
    | "firemaking"
    | "fletching"
    | "woodcutting"
    | "runecraft"
    | "slayer"
    | "farming"
    | "construction"
    | "hunter";
export type SkillId = CombatSkillId | NonCombatSkillId;
