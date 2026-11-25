import fs from "node:fs";

import type { AttackStyle } from "../../src/npc/AttackStyle";
import {
    NPC_FORMAT_VERSION,
    NpcAppearanceInfo,
    NpcManifest,
    NpcSpawnInfo,
    npcModelFileName,
} from "../../src/world/NpcFormat";
import { NpcType } from "./rs/config/npctype/NpcType";
import { NpcTypeLoader } from "./rs/config/npctype/NpcTypeLoader";
import { VarManager } from "./rs/config/vartype/VarManager";

/** One entry of data/npc-spawns-osrs.json (from rs-map-viewer). */
export type NpcSpawnRecord = {
    id: number;
    name?: string;
    x: number;
    y: number;
    level: number;
    /** Shown in its base pose when its type has no idle animation (the Great Olm), not skipped. */
    still?: boolean;
};

/** An appearance to bake, with the sequences the exporter needs but the game does not. */
export type NpcAppearanceTask = NpcAppearanceInfo & {
    idleSeqId: number;
    walkSeqId: number;
    /** Explicit attack animations by style (npc-attack-overrides), for the exporter only. */
    styleSeqs?: Partial<Record<AttackStyle, number>>;
};

/** The NPC's right-click options (Talk-to, Attack...), left out of the manifest when it has none. */
function menuActions(actions: (string | undefined)[] | undefined): { actions?: string[] } {
    const list = (actions ?? []).filter((action): action is string => !!action);
    return list.length > 0 ? { actions: list } : {};
}

export type SkipReason = "outsideArea" | "nameMismatch" | "noModel" | "noIdle";

export type NpcSelection = {
    appearances: NpcAppearanceTask[];
    spawns: NpcSpawnInfo[];
    skipped: Record<SkipReason, number>;
};

/** Client orientation per NPC spawnDirection (0 south, 512 west, 1024 north, 1536 east). */
export const DIRECTION_ORIENTATIONS = [768, 1024, 1280, 512, 1536, 256, 0, 1792];

export const NPC_MODEL_DIR = "npcs";

export function readNpcSpawnFile(file: string): NpcSpawnRecord[] {
    const data: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(data)) {
        throw new Error(`${file} is not a list of NPC spawns`);
    }
    return data.map((entry, i) => {
        const { id, name, x, y, level } = entry ?? {};
        if (![id, x, y, level].every(Number.isInteger) || (name !== undefined && typeof name !== "string")) {
            throw new Error(`${file}: invalid NPC spawn at index ${i}`);
        }
        return { id, name, x, y, level };
    });
}

/**
 * Hand fixes to the spawn list (data/npc-spawn-overrides.json): NPCs the list has in an old place
 * (the Wilderness bosses before their lairs) and NPCs it lacks.
 */
export type NpcSpawnOverrides = {
    /** Spawns to move: every spawn of `id` within 2 tiles of `from` goes to `to` ([x, y, level]). */
    move?: { id: number; from: [number, number, number]; to: [number, number, number]; note?: string }[];
    /** Spawns to add. */
    add?: (NpcSpawnRecord & { note?: string })[];
};

/** The spawn list with the overrides applied. */
export function applySpawnOverrides(spawns: NpcSpawnRecord[], overrides: NpcSpawnOverrides): NpcSpawnRecord[] {
    const out = spawns.map((spawn) => {
        const move = overrides.move?.find(
            (m) => m.id === spawn.id && m.from[2] === spawn.level && Math.abs(m.from[0] - spawn.x) <= 2 && Math.abs(m.from[1] - spawn.y) <= 2,
        );
        return move ? { ...spawn, x: move.to[0], y: move.to[1], level: move.to[2] } : spawn;
    });
    for (const { id, name, x, y, level, still } of overrides.add ?? []) out.push({ id, name, x, y, level, ...(still ? { still } : {}) });
    return out;
}

/** Removes markup like <col=00ffff> from cache names. */
export function stripNameTags(name: string): string {
    return name.replace(/<[^>]*>/g, "");
}

type NpcVars = Pick<VarManager, "getVarbit" | "getVarp">;

/**
 * The NPC type whose model is shown for a spawn. Multi-NPCs (varbit-dependent) are resolved with
 * all variables at 0 like locs; if that state is not the spawn's NPC, any state with a matching
 * name is used. The JSON name guards against ids that were renumbered since the list was made.
 */
