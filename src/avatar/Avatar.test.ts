import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { EYE_HEIGHT, SPRINT_SPEED, WALK_SPEED } from "../player/Player";
import { Avatar, AvatarTarget } from "./Avatar";
import { AvatarAnimator, LocomotionInput } from "./AvatarAnimator";
import { checkAvatarGltf, readGlbJson } from "./AvatarContract";
import { REQUIRED_CLIPS } from "./avatarConfig";
import { createPlaceholderAvatar } from "./PlaceholderAvatar";

const target = (overrides: Partial<AvatarTarget> = {}): AvatarTarget => ({
    x: 10,
    y: 20,
    z: 1,
    yaw: 0,
    pitch: 0,
    speed: 0,
    localForward: 0,
    grounded: true,
    flying: false,
    ...overrides,
});

/** Runs the animator long enough for its speed smoothing to settle. */
function settle(animator: AvatarAnimator, input: LocomotionInput) {
    for (let i = 0; i < 30; i++) {
        animator.update(0.05, input);
    }
}

describe("placeholder avatar", () => {
    it("has its eye socket at the game's eye height", () => {
        const asset = createPlaceholderAvatar();
        const eye = asset.sockets.eye.getWorldPosition(new THREE.Vector3());

        expect(eye.y).toBeCloseTo(EYE_HEIGHT, 3);
    });

    it("has every required clip with tracks that bind to its bones", () => {
        const asset = createPlaceholderAvatar();

        for (const name of REQUIRED_CLIPS) {
            const clip = asset.clips.get(name)!;
            expect(clip, name).toBeDefined();
            for (const track of clip.tracks) {
                const node = THREE.PropertyBinding.parseTrackName(track.name).nodeName;
                expect(THREE.PropertyBinding.findNode(asset.model, node), track.name).toBeTruthy();
            }
        }
    });
});

describe("AvatarContract", () => {
    it("reports missing bones, sockets and clips and accepts a complete rig", () => {
        const asset = createPlaceholderAvatar();
        const names: string[] = [];
        asset.model.traverse((o) => names.push(o.name));
        const complete = {
            skins: [{}],
            nodes: names.map((name) => ({ name })),
            animations: [...asset.clips.keys()].map((name) => ({ name })),
        };

        expect(checkAvatarGltf(complete).errors).toEqual([]);

        const broken = checkAvatarGltf({ nodes: [{ name: "hips" }], animations: [{ name: "idle" }] });
        expect(broken.errors.join(" ")).toContain('Missing bone "head"');
        expect(broken.errors.join(" ")).toContain("socket_eye");
        expect(broken.errors.join(" ")).toContain('animation "walk"');
        expect(broken.errors.join(" ")).toContain("no skin");
    });

    it("estimates triangles and warns over budget", () => {
        const report = checkAvatarGltf({
            meshes: [{ primitives: [{ indices: 0 }] }],
            accessors: [{ count: 3 * 9000 }],
        });

        expect(report.triangles).toBe(9000);
        expect(report.warnings.join(" ")).toContain("over the budget");
    });

    it("reads the JSON chunk of a .glb", () => {
        const json = new TextEncoder().encode('{"asset":{"version":"2.0"}}  ');
        const buffer = new ArrayBuffer(20 + json.length);
        const view = new DataView(buffer);
        view.setUint32(0, 0x46546c67, true);
        view.setUint32(12, json.length, true);
        view.setUint32(16, 0x4e4f534a, true);
        new Uint8Array(buffer, 20).set(json);

        expect(readGlbJson(buffer)).toEqual({ asset: { version: "2.0" } });
        expect(() => readGlbJson(new ArrayBuffer(24))).toThrow();
    });
});

describe("AvatarAnimator", () => {
    const make = () => new AvatarAnimator(createPlaceholderAvatar(), WALK_SPEED, SPRINT_SPEED);
    const motion = (speed: number, localForward = speed, over: Partial<LocomotionInput> = {}) => ({
        speed,
        localForward,
        grounded: true,
        flying: false,
        ...over,
    });

    it("goes idle -> walk -> run as speed rises, and airborne off the ground", () => {
        const animator = make();

        settle(animator, motion(0));
        expect(animator.state).toBe("idle");
        settle(animator, motion(WALK_SPEED));
        expect(animator.state).toBe("walk");
        settle(animator, motion(SPRINT_SPEED));
        expect(animator.state).toBe("run");
        settle(animator, motion(SPRINT_SPEED, SPRINT_SPEED, { grounded: false }));
        expect(animator.state).toBe("airborne");
    });

    it("scales playback with ground speed and runs backwards when walking backwards", () => {
        const animator = make();

        settle(animator, motion(WALK_SPEED));
        const normal = animator.timeScale;
        expect(normal).toBeCloseTo(1, 1);
        settle(animator, motion(WALK_SPEED * 0.6));
        expect(animator.timeScale).toBeCloseTo(normal * 0.6, 1);
        settle(animator, motion(WALK_SPEED, -WALK_SPEED));
        expect(animator.backwards).toBe(true);
        expect(animator.timeScale).toBeLessThan(0);
    });
});

describe("Avatar", () => {
    it("follows the player and hides the entire body from its first-person view", () => {
        const asset = createPlaceholderAvatar();
        const avatar = new Avatar(asset);

        avatar.update(0.05, target(), "first");
        expect(avatar.root.position.toArray()).toEqual([10, 1, -20]);
        expect(avatar.root.visible).toBe(false);
        expect(asset.headParts.every((part) => !part.visible)).toBe(true);

        avatar.update(0.05, target(), "third");
        expect(avatar.root.visible).toBe(true);
        expect(asset.headParts.every((part) => part.visible)).toBe(true);
    });

    it("does not accumulate the torso lean frame after frame", () => {
        const asset = createPlaceholderAvatar();
        const avatar = new Avatar(asset);
        const spine = asset.bones.spine!;

        avatar.update(0.05, target({ pitch: -0.8 }), "first");
        const once = spine.quaternion.clone();
        for (let i = 0; i < 20; i++) {
            avatar.update(0.05, target({ pitch: -0.8 }), "first");
        }

        expect(spine.quaternion.angleTo(once)).toBeLessThan(1e-4);
    });

    it("turns its body towards the view only when moving or far off", () => {
        const avatar = new Avatar(createPlaceholderAvatar());

        avatar.update(0.05, target({ yaw: 0.3 }), "first");
        expect(avatar.bodyYaw).toBe(0); // small turn while idle: legs stay put
        for (let i = 0; i < 40; i++) {
            avatar.update(0.05, target({ yaw: 0.3, speed: 3.5, localForward: 3.5 }), "first");
        }
        expect(avatar.bodyYaw).toBeCloseTo(0.3, 2);
    });
});
