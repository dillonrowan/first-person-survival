// Parses RuneLite's time-tracking farming tables (BSD-2-Clause): which varbit value of a patch
// shows which crop at which stage (PatchImplementation.java), and how fast crops grow (Produce.java).

export type PatchRange = { from: number; to: number; produce: string; state: string; stageExpr: string };
export type PatchTable = { impl: string; ranges: PatchRange[] };
export type ProduceRow = { produce: string; name: string; impl: string; tickrate: number; stages: number; regrow?: number; harvestStages?: number };

export function parseFarming(java: string): PatchTable[] {
    const out: PatchTable[] = [];
    const heads = [...java.matchAll(/^\t([A-Z_]+)\(Tab\.\w+, "[^"]*", (?:true|false)\)/gm)];
    heads.forEach((head, k) => {
        const body = java.slice(head.index!, k + 1 < heads.length ? heads[k + 1].index : java.length);
        const ranges: PatchRange[] = [];
        const re = /if \(value (?:>= (\d+) && value <= (\d+)|== (\d+))\)\s*\{[^}]*?return new PatchState\(Produce\.(\w+), CropState\.(\w+), ([^)]+)\);/g;
        for (const m of body.matchAll(re)) {
            const from = Number(m[1] ?? m[3]);
            const to = Number(m[2] ?? m[3]);
            ranges.push({ from, to, produce: m[4], state: m[5], stageExpr: m[6].trim() });
        }
        out.push({ impl: head[1], ranges });
    });
    return out;
}

export function parseProduce(java: string): ProduceRow[] {
    const out: ProduceRow[] = [];
    for (const m of java.matchAll(/^\t([A-Z_]+)\("([^"]+)",(.*)\),?\s*$/gm)) {
        const args = m[3].split(",").map((a) => a.trim());
        const at = args.findIndex((a) => a.startsWith("PatchImplementation."));
        if (at < 0) continue;
        const nums = args.slice(at + 2).map(Number);
        out.push({
            produce: m[1],
            name: m[2],
            impl: args[at].slice("PatchImplementation.".length),
            tickrate: nums[0],
            stages: nums[1],
            ...(nums.length >= 4 ? { regrow: nums[2], harvestStages: nums[3] } : {}),
        });
    }
    return out;
}

/** Evaluates a stage expression: `value`, integers, `+` and `-`. */
export function evalStage(expr: string, value: number): number {
    const tokens = expr.replace(/\s+/g, "").match(/[+-]|value|\d+/g) ?? [];
    let total = 0;
    let sign = 1;
    for (const t of tokens) {
        if (t === "+") sign = 1;
        else if (t === "-") sign = -1;
        else {
            total += sign * (t === "value" ? value : Number(t));
            sign = 1;
        }
    }
    return total;
}
