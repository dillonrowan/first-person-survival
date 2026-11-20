// Thieving (stalls, pickpockets), Hunter, Slayer and shops: the skills that act on NPCs or stalls.

import type { HunterDef, HunterMethod, PickpocketDef, ShopDef, SlayerDef, StallDef } from "../../../src/world/SkillFormat";
import { parseSeconds } from "../fetch-wiki-skills";
import { stripNameTags } from "../NpcSpawns";
import { SkillsExportContext, num } from "./SkillContext";

const ticks = (text: string | undefined, fallback: number) => {
    const s = parseSeconds(text ?? "");
    return s === undefined ? fallback : Math.max(1, Math.round(s / 0.6));
};

export function exportThieving(ctx: SkillsExportContext): { stalls: StallDef[]; pickpockets: PickpocketDef[] } {
    const stalls: StallDef[] = [];
    const pickpockets: PickpocketDef[] = [];
    for (const [page, data] of Object.entries(ctx.wiki.pages)) {
        for (const t of data.templates) {
            if (t.name !== "Thieving info") continue;
            const p = t.params;
            const name = (p.name ?? page).trim();
            const loot = ctx.lootOf(page, "thieving");
            if (p.type === "Pickpocket") {
                const ids = new Set([...ctx.pageNpcIds(page), ...ctx.spawnedNamed(name)]);
                const npcIds = ctx.spawned.filter((a) => ids.has(a.id) && a.actions?.includes("Pickpocket")).map((a) => a.id);
                const chart = data.charts[0]?.series[0];
                if (npcIds.length === 0 || loot.length === 0) continue;
                pickpockets.push({
                    name,
                    npcIds,
                    level: num(p.level, 1),
                    xp: num(p.xp),
                    stunTicks: ticks(p.time, 8),
                    damage: num(p.damage, 1) || 1,
                    chance: chart ? { low: chart.low, high: chart.high } : { low: 180, high: 240 },
                    loot,
                });
            } else if (p.type === "Stall") {
                const locIds = new Set(ctx.pageLocIds(page));
                for (const id of ctx.locsWhere((n, a) => n.toLowerCase() === name.toLowerCase() && a.includes("Steal-from"))) locIds.add(id);
                const ids = [...locIds].filter((id) => ctx.locs[id].actions.includes("Steal-from"));
                if (ids.length === 0 || loot.length === 0) continue;
                stalls.push({ name, locIds: ids, level: num(p.level, 1), xp: num(p.xp), respawnTicks: ticks(p.time, 4), loot });
            }
        }
    }
    ctx.log(`thieving: ${pickpockets.length} pickpockets, ${stalls.length} stalls`);
    return { stalls, pickpockets };
}

const HUNTER_METHODS: Record<string, HunterMethod> = { "Bird snare": "bird snare", "Box trap": "box trap", "Insect net": "net" };

export function exportHunter(ctx: SkillsExportContext): HunterDef[] {
    const out: HunterDef[] = [];
    for (const row of ctx.wiki.calc.Hunter ?? []) {
        const method = HUNTER_METHODS[String(row.type ?? "")];
        if (!method) continue;
        const page = String(row.name);
        const creature = page.replace(/\s*\(Hunter\)$/, "");
        if (out.some((h) => h.creature === creature && h.method === method)) continue;
        const npcIds = [...new Set([...ctx.pageNpcIds(page), ...ctx.spawnedNamed(creature)])].filter((id) => ctx.spawned.some((a) => a.id === id));
        let loot = ctx.lootOf(page, "hunter");
        if (loot.length === 0) {
            const jar = ctx.resolveItem(`${creature} jar`) ?? ctx.resolveItem(creature);
            if (jar !== undefined) loot = [{ item: jar, min: 1, max: 1, p: 1 }];
        }
        const chart = ctx.wiki.pages[page]?.charts[0]?.series[0];
        if (npcIds.length === 0 || loot.length === 0) continue;
        out.push({
            method,
            creature,
            npcIds,
            level: Number(row.level) || 1,
            xp: Number(row.xp) || 0,
            chance: chart ? { low: chart.low, high: chart.high } : { low: 40, high: 200 },
            loot,
        });
    }
    ctx.log(`hunter: ${out.length} creatures (${out.map((h) => h.creature).join(", ")})`);
    return out;
}

