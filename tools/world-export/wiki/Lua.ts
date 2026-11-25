// Turns a Lua table literal (`return { … }`, as in the wiki's data modules) into JSON values.

export type LuaValue = string | number | boolean | null | LuaValue[] | { [key: string]: LuaValue };

export function parseLuaTable(src: string): LuaValue {
    let i = src.indexOf("{", src.search(/\breturn\b/) >= 0 ? src.search(/\breturn\b/) : 0);
    if (i < 0) throw new Error("no table");

    const skip = () => {
        for (;;) {
            while (i < src.length && /\s/.test(src[i])) i++;
            if (src.startsWith("--[[", i)) {
                const end = src.indexOf("]]", i);
                i = end < 0 ? src.length : end + 2;
            } else if (src.startsWith("--", i)) {
                while (i < src.length && src[i] !== "\n") i++;
            } else return;
        }
    };

    const string = (): string => {
        const quote = src[i++];
        let out = "";
        while (i < src.length && src[i] !== quote) {
            if (src[i] === "\\") {
                const c = src[i + 1];
                out += c === "n" ? "\n" : c === "t" ? "\t" : c;
                i += 2;
            } else out += src[i++];
        }
        i++;
        return out;
    };

    // Arithmetic on numbers, e.g. `(2/16 / 45)` or `25 * 2`.
    const factor = (): number => {
        skip();
        if (src[i] === "(") {
            i++;
            const v = sum();
            skip();
            i++; // )
            return v;
        }
        if (src[i] === "-") {
            i++;
            return -factor();
        }
        const m = /^(?:0x[0-9a-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?|\.\d+)/i.exec(src.slice(i));
        if (!m) throw new Error(`unexpected "${src.slice(i, i + 20)}"`);
        i += m[0].length;
        return Number(m[0]);
    };
    const product = (): number => {
        let v = factor();
        for (skip(); src[i] === "*" || src[i] === "/"; skip()) v = src[i++] === "*" ? v * factor() : v / factor();
        return v;
    };
    const sum = (): number => {
        let v = product();
        for (skip(); (src[i] === "+" || src[i] === "-") && !src.startsWith("--", i); skip()) v = src[i++] === "+" ? v + product() : v - product();
        return v;
    };

    const value = (): LuaValue => {
        skip();
        const c = src[i];
        if (c === "(" || /[\d.-]/.test(c)) return sum();
        if (c === "{") return table();
        if (c === "'" || c === '"') return string();
        if (src.startsWith("[[", i)) {
            const end = src.indexOf("]]", i);
            const s = src.slice(i + 2, end);
            i = end + 2;
            return s;
        }
        const m = /^(-?(?:0x[0-9a-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?|\.\d+)|true|false|nil|[A-Za-z_][\w.]*)/i.exec(src.slice(i));
        if (!m) throw new Error(`unexpected "${src.slice(i, i + 20)}"`);
        i += m[0].length;
        if (m[0] === "true") return true;
        if (m[0] === "false") return false;
        if (m[0] === "nil") return null;
        const n = Number(m[0]);
        return Number.isNaN(n) ? m[0] : n;
    };

    const table = (): LuaValue => {
        i++; // {
        const positional: LuaValue[] = [];
        const named: Record<string, LuaValue> = {};
        let hasNamed = false;
        for (;;) {
            skip();
            if (src[i] === "}") {
                i++;
                break;
            }
            let key: string | undefined;
            if (src[i] === "[" && src[i + 1] !== "[") {
                const close = src.indexOf("]", i);
                key = src.slice(i + 1, close).trim().replace(/^["']|["']$/g, "");
                i = close + 1;
                skip();
                i++; // =
            } else {
                const m = /^([A-Za-z_]\w*)\s*=(?!=)/.exec(src.slice(i));
                if (m) {
                    key = m[1];
                    i += m[0].length;
                }
            }
            const v = value();
            if (key !== undefined) {
                named[key] = v;
                hasNamed = true;
            } else positional.push(v);
            skip();
            if (src[i] === "," || src[i] === ";") i++;
        }
        if (!hasNamed) return positional;
        positional.forEach((v, k) => (named[String(k + 1)] = v));
        return named;
    };

    return value();
}
