/** Every skilling roll goes through here, so tests can script it. */
export let random: () => number = Math.random;

export function setRandom(fn: () => number): void {
    random = fn;
}

/** An integer from min to max inclusive. */
export function randInt(min: number, max: number): number {
    return max <= min ? min : min + Math.floor(random() * (max - min + 1));
}
