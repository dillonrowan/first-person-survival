// File format of the weapons exported from the cache. Written by tools/world-export, read by the game.
//
// public/world/
//   cache-weapons.json          CacheWeaponInfo[]: every wieldable weapon-slot item, sorted by name
//   cache-weapons/{cacheId}.bin gzip-compressed NpcModelData (see NpcFormat) without clips: the
//                               item's worn model, lit like a player's, in RS units

export type CacheWeaponFamily = "sword" | "daggers" | "staff" | "bow" | "crossbow";

export type CacheWeaponInfo = {
    id: string;
    /** Item (obj) id in the cache. */
    cacheId: number;
    name: string;
    /** Which existing weapon the item swings like. */
    family: CacheWeaponFamily;
    /** Model file relative to public/world/. */
    file: string;
    /** Where the hand closes on the model, RS units (x, y down, z). */
    grip: [number, number, number];
    /**
     * Where the blade or head points, RS axes: from the grip to the far end of a weapon held near
     * one end, from butt to head of one held mid-shaft. Not normalized.
     */
    blade: [number, number, number];
};

/**
 * Dagger names swing like the daggers, staffs like the staff, bows are drawn and crossbows loaded;
 * everything else is a sword.
 */
export function cacheWeaponFamily(name: string): CacheWeaponFamily {
    const lower = name.toLowerCase();
    if (lower.includes("dagger")) return "daggers";
    if (lower.includes("staff")) return "staff";
    if (lower.includes("crossbow")) return "crossbow";
    if (lower.includes("bow")) return "bow";
    return "sword";
}

/**
 * Crossbows built as repeaters (a Chu-ko-nu): a magazine over the rail, worked by a lever. Karil's
 * crossbow, in every state of repair, is one; its model carries the magazine box.
 */
export function isRepeaterCrossbow(name: string): boolean {
    return name.toLowerCase().startsWith("karil's crossbow");
}
