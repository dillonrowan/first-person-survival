// File format of the weapons exported from the cache. Written by tools/world-export, read by the game.
//
// public/world/
//   cache-weapons.json          CacheWeaponInfo[]: every wieldable weapon-slot item, sorted by name
//   cache-weapons/{cacheId}.bin gzip-compressed NpcModelData (see NpcFormat) without clips: the
//                               item's worn model, lit like a player's, in RS units

export type CacheWeaponFamily = "sword" | "daggers" | "staff" | "bow";

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
    /** Furthest model vertex from the grip, RS units: the blade or head points at it. */
    tip: [number, number, number];
};

/** Dagger names swing like the daggers, staffs like the staff, bows shoot; everything else is a sword. */
export function cacheWeaponFamily(name: string): CacheWeaponFamily {
    const lower = name.toLowerCase();
    if (lower.includes("dagger")) return "daggers";
    if (lower.includes("staff")) return "staff";
    if (lower.includes("bow")) return "bow";
    return "sword";
}
