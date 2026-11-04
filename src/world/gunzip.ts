export async function gunzip(buffer: ArrayBuffer): Promise<ArrayBuffer> {
    const bytes = new Uint8Array(buffer, 0, 2);
    // A server may already have removed the gzip layer (Content-Encoding), so check the magic.
    if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
        return buffer;
    }
    const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).arrayBuffer();
}
