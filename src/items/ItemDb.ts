import { PREFERRED_ITEM_IDS, type ItemInfo, type ItemManifest } from "../world/ItemFormat";

/** Every exported item by id and name. */
export class ItemDb {
    private readonly byId = new Map<number, ItemInfo>();
    private readonly nameIndex = new Map<string, ItemInfo>();

    constructor(readonly items: readonly ItemInfo[]) {
        for (const item of items) {
            this.byId.set(item.id, item);
            const key = item.name.toLowerCase();
            const existing = this.nameIndex.get(key);
            if (!existing || item.id < existing.id) this.nameIndex.set(key, item);
        }
    }

    /** Loads items.json; throws with a hint when it is missing (npm run export-items). */
    static async load(url: string): Promise<ItemDb> {
        const response = await fetch(url);
        // Vite dev server answers missing files with index.html (status 200), so check the type too.
        const contentType = response.headers.get("content-type") ?? "";
        if (!response.ok || !contentType.includes("json")) {
            throw new Error("No items found. Create them once with: npm run export-items");
        }
        return new ItemDb(((await response.json()) as ItemManifest).items);
    }

    get(id: number): ItemInfo | undefined {
        return this.byId.get(id);
    }

    /** The item with this name (case-insensitive): its preferred id, else the lowest id. */
    byName(name: string): ItemInfo | undefined {
        const key = name.toLowerCase();
        const preferred = PREFERRED_ITEM_IDS[key];
        return (preferred !== undefined ? this.byId.get(preferred) : undefined) ?? this.nameIndex.get(key);
    }

    search(text: string, limit = 50): ItemInfo[] {
        const query = text.trim().toLowerCase();
        if (query === "") return [];
        const out: ItemInfo[] = [];
        for (const item of this.items) {
            if (item.name.toLowerCase().includes(query)) {
                out.push(item);
                if (out.length >= limit) break;
            }
        }
        return out;
    }
}
