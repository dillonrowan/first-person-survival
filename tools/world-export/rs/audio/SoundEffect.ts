import { ByteBuffer } from "../io/ByteBuffer";

/**
 * OSRS sound effects (cache index 4) are not recordings: each is up to ten synthesizer instruments
 * (oscillators shaped by envelopes, an optional gate, echo and IIR filter) that the client renders
 * to 22050 Hz 8-bit PCM. This is a port of the client's synthesizer, integer arithmetic included,
 * so the rendered samples match what the game plays.
 */

export const SAMPLE_RATE = 22050;

/** Java's java.util.Random(0) sequence, as the client fills its noise table with it. */
function javaRandomInts(seed: bigint, count: number): Int32Array {
    const MASK = (1n << 48n) - 1n;
    let s = (seed ^ 0x5deece66dn) & MASK;
    const out = new Int32Array(count);
    for (let i = 0; i < count; i++) {
        s = (s * 0x5deece66dn + 0xbn) & MASK;
        out[i] = Number(BigInt.asIntN(32, s >> 16n));
    }
    return out;
}

const NOISE = (() => {
    const ints = javaRandomInts(0n, 32768);
    const out = new Int32Array(32768);
    for (let i = 0; i < 32768; i++) {
        out[i] = (ints[i] & 2) - 1;
    }
    return out;
})();
const SINE = Int32Array.from({ length: 32768 }, (_, i) => Math.trunc(Math.sin(i / 5215.1903) * 16384));

/** Java's (int)((long) a * b >> 16) for 32-bit a, b. */
const mulShr16 = (a: number, b: number) => Number((BigInt(a) * BigInt(b)) >> 16n) | 0;

class SoundEnvelope {
    form = 0;
    start = 0;
    end = 0;
    segments = 2;
    durations = [0, 65535];
    phases = [0, 65535];
    private threshold = 0;
    private phaseIndex = 0;
    private step = 0;
    private amplitude = 0;
    private ticks = 0;

    decode(buf: ByteBuffer): void {
        this.form = buf.readUnsignedByte();
        this.start = buf.readInt();
        this.end = buf.readInt();
        this.decodeSegments(buf);
    }

    decodeSegments(buf: ByteBuffer): void {
        this.segments = buf.readUnsignedByte();
        this.durations = [];
        this.phases = [];
        for (let i = 0; i < this.segments; i++) {
            this.durations.push(buf.readUnsignedShort());
            this.phases.push(buf.readUnsignedShort());
        }
    }

    reset(): void {
        this.threshold = 0;
        this.phaseIndex = 0;
        this.step = 0;
        this.amplitude = 0;
        this.ticks = 0;
    }

    doStep(period: number): number {
        if (this.ticks >= this.threshold) {
            this.amplitude = this.phases[this.phaseIndex++] << 15;
            if (this.phaseIndex >= this.segments) {
                this.phaseIndex = this.segments - 1;
            }
            this.threshold = Math.trunc((this.durations[this.phaseIndex] / 65536) * period);
            if (this.threshold > this.ticks) {
                this.step = Math.trunc(((this.phases[this.phaseIndex] << 15) - this.amplitude) / (this.threshold - this.ticks));
            }
        }
        this.amplitude = (this.amplitude + this.step) | 0;
        this.ticks++;
        return (this.amplitude - this.step) >> 15;
    }
}

class AudioFilter {
    readonly pairs = [0, 0];
    private readonly phases = [
        [new Array(4).fill(0), new Array(4).fill(0)],
        [new Array(4).fill(0), new Array(4).fill(0)],
    ];
    private readonly magnitudes = [
        [new Array(4).fill(0), new Array(4).fill(0)],
        [new Array(4).fill(0), new Array(4).fill(0)],
    ];
    private readonly unity = [0, 0];

    static readonly floats = [new Float32Array(8), new Float32Array(8)];
    static readonly coefficients = [new Int32Array(8), new Int32Array(8)];
    static forwardMultiplier = 0;
    private static gain = 0;

    private magnitude(dir: number, i: number, t: number): number {
        const m = this.magnitudes[dir];
        const v = Math.fround((m[0][i] + t * (m[1][i] - m[0][i])) * 0.0015258789);
        return Math.fround(1 - Math.pow(10, -v / 20));
    }

    private phase(dir: number, i: number, t: number): number {
        const p = this.phases[dir];
        const v = Math.fround((p[0][i] + t * (p[1][i] - p[0][i])) * 1.2207031e-4);
        return Math.fround((Math.fround(32.703197 * Math.pow(2, v)) * Math.PI) / 11025);
    }

