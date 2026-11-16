// public/world/map.json: the world map image tools/world-export/export-map.ts renders.

export const MAP_FORMAT_VERSION = 1;

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
};
