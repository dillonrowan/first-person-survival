import { CombatGear, RuneCost, sumBonuses } from "../combat/Equipment";
import { SKILL_NAMES, type PlayerSkills } from "../combat/Skills";
import { ALL_RUNES, RUNE } from "../combat/Spells";
import { EQUIP_SLOTS, EquipSlot, EquipmentBonuses, ItemInfo, NO_BONUSES } from "../world/ItemFormat";
import { EquipmentSlots } from "./EquipmentSlots";
import type { ItemDb } from "./ItemDb";
import { ItemContainer, Stack } from "./ItemContainer";

export const INVENTORY_SIZE = 28;
const STORAGE_KEY = "first-person-survival.items.v1";
type ItemStorage = Pick<Storage, "getItem" | "setItem">;

const NO_SPACE = "You don't have enough inventory space.";
const NO_SPACE_SWAP = "You don't have enough free inventory space to do that.";

/** Cache ids of the starting kit, besides the runes. [design] */
const START_WEAPON = 1277; // Bronze sword
const START_AMMO: Stack = { id: 882, qty: 999 }; // Bronze arrow
const START_SPARES = [1291, 1205, 1422, 1379, 841]; // Bronze longsword, dagger, mace, Staff, Shortbow
const START_RUNES = 999;

/** The runes a wielded staff or wand provides without using any, by name. */
const PROVIDES: [number, RegExp][] = [
    [RUNE.air, /\b(air|smoke|mist|dust)\b/],
    [RUNE.water, /\b(water|mud|steam|mist)\b|kodai wand/],
    [RUNE.earth, /\b(earth|lava|mud|dust)\b/],
    [RUNE.fire, /\b(fire|lava|steam|smoke)\b/],
];

type Saved = { inventory: (Stack | null)[]; bank: Stack[]; equipment: Partial<Record<EquipSlot, Stack>> };

/**
 * The player items: the 28-slot inventory, the bank, and what is worn. Implements CombatGear, so
 * combat reads bonuses, ammunition and runes from here. Saved to storage after every change.
 */
export class PlayerItems implements CombatGear {
    readonly inventory: ItemContainer;
    readonly bank: ItemContainer;
    readonly equipment = new EquipmentSlots();
    onChange?: () => void;

    constructor(
        readonly db: ItemDb,
        private readonly skills: Pick<PlayerSkills, "level">,
        private readonly storage?: ItemStorage,
    ) {
        this.inventory = new ItemContainer(INVENTORY_SIZE, false, db);
        this.bank = new ItemContainer(Infinity, true, db);
        if (!this.load()) this.startingKit();
    }

    // ---------------------------------------------------------------- equipping

    /** Wields or wears the item in an inventory slot; returns a message when it cannot. */
    wield(invSlot: number): string | undefined {
        const original = this.inventory.slots[invSlot];
        if (!original) return undefined;
        // A copy: removing the item from its slot empties the original.
        const stack: Stack = { ...original };
        const info = this.db.get(stack.id);
        if (!info?.slot) return "You can't wear that.";
        for (const req of info.requirements ?? []) {
            if (this.skills.level(req.skill) < req.level) {
                return `You need a ${SKILL_NAMES[req.skill]} level of ${req.level} to wear this.`;
            }
        }
        const slot = info.slot;
        const worn = this.equipment.get(slot);
        if (slot === "ammo" && worn?.id === stack.id) {
            // More of the same ammunition: add to the stack.
            this.inventory.removeAt(invSlot);
            this.equipment.set("ammo", { id: worn.id, qty: worn.qty + stack.qty });
            this.changed();
            return undefined;
        }
        const displaced: Stack[] = [];
        if (worn) displaced.push(worn);
        if (slot === "weapon" && info.twoHanded) {
            const shield = this.equipment.get("shield");
            if (shield) displaced.push(shield);
        }
        if (slot === "shield") {
            const weapon = this.equipment.get("weapon");
            if (weapon && this.db.get(weapon.id)?.twoHanded) displaced.push(weapon);
        }
        // Space: the slot the item leaves is free again; stackables that merge need none.
        const need = displaced.filter((d) => !(this.db.get(d.id)?.stackable && this.inventory.count(d.id) > 0)).length;
        if (this.inventory.freeSlots() + 1 < need) return NO_SPACE_SWAP;

        this.inventory.removeAt(invSlot);
        for (const d of displaced) {
            const slotOf = displacedSlot(d, this.db, this.equipment);
            this.equipment.set(slotOf, undefined);
        }
        displaced.forEach((d, i) => {
            if (i === 0 && !this.inventory.slots[invSlot] && !this.db.get(d.id)?.stackable) {
                this.inventory.slots[invSlot] = d;
            } else {
                this.inventory.add(d.id, d.qty);
            }
        });
        this.equipment.set(slot, stack);
        this.changed();
        return undefined;
    }

