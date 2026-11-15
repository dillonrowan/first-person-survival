// Just enough wikitext parsing for infobox and template parameters.

export type Tile = { x: number; y: number; plane: number };

const norm = (name: string) => name.trim().replace(/_/g, " ").toLowerCase();

/** Splits on `sep` at brace and bracket depth 0 (counting `{{ }}` and `[[ ]]`). */
function splitTop(text: string, sep: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
        const two = text.slice(i, i + 2);
        if (two === "{{" || two === "[[") {
            depth++;
            i++;
        } else if ((two === "}}" || two === "]]") && depth > 0) {
            depth--;
            i++;
        } else if (depth === 0 && text[i] === sep) {
            parts.push(text.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(text.slice(start));
    return parts;
}

/** Index just past the `}}` closing the template that opens at `start`, or -1. */
function templateEnd(text: string, start: number): number {
    let depth = 0;
    for (let i = start; i < text.length - 1; i++) {
        const two = text.slice(i, i + 2);
        if (two === "{{") {
            depth++;
            i++;
        } else if (two === "}}") {
            depth--;
            i++;
            if (depth === 0) return i + 1;
        }
    }
    return -1;
}

/** Every `{{name …}}` in the text, as parameter maps (unnamed parameters get keys "1", "2"…). */
export function findTemplates(text: string, name: string): Record<string, string>[] {
    const out: Record<string, string>[] = [];
    const want = norm(name);
    for (let i = text.indexOf("{{"); i >= 0; i = text.indexOf("{{", i + 2)) {
        const end = templateEnd(text, i);
        if (end < 0) break;
        const body = text.slice(i + 2, end - 2);
        const parts = splitTop(body, "|");
        if (norm(parts[0]) !== want) continue;
        const params: Record<string, string> = {};
        let positional = 0;
        for (const part of parts.slice(1)) {
            const eq = part.indexOf("=");
            // A "=" inside a nested template or link does not name the parameter.
            const nested = Math.min(...["{{", "[["].map((s) => (part.includes(s) ? part.indexOf(s) : Infinity)));
            if (eq >= 0 && eq < nested) params[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
            else params[String(++positional)] = part.trim();
        }
        out.push(params);
    }
    return out;
}

/** `[[A|B]]` to B and `[[A]]` to A; drops refs, `<br />`, templates and HTML tags. */
export function stripLinks(s: string): string {
    let t = s.replace(/<ref[^>]*\/>/gi, "").replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "");
    t = t.replace(/<br\s*\/?>/gi, " ");
    for (let prev = ""; prev !== t; ) {
        prev = t;
        t = t.replace(/\{\{[^{}]*\}\}/g, "");
    }
    t = t.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2").replace(/\[\[([^\]]*)\]\]/g, "$1");
    t = t.replace(/<[^>]+>/g, "");
    return unescapeHtml(t).trim();
}

export function unescapeHtml(s: string): string {
    return s
        .replace(/&amp;/g, "&")
        .replace(/&#0?39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ");
}

/** A position from `{{Map|x=…|y=…|plane=…}}`, `{{Map|2984,3291|…}}` or `x = 2843 … y = …`. */
export function mapCoords(s: string): Tile | undefined {
    const map = findTemplates(s, "Map")[0];
    if (map) {
        if (map.x !== undefined && map.y !== undefined) {
            return { x: parseInt(map.x), y: parseInt(map.y), plane: parseInt(map.plane ?? "0") || 0 };
        }
        const pair = /^\s*(\d+)\s*,\s*(\d+)/.exec(map["1"] ?? "");
        if (pair) return { x: Number(pair[1]), y: Number(pair[2]), plane: parseInt(map.plane ?? "0") || 0 };
    }
    const x = /\bx\s*=\s*(\d+)/.exec(s);
    const y = /\by\s*=\s*(\d+)/.exec(s);
    if (x && y) {
        const plane = /\bplane\s*=\s*(\d+)/.exec(s);
        return { x: Number(x[1]), y: Number(y[1]), plane: plane ? Number(plane[1]) : 0 };
    }
    return undefined;
}

/** Comma-separated integers ("1276, 1278") to numbers. */
export function parseIds(s: string | undefined): number[] {
    return (s ?? "")
        .split(",")
        .map((p) => parseInt(stripLinks(p)))
        .filter((n) => Number.isInteger(n));
}