/** Master name → task table and amounts (the amounts are [design]; the wiki module has none). */
const MASTERS: [string, string, number, number][] = [
    ["Spria", "turael", 15, 50],
    ["Turael", "turael", 15, 50],
    ["Mazchna", "mazchna", 30, 70],
    ["Vannaka", "vannaka", 40, 100],
    ["Chaeldar", "chaeldar", 70, 130],
    ["Konar quo Maten", "konar", 50, 120],
    ["Nieve", "nieve", 110, 170],
    ["Steve", "nieve", 110, 170],
    ["Duradel", "duradel", 130, 200],
    ["Krystilia", "krystilia", 50, 100],
];

export function exportSlayer(ctx: SkillsExportContext): SlayerDef {
    const monsters: SlayerDef["monsters"] = {};
    const categories = new Set<string>();
    for (const a of ctx.spawned) {
        if (!a.actions?.some((x) => /^attack$/i.test(x))) continue;
        const row = ctx.wiki.monsters.find((m) => m.ids.includes(a.id)) ?? ctx.wiki.monsters.find((m) => m.ids.includes(a.displayId));
        if (!row || row.slayerCategories.length === 0) continue;
        monsters[a.id] = { level: row.slayerLevel, xp: row.slayerXp || row.hitpoints, categories: row.slayerCategories };
        for (const c of row.slayerCategories) categories.add(c.toLowerCase());
    }
    const masters = MASTERS.flatMap(([name, table, min, max]) => {
        const npcIds = ctx.spawnedNamed(name);
        const tasks = (ctx.wiki.slayerMasters.find((m) => m.master === table)?.tasks ?? []).filter((t) => categories.has(t.category.toLowerCase()));
        return npcIds.length === 0 || tasks.length === 0 ? [] : [{ name, npcIds, min, max, tasks }];
    });
    ctx.log(`slayer: ${masters.length} masters, ${Object.keys(monsters).length} slayer monsters`);
    return { masters, monsters };
}

export function exportShops(ctx: SkillsExportContext): ShopDef[] {
    const shops: ShopDef[] = [];
    const spawns = ctx.spawned;
    for (const a of spawns) {
        if (!a.actions?.some((x) => /^trade$/i.test(x))) continue;
        const name = stripNameTags(a.name).toLowerCase();
        const candidates = ctx.wiki.shops.filter((s) => s.owner.toLowerCase() === name);
        if (candidates.length === 0) continue;
        // Several shops with this owner: the one nearest any spawn of the NPC.
        const at = ctx.spawnsOf(a.id);
        const dist = (s: (typeof candidates)[number]) =>
            s.map ? Math.min(...at.map((p) => Math.hypot(p.x - s.map!.x, p.y - s.map!.y)), Infinity) : Infinity;
        const shop = candidates.reduce((best, s) => (dist(s) < dist(best) ? s : best), candidates[0]);
        const existing = shops.find((s) => s.name === shop.page);
        if (existing) {
            existing.npcIds.push(a.id);
            continue;
        }
        const items = shop.items.flatMap((i) => {
            const item = ctx.resolveItem(i.name);
            if (item === undefined) return [];
            return [{ item, stock: i.stock, price: i.price, shopPays: i.shopPays ?? Math.floor(i.price * 0.4), restockTicks: i.restockTicks }];
        });
        if (items.length > 0) shops.push({ name: shop.page, npcIds: [a.id], items });
    }
    ctx.log(`shops: ${shops.length}`);
    return shops;
}
