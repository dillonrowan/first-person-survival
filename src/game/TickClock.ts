import { SERVER_TICK_SECONDS } from "../npc/NpcMovement";

export const TICK_SECONDS = SERVER_TICK_SECONDS;
/** Most ticks one update fires, so a long frame (tab in the background) does not run minutes of game. */
const MAX_TICKS_PER_UPDATE = 5;

/** The OSRS game tick: skilling, respawn and despawn timers count these. */
export class TickClock {
    /** Ticks since load. */
    tick = 0;
    private carry = 0;
    private readonly listeners = new Set<(tick: number) => void>();

    /** Calls `fn` on every tick; returns the unsubscribe function. */
    onTick(fn: (tick: number) => void): () => void {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    /** 0..1: how far real time is into the current tick (for smooth animation). */
    get tickFraction(): number {
        return this.carry / TICK_SECONDS;
    }

    update(dt: number): void {
        this.carry += dt;
        let fired = 0;
        while (this.carry >= TICK_SECONDS && fired < MAX_TICKS_PER_UPDATE) {
            this.carry -= TICK_SECONDS;
            this.fire();
            fired++;
        }
        if (this.carry >= TICK_SECONDS) this.carry = 0;
    }

    /** Fires `ticks` ticks now (tests and the dev console). */
    advance(ticks: number): void {
        for (let i = 0; i < ticks; i++) this.fire();
    }

    private fire(): void {
        this.tick++;
        for (const fn of [...this.listeners]) fn(this.tick);
    }
}