    /** Takes a worn item off into the inventory. */
    unequip(slot: EquipSlot): string | undefined {
        const stack = this.equipment.get(slot);
        if (!stack) return undefined;
        const merges = !!this.db.get(stack.id)?.stackable && this.inventory.count(stack.id) > 0;
        if (!merges && this.inventory.freeSlots() < 1) return NO_SPACE;
        this.equipment.set(slot, undefined);
        this.inventory.add(stack.id, stack.qty);
        this.changed();
        return undefined;
    }

    /** The mouse wheel: wields the first (step > 0) or last (step < 0) weapon in the inventory. */
    cycleWeapon(step: number): string | undefined {
        const weapons = this.inventory.slots.flatMap((s, i) => (s && this.db.get(s.id)?.slot === "weapon" ? [i] : []));
        if (step === 0 || weapons.length === 0) return undefined;
        return this.wield(step > 0 ? weapons[0] : weapons[weapons.length - 1]);
    }

    // ---------------------------------------------------------------- items

    /** Eats the food in an inventory slot, healing `target`. */
    eat(invSlot: number, target: { health: number; maxHealth: number }): string | undefined {
        const stack = this.inventory.slots[invSlot];
        const info = stack && this.db.get(stack.id);
        if (!stack || !info || info.heal === undefined) return undefined;
        target.health = Math.min(target.maxHealth, target.health + info.heal);
        this.inventory.removeAt(invSlot, 1);
        this.changed();
        return `You eat the ${info.name.toLowerCase()}.`;
    }

    /** Removes the whole stack of a slot; the caller puts it on the ground. */
    drop(invSlot: number): Stack | null {
        const stack = this.inventory.removeAt(invSlot);
        if (stack) this.changed();
        return stack;
    }

    /** Picks up a stack from the ground; returns how many did not fit. */
    pickUp(id: number, qty: number): number {
        const left = this.inventory.add(id, qty);
        if (left < qty) this.changed();
        return left;
    }

    /** Adds items to the inventory; what does not fit goes to the bank (dev command). */
    give(id: number, qty = 1): void {
        if (!this.db.get(id)) return;
        const left = this.inventory.add(id, qty);
        if (left > 0) this.bank.add(id, left);
        this.changed();
    }

    // ---------------------------------------------------------------- bank

    deposit(invSlot: number, qty: number): void {
        const stack = this.inventory.slots[invSlot];
        if (!stack) return;
        const taken = this.inventory.remove(stack.id, qty);
        this.bank.add(stack.id, taken);
        this.changed();
    }

    depositAll(): void {
        for (let i = 0; i < this.inventory.slots.length; i++) {
            const stack = this.inventory.slots[i];
            if (stack) this.bank.add(stack.id, this.inventory.removeAt(i)!.qty);
        }
        this.changed();
    }

    depositWorn(): void {
        for (const [slot, stack] of this.equipment.all()) {
            this.bank.add(stack.id, stack.qty);
            this.equipment.set(slot, undefined);
        }
        this.changed();
    }

    /** Takes up to `qty` out of a bank stack; non-stackables need a free slot each. */
    withdraw(bankIndex: number, qty: number): string | undefined {
        const stack = this.bank.slots[bankIndex];
        if (!stack) return undefined;
        const want = Math.min(qty, stack.qty);
        const stackable = !!this.db.get(stack.id)?.stackable;
        const room = stackable ? (this.inventory.count(stack.id) > 0 || this.inventory.freeSlots() > 0 ? want : 0) : Math.min(want, this.inventory.freeSlots());
        if (room > 0) {
            this.bank.remove(stack.id, room);
            this.inventory.add(stack.id, room);
            this.changed();
        }
        return room < want ? NO_SPACE : undefined;
    }

    // ---------------------------------------------------------------- CombatGear

    bonuses(): EquipmentBonuses {
        return sumBonuses(
            ...this.equipment.all().map(([, s]) => this.db.get(s.id)?.bonuses ?? NO_BONUSES),
        );
    }