    /** Recomputes the direction's coefficients at envelope position `t`; returns their count. */
    compute(dir: number, t: number): number {
        const f = AudioFilter.floats[dir];
        if (dir === 0) {
            const g = Math.fround((this.unity[0] + (this.unity[1] - this.unity[0]) * t) * 0.0030517578);
            AudioFilter.gain = Math.fround(Math.pow(0.1, g / 20));
            AudioFilter.forwardMultiplier = Math.trunc(AudioFilter.gain * 65536);
        }
        if (this.pairs[dir] === 0) {
            return 0;
        }
        let m = this.magnitude(dir, 0, t);
        f[0] = -2 * m * Math.cos(this.phase(dir, 0, t));
        f[1] = m * m;
        for (let i = 1; i < this.pairs[dir]; i++) {
            m = this.magnitude(dir, i, t);
            const a = Math.fround(-2 * m * Math.cos(this.phase(dir, i, t)));
            const b = Math.fround(m * m);
            f[i * 2 + 1] = f[i * 2 - 1] * b;
            f[i * 2] += f[i * 2 - 1] * a + f[i * 2 - 2] * b;
            for (let j = i * 2 - 1; j >= 2; j--) {
                f[j] += f[j - 1] * a + f[j - 2] * b;
            }
            f[1] += f[0] * a + b;
            f[0] += a;
        }
        if (dir === 0) {
            for (let i = 0; i < this.pairs[0] * 2; i++) {
                f[i] *= AudioFilter.gain;
            }
        }
        for (let i = 0; i < this.pairs[dir] * 2; i++) {
            AudioFilter.coefficients[dir][i] = Math.trunc(f[i] * 65536);
        }
        return this.pairs[dir] * 2;
    }

    decode(buf: ByteBuffer, envelope: SoundEnvelope): void {
        const packed = buf.readUnsignedByte();
        this.pairs[0] = packed >> 4;
        this.pairs[1] = packed & 15;
        if (packed === 0) {
            this.unity[0] = this.unity[1] = 0;
            return;
        }
        this.unity[0] = buf.readUnsignedShort();
        this.unity[1] = buf.readUnsignedShort();
        const moving = buf.readUnsignedByte();
        for (let dir = 0; dir < 2; dir++) {
            for (let i = 0; i < this.pairs[dir]; i++) {
                this.phases[dir][0][i] = buf.readUnsignedShort();
                this.magnitudes[dir][0][i] = buf.readUnsignedShort();
            }
        }
        for (let dir = 0; dir < 2; dir++) {
            for (let i = 0; i < this.pairs[dir]; i++) {
                if ((moving & ((1 << (dir * 4)) << i)) !== 0) {
                    this.phases[dir][1][i] = buf.readUnsignedShort();
                    this.magnitudes[dir][1][i] = buf.readUnsignedShort();
                } else {
                    this.phases[dir][1][i] = this.phases[dir][0][i];
                    this.magnitudes[dir][1][i] = this.magnitudes[dir][0][i];
                }
            }
        }
        if (moving !== 0 || this.unity[1] !== this.unity[0]) {
            envelope.decodeSegments(buf);
        }
    }
}

class Instrument {
    private pitch = new SoundEnvelope();
    private volume = new SoundEnvelope();
    private pitchModifier?: SoundEnvelope;
    private pitchModifierAmplitude?: SoundEnvelope;
    private volumeMultiplier?: SoundEnvelope;
    private volumeMultiplierAmplitude?: SoundEnvelope;
    private release?: SoundEnvelope;
    private attack?: SoundEnvelope;
    private readonly oscillatorVolume = new Array(5).fill(0);
    private readonly oscillatorPitch = new Array(5).fill(0);
    private readonly oscillatorDelays = new Array(5).fill(0);
    private delayTime = 0;
    private delayDecay = 100;
    duration = 500;
    offset = 0;
    private filter = new AudioFilter();
    private filterEnvelope = new SoundEnvelope();

    decode(buf: ByteBuffer): void {
        this.pitch.decode(buf);
        this.volume.decode(buf);
        const optional = (): [SoundEnvelope, SoundEnvelope] | undefined => {
            if (buf.readUnsignedByte() === 0) {
                return undefined;
            }
            buf.offset--;
            const a = new SoundEnvelope();
            a.decode(buf);
            const b = new SoundEnvelope();
            b.decode(buf);
            return [a, b];
        };
        [this.pitchModifier, this.pitchModifierAmplitude] = optional() ?? [];
        [this.volumeMultiplier, this.volumeMultiplierAmplitude] = optional() ?? [];
        [this.release, this.attack] = optional() ?? [];
        for (let i = 0; i < 10; i++) {
            const volume = buf.readUnsignedSmart();
            if (volume === 0) {
                break;
            }
            this.oscillatorVolume[i] = volume;
            this.oscillatorPitch[i] = buf.readSmart2();
            this.oscillatorDelays[i] = buf.readUnsignedSmart();
        }
        this.delayTime = buf.readUnsignedSmart();
        this.delayDecay = buf.readUnsignedSmart();
        this.duration = buf.readUnsignedShort();
        this.offset = buf.readUnsignedShort();
        this.filterEnvelope = new SoundEnvelope();
        this.filter.decode(buf, this.filterEnvelope);
    }

