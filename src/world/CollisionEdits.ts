import { REGION_SIZE } from "./WorldFormat";

/** Changes the collision flags of one tile: `(flags & ~clear) | set`. */
export type FlagEdit = {
    plane: number;
    tileX: number;
    tileY: number;
    set: number;
    clear: number;
};

export function applyFlagEdit(flags: number, edit: FlagEdit): number {
    return (flags & ~edit.clear) | edit.set;
}

/** Turns door flag entries into edits that clear `from` and set `to`, in that order. */
export function transitionEdits(
    plane: number,
    from: readonly [number, number, number][],
    to: readonly [number, number, number][],
): FlagEdit[] {
    return [
        ...from.map(([tileX, tileY, mask]) => ({ plane, tileX, tileY, set: 0, clear: mask })),
        ...to.map(([tileX, tileY, mask]) => ({ plane, tileX, tileY, set: mask, clear: 0 })),
    ];
}

/**
 * Edits that must be applied again whenever a map square is (re)loaded, because the square's file
 * holds the flags as exported. An open door's edit can lie in a neighbouring square too.
 */
export class PersistentEdits {
    private readonly byId = new Map<string, FlagEdit[]>();

    set(id: string, edits: FlagEdit[] | undefined): void {
        if (edits && edits.length > 0) {
            this.byId.set(id, edits);
        } else {
            this.byId.delete(id);
        }
    }

    get size(): number {
        return this.byId.size;
    }

    /** The edits inside a map square, in the order they were made. */
    forRegion(mapX: number, mapY: number): FlagEdit[] {
        const out: FlagEdit[] = [];
        for (const edits of this.byId.values()) {
            for (const edit of edits) {
                if (
                    Math.floor(edit.tileX / REGION_SIZE) === mapX &&
                    Math.floor(edit.tileY / REGION_SIZE) === mapY
                ) {
                    out.push(edit);
                }
            }
        }
        return out;
    }
}
