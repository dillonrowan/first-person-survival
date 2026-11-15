// Runecraft altars and the essence mine, and the house: places reached by teleport, whose arrival
// tiles come from the map's own locs and collision.

import type { ConstructionDef, FurnitureDef, RunecraftDef, Tile } from "../../../src/world/SkillFormat";
import { CollisionFlag, REGION_SIZE } from "../../../src/world/WorldFormat";
import { LocLoadType } from "../rs/scene/SceneBuilder";
import { getIdFromTag } from "../rs/scene/entity/EntityTag";
import { stripLinks } from "../wiki/Wikitext";
import type { SkillsExportContext } from "./SkillContext";

const BLOCKED = CollisionFlag.OBJECT | CollisionFlag.FLOOR | CollisionFlag.FLOOR_DECORATION;

type PlacedLoc = { id: number; x: number; y: number; plane: number; sizeX: number; sizeY: number };
type Square = { locs: PlacedLoc[]; walkable(x: number, y: number, plane: number): boolean };

/** The locs and walkable tiles of one map square, from the cache. */
export function readSquare(ctx: SkillsExportContext, mapX: number, mapY: number): Square | undefined {
    const { sceneBuilder, locTypeLoader } = ctx.loaders;
    if (!sceneBuilder.getTerrainData(mapX, mapY)) return undefined;
    const baseX = mapX * REGION_SIZE;
    const baseY = mapY * REGION_SIZE;
    const scene = sceneBuilder.buildScene(baseX, baseY, REGION_SIZE, REGION_SIZE, false, LocLoadType.NO_MODELS);
    const locs: PlacedLoc[] = [];
    for (let plane = 0; plane < scene.levels; plane++) {
        for (let x = 0; x < REGION_SIZE; x++) {
            for (let y = 0; y < REGION_SIZE; y++) {
                const tile = scene.tiles[plane]?.[x]?.[y];
                for (const loc of tile?.locs ?? []) {
                    if (loc.startX !== x || loc.startY !== y) continue;
                    const id = getIdFromTag(loc.tag);
                    const t = locTypeLoader.load(id);
                    const swap = loc.rotation === 1 || loc.rotation === 3;
                    locs.push({ id, x: baseX + x, y: baseY + y, plane, sizeX: swap ? t.sizeY : t.sizeX, sizeY: swap ? t.sizeX : t.sizeY });
                }
            }
        }
    }
    return {
        locs,
        walkable: (x, y, plane) => {
            const lx = x - baseX;
            const ly = y - baseY;
            if (lx < 0 || ly < 0 || lx >= REGION_SIZE || ly >= REGION_SIZE) return false;
            if (!scene.tiles[plane]?.[lx]?.[ly]) return false;
            return (scene.collisionMaps[plane].getFlag(lx, ly) & BLOCKED) === 0;
        },
    };
}

/** The walkable tile nearest `to` among those at Chebyshev distance `ring` around a footprint. */
export function ringTile(square: Square, loc: PlacedLoc, ring: number, to: { x: number; y: number }): Tile | undefined {
    let best: Tile | undefined;
    let bestD = Infinity;
    for (let x = loc.x - ring; x < loc.x + loc.sizeX + ring; x++) {
        for (let y = loc.y - ring; y < loc.y + loc.sizeY + ring; y++) {
            const dx = Math.max(loc.x - x, x - (loc.x + loc.sizeX - 1), 0);
            const dy = Math.max(loc.y - y, y - (loc.y + loc.sizeY - 1), 0);
            if (Math.max(dx, dy) !== ring || !square.walkable(x, y, loc.plane)) continue;
            const d = Math.hypot(x - to.x, y - to.y);
            if (d < bestD) {
                bestD = d;
                best = { x, y, plane: loc.plane };
            }
        }
    }
    return best;
}

/** The walkable tile nearest a point, searching outward up to 8 tiles. */
export function nearestWalkable(square: Square, at: Tile): Tile | undefined {
    for (let r = 0; r <= 8; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) === r && square.walkable(at.x + dx, at.y + dy, at.plane)) {
                    return { x: at.x + dx, y: at.y + dy, plane: at.plane };
                }
            }
        }
    }
    return undefined;
}

/** Levels at which each essence makes one more rune [wiki: Runecraft]. */
const MULTIPLES: Record<string, number[]> = {
    Air: [11, 22, 33, 44, 55, 66, 77, 88, 99],
    Mind: [14, 28, 42, 56, 70, 84, 98],
    Water: [19, 38, 57, 76, 95],
    Earth: [26, 52, 78],
    Fire: [35, 70],
    Body: [46, 92],
    Chaos: [74],
    Astral: [82],
    Nature: [91],
    Law: [],
    Wrath: [],
};

const isPortal = (ctx: SkillsExportContext, id: number) => ctx.locs[id].name === "Portal" && ctx.locs[id].actions.some((a) => /^(use|exit|enter)$/i.test(a));