    weaponSpeedTicks(): number {
        const weapon = this.equipment.get("weapon");
        return (weapon && this.db.get(weapon.id)?.speedTicks) ?? 4;
    }

    ammoCount(kind: "arrow" | "bolt"): number {
        const ammo = this.equipment.get("ammo");
        const name = ammo && this.db.get(ammo.id)?.name.toLowerCase();
        return ammo && name?.includes(kind) ? ammo.qty : 0;
    }

    useAmmo(): void {
        const ammo = this.equipment.get("ammo");
        if (!ammo) return;
        this.equipment.set("ammo", ammo.qty > 1 ? { id: ammo.id, qty: ammo.qty - 1 } : undefined);
        this.changed();
    }

    /** Runes the wielded staff or wand supplies endlessly. */
    private providedRunes(): Set<number> {
        const weapon = this.equipment.get("weapon");
        const name = (weapon && this.db.get(weapon.id)?.name.toLowerCase()) ?? "";
        const out = new Set<number>();
        if (/staff|wand/.test(name)) {
            for (const [rune, pattern] of PROVIDES) {
                if (pattern.test(name)) out.add(rune);
            }
        }
        return out;
    }

    hasRunes(cost: readonly RuneCost[]): boolean {
        const provided = this.providedRunes();
        return cost.every((c) => provided.has(c.item) || this.inventory.count(c.item) >= c.count);
    }

    useRunes(cost: readonly RuneCost[]): void {
        const provided = this.providedRunes();
        for (const c of cost) {
            if (!provided.has(c.item)) this.inventory.remove(c.item, c.count);
        }
        this.changed();
    }

    weaponName(): string | undefined {
        const weapon = this.equipment.get("weapon");
        return weapon && this.db.get(weapon.id)?.name;
    }

    ammoName(): string | undefined {
        const ammo = this.equipment.get("ammo");
        return ammo && this.db.get(ammo.id)?.name;
    }

    // ---------------------------------------------------------------- saving

    private changed(): void {
        this.save();
        this.onChange?.();
    }

    private startingKit(): void {
        for (const rune of ALL_RUNES) this.add(rune, START_RUNES);
        for (const id of START_SPARES) this.add(id, 1);
        if (this.db.get(START_WEAPON)) this.equipment.set("weapon", { id: START_WEAPON, qty: 1 });
        if (this.db.get(START_AMMO.id)) this.equipment.set("ammo", { ...START_AMMO });
    }

    private add(id: number, qty: number): void {
        if (this.db.get(id)) this.inventory.add(id, qty);
    }

    private save(): void {
        try {
            const saved: Saved = {
                inventory: this.inventory.slots.map((s) => (s ? { ...s } : null)),
                bank: this.bank.slots.filter((s): s is Stack => s !== null),
                equipment: Object.fromEntries(this.equipment.all()),
            };
            this.storage?.setItem(STORAGE_KEY, JSON.stringify(saved));
        } catch {
            // Not saved this time.
        }
    }

    /** Loads the saved items; false when there is no usable save. Unknown items are dropped. */
    private load(): boolean {
        try {
            const raw = this.storage?.getItem(STORAGE_KEY);
            if (!raw) return false;
            const saved = JSON.parse(raw) as Partial<Saved>;
            const valid = (s: unknown): s is Stack =>
                !!s &&
                typeof (s as Stack).id === "number" &&
                Number.isInteger((s as Stack).qty) &&
                (s as Stack).qty > 0 &&
                !!this.db.get((s as Stack).id);
            (saved.inventory ?? []).slice(0, INVENTORY_SIZE).forEach((s, i) => {
                if (valid(s)) this.inventory.slots[i] = { id: s.id, qty: s.qty };
            });
            for (const s of saved.bank ?? []) {
                if (valid(s)) this.bank.add(s.id, s.qty);
            }
            for (const slot of EQUIP_SLOTS) {
                const s = saved.equipment?.[slot];
                if (valid(s)) this.equipment.set(slot, { id: s.id, qty: s.qty });
            }
            return true;
        } catch {
            return false;
        }
    }
}

/** The slot a worn stack occupies. */
function displacedSlot(stack: Stack, db: Pick<ItemDb, "get">, equipment: EquipmentSlots): EquipSlot {
    const slot = db.get(stack.id)?.slot;
    if (slot && equipment.get(slot) === stack) return slot;
    return equipment.all().find(([, s]) => s === stack)?.[0] ?? "weapon";
}

export type { ItemInfo };