    private static wave(phase: number, amplitude: number, form: number): number {
        if (form === 1) {
            return (phase & 32767) < 16384 ? amplitude : -amplitude;
        }
        if (form === 2) {
            return Math.imul(SINE[phase & 32767], amplitude) >> 14;
        }
        if (form === 3) {
            return (Math.imul(amplitude, phase & 32767) >> 14) - amplitude;
        }
        if (form === 4) {
            return Math.imul(amplitude, NOISE[Math.trunc(phase / 2607) & 32767]);
        }
        return 0;
    }

    synthesize(count: number, duration: number): Int32Array {
        const samples = new Int32Array(count);
        if (duration < 10) {
            return samples;
        }
        const perMs = count / duration;
        this.pitch.reset();
        this.volume.reset();
        let pmStep = 0;
        let pmBase = 0;
        let pmPhase = 0;
        if (this.pitchModifier) {
            this.pitchModifier.reset();
            this.pitchModifierAmplitude!.reset();
            pmStep = Math.trunc(((this.pitchModifier.end - this.pitchModifier.start) * 32.768) / perMs);
            pmBase = Math.trunc((this.pitchModifier.start * 32.768) / perMs);
        }
        let vmStep = 0;
        let vmBase = 0;
        let vmPhase = 0;
        if (this.volumeMultiplier) {
            this.volumeMultiplier.reset();
            this.volumeMultiplierAmplitude!.reset();
            vmStep = Math.trunc(((this.volumeMultiplier.end - this.volumeMultiplier.start) * 32.768) / perMs);
            vmBase = Math.trunc((this.volumeMultiplier.start * 32.768) / perMs);
        }
        const phases = new Int32Array(5);
        const delays = new Int32Array(5);
        const volumeSteps = new Int32Array(5);
        const pitchSteps = new Int32Array(5);
        const pitchBaseSteps = new Int32Array(5);
        for (let o = 0; o < 5; o++) {
            if (this.oscillatorVolume[o] !== 0) {
                delays[o] = Math.trunc(this.oscillatorDelays[o] * perMs);
                volumeSteps[o] = Math.trunc((this.oscillatorVolume[o] << 14) / 100);
                pitchSteps[o] = Math.trunc(
                    ((this.pitch.end - this.pitch.start) * 32.768 * Math.pow(1.0057929410678534, this.oscillatorPitch[o])) / perMs,
                );
                pitchBaseSteps[o] = Math.trunc((this.pitch.start * 32.768) / perMs);
            }
        }
        for (let i = 0; i < count; i++) {
            let pitch = this.pitch.doStep(count);
            let volume = this.volume.doStep(count);
            if (this.pitchModifier) {
                const step = this.pitchModifier.doStep(count);
                const amp = this.pitchModifierAmplitude!.doStep(count);
                pitch += Instrument.wave(pmPhase, amp, this.pitchModifier.form) >> 1;
                pmPhase = (pmPhase + pmBase + (Math.imul(step, pmStep) >> 16)) | 0;
            }
            if (this.volumeMultiplier) {
                const step = this.volumeMultiplier.doStep(count);
                const amp = this.volumeMultiplierAmplitude!.doStep(count);
                volume = Math.imul(volume, (Instrument.wave(vmPhase, amp, this.volumeMultiplier.form) >> 1) + 32768) >> 15;
                vmPhase = (vmPhase + vmBase + (Math.imul(step, vmStep) >> 16)) | 0;
            }
            for (let o = 0; o < 5; o++) {
                if (this.oscillatorVolume[o] !== 0) {
                    const at = delays[o] + i;
                    if (at < count) {
                        samples[at] += Instrument.wave(phases[o], Math.imul(volume, volumeSteps[o]) >> 15, this.pitch.form);
                        phases[o] = (phases[o] + (Math.imul(pitch, pitchSteps[o]) >> 16) + pitchBaseSteps[o]) | 0;
                    }
                }
            }
        }
        if (this.release) {
            // A gate switching the sound on and off at rates between the two envelopes.
            this.release.reset();
            this.attack!.reset();
            let counter = 0;
            let muted = true;
            for (let i = 0; i < count; i++) {
                const r = this.release.doStep(count);
                const a = this.attack!.doStep(count);
                const threshold = muted
                    ? (Math.imul(r, this.release.end - this.release.start) >> 8) + this.release.start
                    : (Math.imul(a, this.release.end - this.release.start) >> 8) + this.release.start;
                counter += 256;
                if (counter >= threshold) {
                    counter = 0;
                    muted = !muted;
                }
                if (muted) {
                    samples[i] = 0;
                }
            }
        }
        if (this.delayTime > 0 && this.delayDecay > 0) {
            const delay = Math.trunc(this.delayTime * perMs);
            for (let i = delay; i < count; i++) {
                samples[i] += Math.trunc((samples[i - delay] * this.delayDecay) / 100);
            }
        }
        if (this.filter.pairs[0] > 0 || this.filter.pairs[1] > 0) {
            this.applyFilter(samples, count);
        }
        for (let i = 0; i < count; i++) {
            samples[i] = Math.max(-32768, Math.min(32767, samples[i]));
        }
        return samples;
    }

