import type { NpcClip } from "../world/NpcFormat";

/** The OSRS client updates animations and movement every 20 ms. */
export const CLIENT_CYCLE_SECONDS = 0.02;

export type ClipPlayback = { frame: number; cycle: number };

/**
 * Advances a clip by client cycles; frame i is shown for exactly frameLengths[i] cycles. Returns
 * true if the frame changed.
 */
export function advanceClip(
    playback: ClipPlayback,
    clip: Pick<NpcClip, "frameLengths" | "frameStep">,
    cycles: number,
): boolean {
    const frameCount = clip.frameLengths.length;
    const start = playback.frame;
    for (let i = 0; i < cycles; i++) {
        playback.cycle++;
        if (playback.cycle > clip.frameLengths[playback.frame]) {
            playback.cycle = 1;
            playback.frame++;
            if (playback.frame >= frameCount) {
                const restart = clip.frameStep > 0 ? playback.frame - clip.frameStep : 0;
                playback.frame = restart >= 0 && restart < frameCount ? restart : 0;
            }
        }
    }
    return playback.frame !== start;
}

/**
 * Copies the positions of `frame` into a mesh's position attribute (x, y, z, info per vertex),
 * leaving the info component alone.
 */
export function writeFramePositions(
    target: Int16Array,
    sources: Uint16Array,
    framePositions: Int16Array,
    frame: number,
    vertexCount: number,
): void {
    const frameBase = frame * vertexCount;
    for (let v = 0; v < sources.length; v++) {
        const from = (frameBase + sources[v]) * 3;
        const to = v * 4;
        target[to] = framePositions[from];
        target[to + 1] = framePositions[from + 1];
        target[to + 2] = framePositions[from + 2];
    }
}

/**
 * three.js rotation.y for a client orientation (2048 per turn). At orientation 0 the model faces
 * south; the OSRS yaw turns the opposite way round as three.js' because RS north is three.js -z.
 */
export function orientationToYaw(orientation: number): number {
    return (-orientation * Math.PI) / 1024;
}
