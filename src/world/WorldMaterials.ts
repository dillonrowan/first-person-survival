import * as THREE from "three";

import { RS_UNITS_PER_TILE, UV_SCALE } from "./WorldFormat";
import { WorldTextures } from "./WorldTextures";

// Vertex layout is documented in WorldFormat.MeshData. Lighting is baked into the vertex colors,
// so the shader only decodes, textures, scrolls animated textures and fogs.
const vertexShader = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform sampler2D u_materials;
uniform float u_time;

in vec4 a_position;
in vec4 a_color;
in vec2 a_uv;

out vec4 v_color;
out vec2 v_uv;
flat out float v_layer;
flat out float v_alphaCutOff;
out float v_viewDistance;

void main() {
    int info = int(a_position.w);
    int layer = info & 255;
    float priority = float((info >> 8) & 31);
    float plane = float((info >> 13) & 3);

    vec4 material = texelFetch(u_materials, ivec2(layer, 0), 0);
    v_uv = a_uv / ${UV_SCALE.toFixed(1)} + u_time * material.xy;
    v_layer = float(layer);
    v_alphaCutOff = material.z;
    v_color = a_color;

    // RS units (+y down, +z north) to tiles in three.js space (+y up, north is -z).
    vec3 position = vec3(a_position.x, -a_position.y, -a_position.z) / ${RS_UNITS_PER_TILE.toFixed(1)};
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    v_viewDistance = length(viewPosition.xyz);

    // Depth bias: higher planes and draw priorities win when faces are coplanar
    // (decals on walls, floor decorations on tiles). Scaled with distance to beat depth precision.
    float bias = plane * 0.005 + priority * 0.0007;
#ifdef CEILING
    // The OSRS camera never looks up at a floor. Seen from below, floors and roofs have to cover
    // the bottoms of things standing on them, which the priority bias would push through.
    bias += 0.02;
#endif
    viewPosition.z += bias * max(1.0, -viewPosition.z / 16.0);

    gl_Position = projectionMatrix * viewPosition;
}
`;

const fragmentShader = /* glsl */ `
precision highp float;
precision highp sampler2DArray;

uniform sampler2DArray u_textures;
uniform vec3 u_fogColor;
uniform float u_fogNear;
uniform float u_fogFar;

in vec4 v_color;
in vec2 v_uv;
flat in float v_layer;
flat in float v_alphaCutOff;
in float v_viewDistance;

out vec4 fragColor;

void main() {
    // Layer 0 is white, so untextured faces just get their vertex color.
    vec4 texel = texture(u_textures, vec3(v_uv, v_layer));
    vec4 color = texel * v_color;
#ifdef ALPHA_PASS
    if ((v_layer == 0.0 && color.a < 0.01) || texel.a < v_alphaCutOff) {
        discard;
    }
#endif
    float fog = smoothstep(u_fogNear, u_fogFar, v_viewDistance);
    fragColor = vec4(mix(color.rgb, u_fogColor, fog), color.a);
}
`;

export type WorldMaterials = {
    /** Front faces of the terrain mesh (ground, floors and roofs seen from above). */
    terrain: THREE.RawShaderMaterial;
    /** Back faces of the same mesh: ceilings and roof undersides seen from below. */
    ceiling: THREE.RawShaderMaterial;
    opaque: THREE.RawShaderMaterial;
    transparent: THREE.RawShaderMaterial;
    /**
     * The alpha pass drawn over everything: no depth test or write. For effects on held weapons
     * (a magic bow's shimmer), which would otherwise cut into the weapon, its string and the world.
     * Shares the uniforms, so its textures scroll with the rest.
     */
    overlay: THREE.RawShaderMaterial;
    setTime(seconds: number): void;
};

export function createWorldMaterials(
    textures: WorldTextures,
    fog: { color: THREE.Vector3; near: number; far: number },
): WorldMaterials {
    // Shared by all three materials, so one update reaches every region.
    const uniforms = {
        u_textures: { value: textures.array },
        u_materials: { value: textures.materials },
        u_time: { value: 0 },
        // Raw sRGB values: the shader writes display colors directly, like the OSRS client.
        u_fogColor: { value: fog.color },
        u_fogNear: { value: fog.near },
        u_fogFar: { value: fog.far },
    };

    const create = (side: THREE.Side, transparent: boolean, defines: Record<string, string> = {}) =>
        new THREE.RawShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader,
            fragmentShader,
            uniforms,
            side,
            transparent,
            depthWrite: true,
            defines: transparent ? { ...defines, ALPHA_PASS: "" } : defines,
        });

    return {
        terrain: create(THREE.FrontSide, false),
        ceiling: create(THREE.BackSide, false, { CEILING: "" }),
        opaque: create(THREE.FrontSide, false),
        transparent: create(THREE.FrontSide, true),
        overlay: Object.assign(create(THREE.DoubleSide, true), { depthTest: false, depthWrite: false }),
        setTime(seconds: number) {
            uniforms.u_time.value = seconds;
        },
    };
}
