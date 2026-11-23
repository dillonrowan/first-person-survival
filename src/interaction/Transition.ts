// Moving the player through an entrance: fade to black, teleport, wait for the destination to
// load, fade back in. If the destination cannot load in time the player is sent back.

/** What a transition needs of the player. */
export type TransitionPlayer = {
    x: number;
    y: number;
    plane: number;
    readonly ready: boolean;
    teleport(x: number, y: number, plane: number): void;
};

export type TransitionDestination = { x: number; y: number; plane: number; message?: string };

const FADE_SECONDS = 0.35;
/**
 * Seconds the destination gets to load before the way counts as blocked. A region that fails to
 * load blocks at once; this only catches loads that hang, so it is generous (busy surface areas
 * can take well over ten seconds to stream in on a slow machine).
 */
export const LOAD_TIMEOUT_SECONDS = 60;

export const BLOCKED_MESSAGE = "The way is blocked.";

type Phase = "idle" | "out" | "waiting" | "in";

export class Transition {
    /** 0 clear .. 1 black; drives the fade overlay. */
    opacity = 0;
    private phase: Phase = "idle";
    private destination?: TransitionDestination;
    private origin?: { x: number; y: number; plane: number };
    private waited = 0;
    private returning = false;

    constructor(
        private readonly player: TransitionPlayer,
        private readonly showMessage: (text: string) => void,
        /** True once the destination's region has permanently failed to load. */
        private readonly destinationFailed: (x: number, y: number) => boolean = () => false,
    ) {}

    get active(): boolean {
        return this.phase !== "idle";
    }

    /** Starts a transition; ignored while one is running. */
    start(destination: TransitionDestination): void {
        if (this.phase !== "idle") {
            return;
        }
        this.destination = destination;
        this.origin = { x: this.player.x, y: this.player.y, plane: this.player.plane };
        this.phase = "out";
        this.returning = false;
    }

    /** Call once per frame. */
    update(dt: number): void {
        switch (this.phase) {
            case "out":
                this.opacity = Math.min(1, this.opacity + dt / FADE_SECONDS);
                if (this.opacity >= 1) {
                    const { x, y, plane } = this.destination!;
                    this.player.teleport(x, y, plane);
                    this.waited = 0;
                    this.phase = "waiting";
                }
                break;
            case "waiting":
                this.waited += dt;
                if (this.player.ready) {
                    if (!this.returning && this.destination!.message) {
                        this.showMessage(this.destination!.message);
                    }
                    this.phase = "in";
                } else if (!this.returning && (this.waited > LOAD_TIMEOUT_SECONDS || this.destinationFailed(this.destination!.x, this.destination!.y))) {
                    // Back to where the player came from; that square is still loaded or loads fast.
                    this.returning = true;
                    this.waited = 0;
                    const { x, y, plane } = this.origin!;
                    this.player.teleport(x, y, plane);
                    this.showMessage(BLOCKED_MESSAGE);
                }
                break;
            case "in":
                this.opacity = Math.max(0, this.opacity - dt / FADE_SECONDS);
                if (this.opacity <= 0) {
                    this.phase = "idle";
                }
                break;
            default:
                break;
        }
    }
}
