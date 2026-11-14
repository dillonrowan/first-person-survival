/** A spell an NPC casts: its graphics key in SPELL_GRAPHICS, and whether it deals damage. */
export type NpcSpell = { id: string; damaging: boolean };

const strike = (id: string): NpcSpell => ({ id, damaging: true });
const curse = (id: string): NpcSpell => ({ id, damaging: false });

/**
 * The spells some magic NPCs cast, by NPC id, one picked at random per attack [design: the wiki
 * names the spells but not how often each is cast]. NPCs not listed fire their exported projectile.
 * A curse rolls accuracy like any spell: it lands (its impact plays) or splashes, and deals no damage.
 */
export const NPC_SPELLS: Record<number, NpcSpell[]> = {
    // Dark wizard, level 7 [wiki: "will attack with Water Strike and Confuse spells"]
    512: [strike("water-strike"), curse("confuse")],
    5086: [strike("water-strike"), curse("confuse")],
    5087: [strike("water-strike"), curse("confuse")],
    // Dark wizard, level 20 [wiki: "will attack with Earth Strike and Weaken spells"]
    510: [strike("earth-strike"), curse("weaken")],
    5088: [strike("earth-strike"), curse("weaken")],
    5089: [strike("earth-strike"), curse("weaken")],
};

/** The spell an NPC casts for this attack, or undefined if it has no spell list. */
export function pickNpcSpell(npcId: number, random: () => number): NpcSpell | undefined {
    const list = NPC_SPELLS[npcId];
    return list ? list[Math.floor(random() * list.length) % list.length] : undefined;
}
