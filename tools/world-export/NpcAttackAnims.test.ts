import { describe, expect, it } from "vitest";

import { HUMAN_ATTACKS, PLAYER_FRAME_BASE, buildAttackIndex, chooseAttacks, isShove, NpcAttackPicker } from "./NpcAttackAnims";

/** Real sequence ids and their Jagex names (data/animation-names-runelite.json). */
const NAMES = new Map<number, string>([
    [5568, "ZOMBIE_UPDATE_ATTACK_NORMAL"],
    [5569, "ZOMBIE_UPDATE_DEATH"],
    [5571, "ZOMBIE_UPDATE_ATTACK_WEAPON"],
    [5576, "ZOMBIE_UPDATE_READY_DRAGGING"],
    [5578, "ZOMBIE_UPDATE_ATTACK_DRAGGING"],
    [5567, "ZOMBIE_UPDATE_BLOCK"],
    [13681, "ZOMBIE_UPDATE_ATTACK_NORMAL_THRALL"],
    [6181, "SLICE_SURFACE_GOBLIN_SQUAT_READY"],
    [6184, "SLICE_SURFACE_GOBLIN_SQUAT_UNARMED_ATTACK"],
    [6188, "SLICE_SURFACE_GOBLIN_SQUAT_ATTACK_SPEAR"],
    [1506, "SPECTER_READY"],
    [1507, "SPECTER_ATTACK"],
    [1509, "SPECTER_PARRY"],
    [1270, "LEECHREADY"],
    [1273, "LEECHATTACK"],
    [90, "DRAGON_READY"],
    [80, "DRAGON_ATTACK"],
    [81, "DRAGON_FIREBREATH_ALL_ATTACK"],
    [808, "HUMAN_READY"],
    [813, "HUMAN_STAFFREADY"],
    [2561, "HUMAN_DH_WEAPON_READY"],
    [390, "HUMAN_SWORD_SLASH"],
    [386, "HUMAN_SWORD_STAB"],
    [422, "HUMAN_UNARMEDPUNCH"],
    [423, "HUMAN_UNARMEDKICK"],
    [2065, "BARROW_DHAROK_READY"],
    [2066, "BARROW_DHAROK_SLASH"],
]);

const zombie = [5567, 5568, 5569, 5571, 5576, 5578, 13681];

describe("chooseAttacks", () => {
    it("takes the creature attack whose name matches its idle", () => {
        expect(chooseAttacks(NAMES, 5576, 7, zombie, false).seqIds).toEqual([5578]);
        // An idle with no variant of its own takes the plain attack, never a thrall's or a death.
        const plain = chooseAttacks(NAMES, 5569, 7, zombie, false).seqIds;
        expect(plain).not.toContain(13681);
        expect(plain).not.toContain(5569);
    });

    it("leaves out weapon variants the idle does not hold, and fire breath", () => {
        expect(chooseAttacks(NAMES, 6181, 3, [6181, 6184, 6188], false).seqIds).toEqual([6184]);
        expect(chooseAttacks(NAMES, 90, 4, [80, 81, 90], false).seqIds).toEqual([80]);
    });

    it("matches whole words: a specter is not a special attack, LEECHATTACK is a leech's attack", () => {
        expect(chooseAttacks(NAMES, 1506, 5, [1506, 1507, 1509], false).seqIds).toEqual([1507]);
        expect(chooseAttacks(NAMES, 1270, 6, [1270, 1273], false).seqIds).toEqual([1273]);
    });

    it("gives player-skeleton NPCs the attacks of their stance or weapon", () => {
        const human = [...NAMES.keys()];
        const pick = (idle: number, armed: boolean) => chooseAttacks(NAMES, idle, PLAYER_FRAME_BASE, human, armed).seqIds;
        expect(pick(808, true)).toEqual([...HUMAN_ATTACKS.sword]);
        expect(pick(808, false)).toEqual([...HUMAN_ATTACKS.unarmed]);
        expect(pick(813, true)).toEqual([...HUMAN_ATTACKS.staff]);
        expect(pick(2561, true)).toEqual([...HUMAN_ATTACKS.twoHanded]);
        expect(pick(2065, true)).toEqual([2066]);
    });

    it("reports when a skeleton has no named attack", () => {
        expect(chooseAttacks(NAMES, 5576, 7, [5567, 5569], false)).toEqual({ seqIds: [], reason: expect.stringContaining("no named attack") });
    });
});

describe("NpcAttackPicker", () => {
    it("indexes sequences by frame base and flags kicks as shoves", () => {
        const base = (id: number) => (id >= 5500 && id < 14000 ? 7 : id < 1000 ? 0 : undefined);
        const picker = new NpcAttackPicker(buildAttackIndex(NAMES, base));

        expect(picker.choose(5576, 7, false)).toEqual([{ seqId: 5578, shove: false }]);
        expect(picker.choose(808, 0, false)).toEqual([
            { seqId: 422, shove: false },
            { seqId: 423, shove: true },
        ]);
        expect(isShove(NAMES, 390)).toBe(false);
    });
});
