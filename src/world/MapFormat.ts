// public/world/map.json: the world map image tools/world-export/export-map.ts renders.

export const MAP_FORMAT_VERSION = 2;

export type MapManifest = {
    format: number;
    /** Image file next to map.json; north is up. */
    image: string;
    /** World tile at the image's south-west corner. */
    originX: number;
    originY: number;
    /** Tiles across and up the image. */
    tilesX: number;
    tilesY: number;
    /** Pixels per tile. */
    scale: number;
    /** Mineable rocks on the map (ground level), by their skills.json rock name. */
    rocks: { name: string; x: number; y: number }[];
};
