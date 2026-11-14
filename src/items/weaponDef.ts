import { UNARMED, WeaponDef, cacheWeaponDef } from "../combat/weapons";
import { CacheWeaponInfo, cacheWeaponFamily } from "../world/CacheWeaponFormat";
import type { Stack } from "./ItemContainer";
import type { ItemDb } from "./ItemDb";

/**
 * The weapon to fight with for what is in the weapon slot: fists for nothing, else the exported
 * cache weapon of that item (by id, then by name: copies that look alike are exported once), else
 * a weapon of the family its name suggests, drawn as a placeholder.
 */
export function weaponDefFor(
    stack: Stack | undefined,
    db: Pick<ItemDb, "get">,
    cacheWeapons: readonly CacheWeaponInfo[],
): WeaponDef {
    if (!stack) return UNARMED;
    const name = db.get(stack.id)?.name ?? "Weapon";
    const entry =
        cacheWeapons.find((w) => w.cacheId === stack.id) ??
        cacheWeapons.find((w) => w.name.toLowerCase() === name.toLowerCase());
    return cacheWeaponDef(entry ?? { id: `cache-${stack.id}`, name, family: cacheWeaponFamily(name) });
}
