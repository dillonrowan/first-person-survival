// public/world/map.json: the world map images tools/world-export/export-map.ts renders.

export const MAP_FORMAT_VERSION = 3;

/** A rendered stretch of map: an image and the world tiles it covers. */
export type MapImage = {
    /** Image file next to map.json; north is up. */
    image: string;
    /** World tile at the image's south-west corner. */
    originX: number;
    originY: number;
    /** Tiles across and up the image. */
    tilesX: number;
    tilesY: number;
};

/** A way between two places on the map: the loc's tile and where it leads. */
export type MapLink = {
    /** Loc name and action, e.g. "Cave Entrance (Enter)". */
    label: string;
    x: number;
    y: number;
    toX: number;
    toY: number;
    /** Index into MapManifest.dungeons of the destination, or -1 for the surface. */
    to: number;
};

/** One dungeon area: a group of exported underground map squares joined by walkable edges. */
export type DungeonMap = MapImage & {
    /** The name most of its squares carry. */
    name: string;
    /** Its map squares, [mapX, mapY]. */
    squares: [number, number][];
    /** The dungeon each square belongs to, parallel to `squares` (one area can hold several). */
    names: string[];
    /** Locs inside it that lead out of it (to the surface or another dungeon area). */
    exits: MapLink[];
};

export type MapManifest = MapImage & {
    format: number;
    /** Pixels per tile, for every image. */
    scale: number;
    /** Mineable rocks on the map (ground level), by their skills.json rock name. */
    rocks: { name: string; x: number; y: number }[];
    /** Surface locs that lead into a dungeon. */
    entrances: MapLink[];
    dungeons: DungeonMap[];
};

/** Index of the dungeon area holding a world tile, or -1 (the surface or somewhere unmapped). */
export function dungeonAt(dungeons: Pick<DungeonMap, "squares">[], x: number, y: number): number {
    const mapX = Math.floor(x / 64);
    const mapY = Math.floor(y / 64);
    return dungeons.findIndex((d) => d.squares.some(([sx, sy]) => sx === mapX && sy === mapY));
}

/** The name of the dungeon at a world tile within an area, else the area's own name. */
export function dungeonNameAt(area: Pick<DungeonMap, "name" | "squares" | "names">, x: number, y: number): string {
    const mapX = Math.floor(x / 64);
    const mapY = Math.floor(y / 64);
    const i = area.squares.findIndex(([sx, sy]) => sx === mapX && sy === mapY);
    return i >= 0 ? area.names[i] : area.name;
}
