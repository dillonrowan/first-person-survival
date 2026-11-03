import bzip2 from "bzip2";

export class Bzip2 {
    static bzip2Header = new Uint8Array("BZh1".split("").map((char) => char.charCodeAt(0)));

    static decompress(compressed: Uint8Array, actualSize: number): Int8Array {
        // Cache containers strip the "BZh1" stream header, so put it back before decoding.
        const compressedBzip = new Uint8Array(compressed.length + 4);
        compressedBzip.set(Bzip2.bzip2Header, 0);
        compressedBzip.set(compressed, 4);

        const decompressed: Uint8Array = bzip2.simple(bzip2.array(compressedBzip));
        if (decompressed.length !== actualSize) {
            throw new Error(`Bzip2: expected ${actualSize} bytes, got ${decompressed.length}`);
        }
        return new Int8Array(decompressed.buffer, decompressed.byteOffset, decompressed.byteLength);
    }
}
