import type { CameraOffset } from "../player/CameraRig";
import { PICKPOCKET_CLIPS, PICKPOCKET_CLIP_FPS, PickpocketClip } from "./PickpocketClips";

/** Seconds a new clip crossfades from wherever the view was. [design] */
const BLEND = 0.1;

/** The view offset, and `stow`: how far the held weapon or tool is put away (0 held, 1 lowered). */
type Look = Required<CameraOffset> & { stow: number };

const zero = (): Look => ({ pitch: 0, yaw: 0, roll: 0, lean: 0, dip: 0, stow: 0 });

/** A Blender clip's view offset at `t` seconds, held on its last frame. */
export function sampleLook(clip: PickpocketClip, t: number, out: Look = zero()): Look {
    const frames = PICKPOCKET_CLIPS[clip];
    const last = frames.length - 1;
    const f = Math.min(last, Math.max(0, t * PICKPOCKET_CLIP_FPS));
    const i = Math.min(last - 1, Math.floor(f));
    const a = frames[i];
    const b = frames[i + 1];
    const k = f - i;
    const at = (n: number) => a[n] + (b[n] - a[n]) * k;
    out.lean = at(0);
    out.dip = at(1);
    out.pitch = at(2);
    out.yaw = at(3);
    out.roll = at(4);
    out.stow = at(5);
    return out;
}

/**
 * What pickpocketing looks like in first person, with no hand drawn: the held weapon is put away,
 * the view glances down at the mark's pocket and leans in, then looks away innocently, or is jerked
 * back upright when caught, and the weapon comes back up (clips from tools/blender/pickpocket.py).
 */
export class PickpocketView {
    private clip: PickpocketClip | undefined;
    private time = 0;
    private readonly current = zero();
    private readonly from = zero();
    private blend = 0;

    get playing(): PickpocketClip | undefined {
        return this.clip;
    }

    play(clip: PickpocketClip): void {
        Object.assign(this.from, this.current);
        this.blend = BLEND;
        this.clip = clip;
        this.time = 0;
    }

    /** Per frame: the offset to add to the first-person view and the weapon's stow (all zero when idle). */
    update(dt: number): Readonly<Look> {
        const clip = this.clip;
        const look = this.current;
        if (!clip) return Object.assign(look, zero());
        this.time += dt;
        const length = (PICKPOCKET_CLIPS[clip].length - 1) / PICKPOCKET_CLIP_FPS;
        // The reach holds on the pocket until the outcome; the others end upright.
        if (clip !== "reach" && this.time >= length) this.clip = undefined;
        sampleLook(clip, this.time, look);
        if (this.blend > 0) {
            this.blend = Math.max(0, this.blend - dt);
            const k = 1 - this.blend / BLEND;
            for (const key of Object.keys(look) as (keyof Look)[]) look[key] = this.from[key] + (look[key] - this.from[key]) * k;
        }
        return look;
    }
}
