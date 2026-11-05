/** Keyboard and pointer-lock mouse state, read once per frame by the player. */
export class Input {
    private readonly down = new Set<string>();
    private readonly pressed = new Set<string>();
    private lookX = 0;
    private lookY = 0;
    private wheel = 0;

    locked = false;
    onLockChange?: (locked: boolean) => void;

    constructor(private readonly canvas: HTMLCanvasElement) {
        window.addEventListener("keydown", (e) => {
            if (!this.locked) {
                return;
            }
            if (!e.repeat) {
                this.pressed.add(e.code);
            }
            this.down.add(e.code);
            if (e.code === "Space" || e.code === "Tab" || e.code.startsWith("Arrow") || e.code.startsWith("Alt")) {
                e.preventDefault();
            }
        });
        window.addEventListener("keyup", (e) => this.down.delete(e.code));
        window.addEventListener("mousedown", (e) => {
            if (this.locked) {
                this.pressed.add(`Mouse${e.button}`);
                this.down.add(`Mouse${e.button}`);
            }
        });
        window.addEventListener("mouseup", (e) => this.down.delete(`Mouse${e.button}`));
        window.addEventListener("contextmenu", (e) => e.preventDefault());
        window.addEventListener(
            "wheel",
            (e) => {
                if (this.locked) {
                    this.wheel += Math.sign(e.deltaY);
                }
            },
            { passive: true },
        );
        window.addEventListener("blur", () => this.down.clear());
        document.addEventListener("mousemove", (e) => {
            if (this.locked) {
                this.lookX += e.movementX;
                this.lookY += e.movementY;
            }
        });
        document.addEventListener("pointerlockchange", () => {
            this.locked = document.pointerLockElement === this.canvas;
            if (!this.locked) {
                this.down.clear();
            }
            this.onLockChange?.(this.locked);
        });
    }

    lock(): void {
        this.canvas.requestPointerLock();
    }

    isDown(...codes: string[]): boolean {
        return codes.some((code) => this.down.has(code));
    }

    /** True only in the frame the key went down. */
    wasPressed(code: string): boolean {
        return this.pressed.has(code);
    }

    /** -1, 0 or 1 from a pair of opposing keys. */
    axis(positive: string, negative: string): number {
        return (this.down.has(positive) ? 1 : 0) - (this.down.has(negative) ? 1 : 0);
    }

    /** Mouse movement since the last call, in pixels. */
    consumeLook(): [number, number] {
        const look: [number, number] = [this.lookX, this.lookY];
        this.lookX = 0;
        this.lookY = 0;
        return look;
    }

    /** Wheel notches since the last call (positive = scrolled down). */
    consumeWheel(): number {
        const w = this.wheel;
        this.wheel = 0;
        return w;
    }

    endFrame(): void {
        this.pressed.clear();
    }
}