export function exportRunecraft(ctx: SkillsExportContext): RunecraftDef | undefined {
    const rune = ctx.resolveItem("Rune essence");
    const pure = ctx.resolveItem("Pure essence");
    if (rune === undefined || pure === undefined) return undefined;
    const altars: RunecraftDef["altars"] = [];
    for (const a of ctx.wiki.altars) {
        if (!a.altar || a.altarId < 0) continue;
        const rows = ctx.wiki.recipes.filter((r) => r.facility === `${a.rune} Altar` && r.skills[0].skill === "Runecraft" && r.materials.length === 1 && /^(Pure|Rune) essence$/.test(r.materials[0].name));
        const runeItem = ctx.resolveItem(`${a.rune} rune`);
        const talisman = ctx.resolveItem(`${a.rune} talisman`) ?? -1;
        const tiara = ctx.resolveItem(`${a.rune} tiara`) ?? -1;
        const square = readSquare(ctx, a.altar.x >> 6, a.altar.y >> 6);
        if (rows.length === 0 || runeItem === undefined || !square) {
            ctx.log(`runecraft: skipped ${a.rune} (${rows.length === 0 ? "no recipe" : !square ? "no map" : "no rune item"})`);
            continue;
        }
        const altarLoc = square.locs.find((l) => l.id === a.altarId) ?? { ...a.altar, id: a.altarId, sizeX: 1, sizeY: 1 };
        const portal = square.locs.filter((l) => isPortal(ctx, l.id) && l.plane === altarLoc.plane).sort((p, q) => Math.hypot(p.x - altarLoc.x, p.y - altarLoc.y) - Math.hypot(q.x - altarLoc.x, q.y - altarLoc.y))[0];
        const arrival = (portal && ringTile(square, portal, 2, altarLoc)) ?? nearestWalkable(square, { x: altarLoc.x - 3, y: altarLoc.y, plane: altarLoc.plane });
        if (!arrival) {
            ctx.log(`runecraft: skipped ${a.rune} (no arrival tile)`);
            continue;
        }
        altars.push({
            rune: a.rune,
            runeItem,
            level: rows[0].skills[0].level,
            xp: rows[0].skills[0].xp,
            altarLocIds: [a.altarId],
            ruinsLocIds: a.ruinsIds,
            ruins: a.ruins,
            talisman,
            tiara,
            arrival,
            exitLocIds: portal ? [portal.id] : [],
            multiples: MULTIPLES[a.rune] ?? [],
            pureOnly: !rows.some((r) => r.materials[0].name === "Rune essence"),
        });
    }
    // The rune essence mine, reached through Aubury.
    const mine = readSquare(ctx, 45, 75);
    const mineArrival = mine && nearestWalkable(mine, { x: 2911, y: 4832, plane: 0 });
    const exits = mine ? [...new Set(mine.locs.filter((l) => isPortal(ctx, l.id)).map((l) => l.id))] : [];
    ctx.log(`runecraft: ${altars.length} altars (${altars.map((a) => a.rune).join(", ")}), essence mine exits ${exits.length}`);
    return {
        altars,
        essence: { rune, pure },
        essenceMine: { arrival: mineArrival ?? { x: 2911, y: 4832, plane: 0 }, exitLocIds: exits, returnTo: { x: 3253, y: 3401, plane: 0 } },
    };
}

/** The house's rooms in the template square (29,110): name and chunk [design]. */
const ROOMS: [string, number, number][] = [
    ["Garden", 233, 884],
    ["Parlour", 232, 887],
    ["Kitchen", 234, 887],
    ["Dining room", 236, 887],
    ["Workshop", 232, 885],
    ["Bedroom", 238, 887],
];

export function exportConstruction(ctx: SkillsExportContext): ConstructionDef {
    const square = readSquare(ctx, 29, 110);
    const rooms = ROOMS.flatMap(([name, cx, cy]) => {
        const centre = { x: cx * 8 + 4, y: cy * 8 + 4, plane: 0 };
        const arrival = square ? nearestWalkable(square, centre) : undefined;
        return [{ name, arrival: arrival ?? centre }];
    });
    const inRooms = (l: PlacedLoc) => ROOMS.some(([, cx, cy]) => l.x >> 3 === cx && l.y >> 3 === cy);
    const hotspots: Record<string, string> = {};
    for (const l of square?.locs ?? []) {
        if (inRooms(l) && ctx.locs[l.id].actions.includes("Build")) hotspots[l.id] = ctx.locs[l.id].name;
    }
    const hotspotNames = new Set(Object.values(hotspots).map((n) => n.toLowerCase()));
    const furniture: FurnitureDef[] = [];
    for (const [page, data] of Object.entries(ctx.wiki.pages)) {
        const p = data.templates.find((t) => t.name === "Infobox Construction")?.params;
        if (!p) continue;
        const hotspot = stripLinks(p.hotspot ?? "");
        const locId = parseInt(p.id ?? "");
        if (!hotspotNames.has(hotspot.toLowerCase()) || !Number.isInteger(locId)) continue;
        const recipe = ctx.wiki.recipes.find((r) => r.page === page && r.skills[0].skill === "Construction");
        const materials = (recipe?.materials ?? []).map((m) => ({ item: ctx.resolveItem(m.name), qty: m.qty }));
        if (!recipe || materials.some((m) => m.item === undefined)) continue;
        furniture.push({
            locId,
            name: (p.name ?? page).trim(),
            hotspot,
            level: recipe.skills[0].level,
            xp: recipe.skills[0].xp,
            materials: materials as { item: number; qty: number }[],
        });
    }
    const [, gx, gy] = ROOMS[0];
    const exitLocIds = [...new Set((square?.locs ?? []).filter((l) => l.x >> 3 === gx && l.y >> 3 === gy && ctx.locs[l.id].name === "Portal").map((l) => l.id))];
    ctx.log(`construction: ${Object.keys(hotspots).length} hotspot locs, ${furniture.length} furniture, exits ${exitLocIds.join(",")}`);
    return { rooms, furniture, hotspots, exitLocIds };
}
