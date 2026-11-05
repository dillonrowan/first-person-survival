import { Box, FlagsAt, collectTileBoxes } from "../physics/TileColliders";
import { segmentHitsBoxes2D } from "../physics/Bodies";
import type { Input } from "../player/Input";
import { EYE_HEIGHT } from "../player/Player";

export const INTERACT_RANGE = 2.5;

export type Ray = {
    ox: number;
    oy: number;
    oz: number;
    /** Unit direction in tile space (x east, y north, z up). */
    dx: number;
    dy: number;
    dz: number;
    plane: number;
    range: number;
};

/** Something the player can aim at and act on. */
export type Target = {
    kind: string;
    label: string;
    /** Menu options; E runs the first, R the second. */
    actions: string[];
    /** Distance along the ray to where it was hit. */
    distance: number;
    ref: unknown;
};

/** Returns the nearest thing of its kind hit by the ray, if any. */
export type TargetSource = (ray: Ray) => Target | undefined;
export type ActionHandler = (target: Target, action: string, index: number) => void;
export type InteractionUi = { setPrompt(text: string): void; showMessage(text: string): void };
export type InteractionPlayer = {
    x: number;
    y: number;
    z: number;
    plane: number;
    yaw: number;
    pitch: number;
    flying: boolean;
};

const ACTION_KEYS = ["KeyE", "KeyR"];
const KEY_LABELS = ["E", "R"];

/** Aims from the player's eyes, picks the nearest visible target and runs its actions. */
export class Interaction {
    target: Target | undefined;

    private readonly boxes: Box[] = [];
    private promptText = "";

    constructor(
        private readonly flagsAt: FlagsAt,
        private readonly sources: TargetSource[],
        private readonly ui: InteractionUi,
        private readonly onAction: ActionHandler,
    ) {}

    /** Call once per frame, before the input's per-frame state is cleared. */
    update(player: InteractionPlayer, input: Pick<Input, "wasPressed">): void {
        this.target = player.flying ? undefined : this.aim(player);

        const target = this.target;
        this.setPrompt(
            target
                ? target.actions
                      .slice(0, ACTION_KEYS.length)
                      .map((action, i, all) => `[${KEY_LABELS[i]}] ${action}${i === 0 ? ` ${target.label}` : ""}`)
                      .join("   ")
                : "",
        );
        if (!target) {
            return;
        }
        ACTION_KEYS.forEach((key, index) => {
            if (index < target.actions.length && input.wasPressed(key)) {
                this.onAction(target, target.actions[index], index);
            }
        });
    }

    private aim(player: InteractionPlayer): Target | undefined {
        const cosPitch = Math.cos(player.pitch);
        const ray: Ray = {
            ox: player.x,
            oy: player.y,
            oz: player.z + EYE_HEIGHT,
            dx: -Math.sin(player.yaw) * cosPitch,
            dy: Math.cos(player.yaw) * cosPitch,
            dz: Math.sin(player.pitch),
            plane: player.plane,
            range: INTERACT_RANGE,
        };

        let nearest: Target | undefined;
        for (const source of this.sources) {
            const hit = source(ray);
            if (hit && (!nearest || hit.distance < nearest.distance)) {
                nearest = hit;
            }
        }
        if (!nearest) {
            return undefined;
        }

        // Walls block the view; objects such as counters and bank booths do not.
        const hitX = ray.ox + ray.dx * nearest.distance;
        const hitY = ray.oy + ray.dy * nearest.distance;
        collectTileBoxes(
            this.flagsAt,
            ray.plane,
            Math.min(ray.ox, hitX),
            Math.min(ray.oy, hitY),
            Math.max(ray.ox, hitX),
            Math.max(ray.oy, hitY),
            this.boxes,
            "walls",
        );
        return segmentHitsBoxes2D(ray.ox, ray.oy, hitX, hitY, this.boxes) === undefined
            ? nearest
            : undefined;
    }

    private setPrompt(text: string): void {
        if (text !== this.promptText) {
            this.promptText = text;
            this.ui.setPrompt(text);
        }
    }

    /** Tells the player something, e.g. "Something is in the way." */
    say(text: string): void {
        this.ui.showMessage(text);
    }
}