export function resolveDisplayType(
    spawn: NpcSpawnRecord,
    loader: NpcTypeLoader,
    vars: NpcVars,
): NpcType | undefined {
    const matches = (type: NpcType | undefined): type is NpcType =>
        type !== undefined &&
        (spawn.name === undefined || stripNameTags(type.name) === spawn.name);

    const base = loader.load(spawn.id);
    if (!base.transforms) {
        return matches(base) ? base : undefined;
    }
    const shown = base.transform(vars, loader);
    if (matches(shown)) {
        return shown;
    }
    for (const id of base.transforms) {
        if (id !== -1) {
            const candidate = loader.load(id);
            if (matches(candidate)) {
                return candidate;
            }
        }
    }
    return undefined;
}

export function selectNpcs(
    spawns: NpcSpawnRecord[],
    isExported: (mapX: number, mapY: number) => boolean,
    loader: NpcTypeLoader,
    vars: NpcVars,
    waterAt?: (plane: number, x: number, y: number) => boolean,
): NpcSelection {
    const skipped: Record<SkipReason, number> = {
        outsideArea: 0,
        nameMismatch: 0,
        noModel: 0,
        noIdle: 0,
    };
    const appearances: NpcAppearanceTask[] = [];
    const appearanceByKey = new Map<string, number>();
    const out: NpcSpawnInfo[] = [];

    for (const spawn of spawns) {
        if (!isExported(spawn.x >> 6, spawn.y >> 6)) {
            skipped.outsideArea++;
            continue;
        }
        const display = resolveDisplayType(spawn, loader, vars);
        if (!display) {
            skipped.nameMismatch++;
            continue;
        }
        if (!display.modelIds || display.modelIds.length === 0) {
            skipped.noModel++;
            continue;
        }
        // Like the client: animations, size and facing come from the spawn's own type, the model
        // from the type that is currently shown.
        const base = loader.load(spawn.id);
        const idleSeqId = base.idleSeqId !== -1 ? base.idleSeqId : display.idleSeqId;
        if (idleSeqId === -1 && !spawn.still) {
            skipped.noIdle++;
            continue;
        }
        let walkSeqId = base.walkSeqId !== -1 ? base.walkSeqId : display.walkSeqId;
        if (walkSeqId === idleSeqId) {
            walkSeqId = -1;
        }

        const key = `${base.id}_${display.id}`;
        let index = appearanceByKey.get(key);
        if (index === undefined) {
            index = appearances.length;
            appearanceByKey.set(key, index);
            appearances.push({
                id: base.id,
                displayId: display.id,
                name: stripNameTags(display.name),
                size: base.size,
                combatLevel: display.combatLevel,
                rotationSpeed: base.rotationSpeed,
                file: `${NPC_MODEL_DIR}/${npcModelFileName(base.id, display.id)}`,
                ...menuActions(display.actions ?? base.actions),
                idleSeqId,
                walkSeqId,
            });
        }
        out.push({
            appearance: index,
            x: spawn.x,
            y: spawn.y,
            plane: spawn.level,
            orientation: DIRECTION_ORIENTATIONS[base.spawnDirection] ?? 0,
            environment: waterAt ? (waterAt(spawn.level, spawn.x, spawn.y) ? "water" : "land") : undefined,
        });
    }

    return { appearances, spawns: out, skipped };
}

/** Drops appearances whose model file was not written (and their spawns) and renumbers. */
export function finalizeNpcManifest(
    selection: Pick<NpcSelection, "appearances" | "spawns">,
    built: Set<number>,
    source: string,
): NpcManifest {
    const newIndex = new Map<number, number>();
    const appearances: NpcAppearanceInfo[] = [];
    selection.appearances.forEach((task, i) => {
        if (built.has(i)) {
            newIndex.set(i, appearances.length);
            const { idleSeqId: _idle, walkSeqId: _walk, styleSeqs: _styleSeqs, ...info } = task;
            appearances.push(info);
        }
    });
    const spawns = selection.spawns
        .filter((spawn) => newIndex.has(spawn.appearance))
        .map((spawn) => ({ ...spawn, appearance: newIndex.get(spawn.appearance)! }));
    return { format: NPC_FORMAT_VERSION, source, appearances, spawns };
}
