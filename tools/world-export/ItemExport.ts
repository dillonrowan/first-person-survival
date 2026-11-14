import {
    FORCED_STACKABLE,
    ItemInfo,
    ItemRequirement,
    SKILL_CODE,
    WEAR_POS_SLOT,
    bonusesFromParams,
} from "../../src/world/ItemFormat";

/** The parts of an ObjType the item export reads. */
export type ExportObj = {
    id: number;
    name: string;
    examine: string;
    stackable: boolean;
    inventoryOptions: (string | undefined)[];
    wearPos1: number;
    wearPos2: number;
    params?: Map<number, unknown>;
    zoom2d: number;
    xan2d: number;
    yan2d: number;
    zan2d: number;
    xOffset2d: number;
    yOffset2d: number;
};

/** Skill requirement params: (skill code, level) pairs of ids (434, 436) and (435, 437). */
const REQUIREMENT_PARAMS: [number, number][] = [
    [434, 436],
    [435, 437],
];

/** Strips the colour markup the cache puts in names. */
const cleanName = (name: string) => name.replace(/<[^>]*>/g, "").trim();

export function itemInfoFor(obj: ExportObj, food: Record<string, number>, model: string): ItemInfo {
    const slot = WEAR_POS_SLOT[obj.wearPos1];
    const name = cleanName(obj.name);
    const info: ItemInfo = {
        id: obj.id,
        name,
        examine: obj.examine,
        stackable: obj.stackable || FORCED_STACKABLE.has(obj.id),
        model,
        icon: {
            zoom: obj.zoom2d,
            xan: obj.xan2d,
            yan: obj.yan2d,
            zan: obj.zan2d,
            xOffset: obj.xOffset2d,
            yOffset: obj.yOffset2d,
        },
        actions: obj.inventoryOptions.filter((o): o is string => !!o),
    };
    if (slot) {
        info.slot = slot;
        const { bonuses, speedTicks } = bonusesFromParams(obj.params);
        info.bonuses = bonuses;
        if (slot === "weapon") {
            info.speedTicks = speedTicks;
            if (obj.wearPos2 === 5) info.twoHanded = true;
        }
        const requirements = new Map<ItemRequirement["skill"], number>();
        for (const [skillParam, levelParam] of REQUIREMENT_PARAMS) {
            const code = obj.params?.get(skillParam);
            const level = obj.params?.get(levelParam);
            const skill = typeof code === "number" ? SKILL_CODE[code] : undefined;
            if (skill && typeof level === "number" && level > 1) {
                requirements.set(skill, Math.max(requirements.get(skill) ?? 0, level));
            }
        }
        if (requirements.size > 0) {
            info.requirements = [...requirements].map(([skill, level]) => ({ skill, level }));
        }
    }
    const heal = food[name];
    if (heal !== undefined) info.heal = heal;
    return info;
}
