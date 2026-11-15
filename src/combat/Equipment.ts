import { EquipmentBonuses, MeleeType, NO_BONUSES } from "../world/ItemFormat";

/** An item and how many are needed (item id from the cache). */
export type RuneCost = { item: number; count: number };

/** What combat reads of the player's items: bonuses, weapon speed, ammunition and runes. */
export interface CombatGear {
    /** Sum over all worn items. */
    bonuses(): EquipmentBonuses;
    /** The wielded item's attack speed in ticks; 4 unarmed. */
    weaponSpeedTicks(): number;
    ammoCount(kind: "arrow" | "bolt"): number;
    /** Removes one from the ammo slot. */
    useAmmo(): void;
    hasRunes(cost: readonly RuneCost[]): boolean;
    useRunes(cost: readonly RuneCost[]): void;
    /** Names of the wielded weapon and the ammunition, for weapon poison. */
    weaponName(): string | undefined;
    ammoName(): string | undefined;
}

/** No items at all: no bonuses, plenty of ammunition and runes (tests, and before items load). */
export const NO_GEAR: CombatGear = {
    bonuses: () => NO_BONUSES,
    weaponSpeedTicks: () => 4,
    ammoCount: () => 999,
    useAmmo: () => undefined,
    hasRunes: () => true,
    useRunes: () => undefined,
    weaponName: () => undefined,
    ammoName: () => undefined,
};

export function sumBonuses(...list: readonly EquipmentBonuses[]): EquipmentBonuses {
    const out = { ...NO_BONUSES };
    for (const b of list) {
        for (const key of Object.keys(out) as (keyof EquipmentBonuses)[]) {
            out[key] += b[key];
        }
    }
    return out;
}

/** The melee attack type of a weapon: its largest attack bonus; ties go slash, stab, crush. */
export function meleeType(b: EquipmentBonuses): MeleeType {
    if (b.slash >= b.stab && b.slash >= b.crush) return "slash";
    if (b.stab >= b.crush) return "stab";
    return "crush";
}
