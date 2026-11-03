import { gunzipSync } from "fflate";

export class Gzip {
    static decompress(compressed: Uint8Array): Int8Array {
        const decompressed = gunzipSync(compressed);
        return new Int8Array(decompressed.buffer, decompressed.byteOffset, decompressed.byteLength);
    }
}
