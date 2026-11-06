import { mkdirSync, writeFileSync } from "node:fs";
import { readCacheFiles } from "../world-export/cache-files";
import { createWorldLoaders } from "../world-export/WorldLoaders";
import { SAMPLE_RATE, SoundEffect } from "../world-export/rs/audio/SoundEffect";
const L = createWorldLoaders(readCacheFiles("cache"));
const out = process.argv[2];
mkdirSync(out, { recursive: true });
const wav = (pcm: Int8Array) => {
    const b = Buffer.alloc(44 + pcm.length);
    b.write("RIFF", 0); b.writeUInt32LE(36 + pcm.length, 4); b.write("WAVE", 8); b.write("fmt ", 12);
    b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(SAMPLE_RATE, 24); b.writeUInt32LE(SAMPLE_RATE, 28);
    b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write("data", 36); b.writeUInt32LE(pcm.length, 40);
    for (let i = 0; i < pcm.length; i++) b[44 + i] = (pcm[i] + 128) & 255;
    return b;
};
for (const spec of process.argv.slice(3)) {
    const [id, name] = spec.split(":");
    const data = L.soundEffectData(+id);
    if (!data) { console.log(id, name, "missing"); continue; }
    const t0 = performance.now();
    const pcm = SoundEffect.decode(data).mix();
    let peak = 0, rms = 0, zc = 0;
    for (let i = 0; i < pcm.length; i++) { peak = Math.max(peak, Math.abs(pcm[i])); rms += pcm[i] * pcm[i]; if (i && (pcm[i] >= 0) !== (pcm[i - 1] >= 0)) zc++; }
    rms = Math.sqrt(rms / Math.max(1, pcm.length));
    writeFileSync(`${out}/${id}_${name}.wav`, wav(pcm));
    console.log(`${id} ${name}: ${(pcm.length / SAMPLE_RATE).toFixed(3)}s peak ${peak} rms ${rms.toFixed(1)} ~${Math.round((zc / 2) / (pcm.length / SAMPLE_RATE))}Hz (${(performance.now() - t0).toFixed(0)}ms)`);
}
