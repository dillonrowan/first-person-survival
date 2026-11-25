// A small client for the OSRS wiki API: Bucket queries, template users, page wikitext and raw pages.

const API = "https://oldschool.runescape.wiki/api.php";
const INDEX = "https://oldschool.runescape.wiki/index.php";
const USER_AGENT = "first-person-survival-dev/0.1 (personal prototype)";
const PAGE_SIZE = 500;
const RETRIES = 4;
const RETRY_MS = 2000;
const GAP_MS = 250;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let lastRequest = 0;

/** GET with the project User-Agent, at most one request per 250 ms, retried 4 times 2 s apart. */
async function get(url: string): Promise<string> {
    let error: unknown;
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
        const wait = lastRequest + GAP_MS - Date.now();
        if (wait > 0) await sleep(wait);
        lastRequest = Date.now();
        try {
            const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
            if (response.ok) return await response.text();
            error = new Error(`${url}: HTTP ${response.status}`);
        } catch (e) {
            error = e;
        }
        await sleep(RETRY_MS);
    }
    throw error;
}

async function getJson<T>(url: string): Promise<T> {
    return JSON.parse(await get(url)) as T;
}

export type BucketRow = Record<string, unknown>;

/** Every row of a Bucket, 500 per request. `where` is Lua, e.g. `.where('page_name','Oak tree')`. */
export async function bucketAll(bucket: string, fields: string[], where = ""): Promise<BucketRow[]> {
    const rows: BucketRow[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
        const select = fields.map((f) => `'${f}'`).join(",");
        const query = `bucket('${bucket}').select(${select})${where}.limit(${PAGE_SIZE}).offset(${offset}).run()`;
        const page = await getJson<{ bucket?: BucketRow[]; error?: string }>(
            `${API}?action=bucket&format=json&query=${encodeURIComponent(query)}`,
        );
        if (page.error) throw new Error(`${bucket}: ${page.error}`);
        const got = page.bucket ?? [];
        rows.push(...got);
        if (got.length < PAGE_SIZE) return rows;
    }
}

/** Titles of the pages that embed `Template:<name>`. */
export async function embeddedIn(template: string): Promise<string[]> {
    const titles: string[] = [];
    let cont: Record<string, string> = {};
    for (;;) {
        const params = new URLSearchParams({
            action: "query",
            format: "json",
            list: "embeddedin",
            eititle: `Template:${template}`,
            eilimit: "500",
            ...cont,
        });
        const page = await getJson<{
            query?: { embeddedin?: { title: string }[] };
            continue?: Record<string, string>;
        }>(`${API}?${params}`);
        titles.push(...(page.query?.embeddedin ?? []).map((p) => p.title));
        if (!page.continue) return titles;
        cont = page.continue;
    }
}

/** Wikitext of each title (redirects followed; the result is keyed by the asked title). */
export async function pagesWikitext(titles: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (let i = 0; i < titles.length; i += 50) {
        const batch = titles.slice(i, i + 50);
        const params = new URLSearchParams({
            action: "query",
            format: "json",
            formatversion: "2",
            prop: "revisions",
            rvprop: "content",
            rvslots: "main",
            redirects: "1",
            titles: batch.join("|"),
        });
        const page = await getJson<{
            query?: {
                normalized?: { from: string; to: string }[];
                redirects?: { from: string; to: string }[];
                pages?: { title: string; revisions?: { slots: { main: { content: string } } }[] }[];
            };
        }>(`${API}?${params}`);
        const text = new Map<string, string>();
        for (const p of page.query?.pages ?? []) {
            const content = p.revisions?.[0]?.slots.main.content;
            if (content !== undefined) text.set(p.title, content);
        }
        const follow = (title: string) => {
            let t = title;
            for (const n of page.query?.normalized ?? []) if (n.from === t) t = n.to;
            for (const r of page.query?.redirects ?? []) if (r.from === t) t = r.to;
            return t;
        };
        for (const title of batch) {
            const content = text.get(follow(title));
            if (content !== undefined) out.set(title, content);
        }
    }
    return out;
}

/** A page's raw source (`action=raw`), e.g. a Lua module. */
export async function raw(title: string): Promise<string> {
    return get(`${INDEX}?title=${encodeURIComponent(title)}&action=raw`);
}

/** Any URL with the project User-Agent (GitHub raw files). */
export async function fetchText(url: string): Promise<string> {
    return get(url);
}