    private applyFilter(s: Int32Array, count: number): void {
        const C = AudioFilter.coefficients;
        this.filterEnvelope.reset();
        let env = this.filterEnvelope.doStep(count + 1);
        let fwd = this.filter.compute(0, env / 65536);
        let back = this.filter.compute(1, env / 65536);
        if (count < fwd + back) {
            return;
        }
        let i = 0;
        let end = Math.min(back, count - fwd);
        while (i < end) {
            let v = mulShr16(s[i + fwd], AudioFilter.forwardMultiplier);
            for (let k = 0; k < fwd; k++) {
                v += mulShr16(s[i + fwd - 1 - k], C[0][k]);
            }
            for (let k = 0; k < i; k++) {
                v -= mulShr16(s[i - 1 - k], C[1][k]);
            }
            s[i] = v;
            env = this.filterEnvelope.doStep(count + 1);
            i++;
        }
        end = 128;
        for (;;) {
            end = Math.min(end, count - fwd);
            while (i < end) {
                let v = mulShr16(s[i + fwd], AudioFilter.forwardMultiplier);
                for (let k = 0; k < fwd; k++) {
                    v += mulShr16(s[i + fwd - 1 - k], C[0][k]);
                }
                for (let k = 0; k < back; k++) {
                    v -= mulShr16(s[i - 1 - k], C[1][k]);
                }
                s[i] = v;
                env = this.filterEnvelope.doStep(count + 1);
                i++;
            }
            if (i >= count - fwd) {
                while (i < count) {
                    let v = 0;
                    for (let k = fwd + i - count; k < fwd; k++) {
                        v += mulShr16(s[i + fwd - 1 - k], C[0][k]);
                    }
                    for (let k = 0; k < back; k++) {
                        v -= mulShr16(s[i - 1 - k], C[1][k]);
                    }
                    s[i] = v;
                    this.filterEnvelope.doStep(count + 1);
                    i++;
                }
                break;
            }
            fwd = this.filter.compute(0, env / 65536);
            back = this.filter.compute(1, env / 65536);
            end += 128;
        }
    }
}

export class SoundEffect {
    private readonly instruments: (Instrument | undefined)[] = new Array(10);
    loopStart = 0;
    loopEnd = 0;

    static decode(data: Int8Array | Uint8Array): SoundEffect {
        const bytes = data instanceof Int8Array ? data : new Int8Array(data.buffer, data.byteOffset, data.byteLength);
        const buf = new ByteBuffer(bytes);
        const effect = new SoundEffect();
        for (let i = 0; i < 10; i++) {
            if (buf.readUnsignedByte() !== 0) {
                buf.offset--;
                const instrument = new Instrument();
                instrument.decode(buf);
                effect.instruments[i] = instrument;
            }
        }
        effect.loopStart = buf.readUnsignedShort();
        effect.loopEnd = buf.readUnsignedShort();
        return effect;
    }

    /** Renders the effect as signed 8-bit PCM at SAMPLE_RATE, like the client. */
    mix(): Int8Array {
        let length = 0;
        for (const ins of this.instruments) {
            if (ins) {
                length = Math.max(length, ins.duration + ins.offset);
            }
        }
        if (length === 0) {
            return new Int8Array(0);
        }
        const out = new Int8Array(Math.trunc((length * SAMPLE_RATE) / 1000));
        for (const ins of this.instruments) {
            if (!ins) {
                continue;
            }
            const count = Math.trunc((ins.duration * SAMPLE_RATE) / 1000);
            const offset = Math.trunc((ins.offset * SAMPLE_RATE) / 1000);
            const samples = ins.synthesize(count, ins.duration);
            for (let i = 0; i < count; i++) {
                let v = (samples[i] >> 8) + out[i + offset];
                if (((v + 128) & -256) !== 0) {
                    v = (v >> 31) ^ 127;
                }
                out[i + offset] = v;
            }
        }
        return out;
    }
}
