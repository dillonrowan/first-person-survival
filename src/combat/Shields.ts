/** A shield the player can hold. Only its protection matters; it has no model in the game yet. */
export type ShieldDef = {
    id: string;
    /** Item id in the cache. */
    cacheId: number;
    name: string;
    /** Fraction of dragonfire damage that gets through. */
    dragonfireFactor: number;
};

/** Cuts dragonfire to a tenth (OSRS: 90% of the damage). */
export const ANTI_DRAGON_SHIELD: ShieldDef = {
    id: "cache-1540",
    cacheId: 1540,
    name: "Anti-dragon shield",
    dragonfireFactor: 0.1,
};

export const SHIELDS: readonly ShieldDef[] = [ANTI_DRAGON_SHIELD];
