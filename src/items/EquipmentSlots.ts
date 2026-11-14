import { EQUIP_SLOTS, EquipSlot } from "../world/ItemFormat";
import type { Stack } from "./ItemContainer";

/** What the player wears and wields, one stack per slot. */
export class EquipmentSlots {
    private readonly worn = new Map<EquipSlot, Stack>();

    get(slot: EquipSlot): Stack | undefined {
        return this.worn.get(slot);
    }

    set(slot: EquipSlot, stack: Stack | undefined): void {
        if (stack) this.worn.set(slot, stack);
        else this.worn.delete(slot);
    }

    all(): [EquipSlot, Stack][] {
        return EQUIP_SLOTS.flatMap((slot) => {
            const s = this.worn.get(slot);
            return s ? [[slot, s] as [EquipSlot, Stack]] : [];
        });
    }
}
