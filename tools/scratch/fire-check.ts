import fs from "node:fs";
import { gunzipSync } from "fflate";
import { decodeNpcModel } from "../../src/world/NpcFormat";
const buf = gunzipSync(fs.readFileSync("public/world/skill-models/loc-26185.bin"));
const m = decodeNpcModel(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
console.log(m.vertexCount, m.opaque.indices.length, m.transparent.indices.length, m.idle?.frameLengths, m.idle?.positions.length);
