/** Lines kept on screen, and seconds before a line fades. */
const MAX_LINES = 7;
const FADE_AFTER_MS = 20_000;

/** The game message log, bottom left: "You get some logs." and the like. */
export class MessageLog {
    constructor(private readonly element: HTMLElement) {}

    add(text: string): void {
        const line = document.createElement("div");
        line.textContent = text;
        this.element.append(line);
        while (this.element.children.length > MAX_LINES) this.element.firstElementChild?.remove();
        setTimeout(() => line.classList.add("faded"), FADE_AFTER_MS);
    }
}
