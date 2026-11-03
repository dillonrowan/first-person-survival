declare module "bzip2" {
    type BitReader = (bits: number) => number;

    const bzip2: {
        array(bytes: Uint8Array): BitReader;
        simple(bits: BitReader): Uint8Array;
    };

    export default bzip2;
}
