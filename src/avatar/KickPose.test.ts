import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { tuning } from "../combat/tuning";
import { decodeNpcModel } from "../world/NpcFormat";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { Avatar, AvatarTarget } from "./Avatar";
import type { AvatarAsset } from "./AvatarAsset";
import { createCacheAvatar } from "./CacheAvatar";
import { kickSample } from "./KickPose";
import { createPlaceholderAvatar } from "./PlaceholderAvatar";

const target: AvatarTarget = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, speed: 0, localForward: 0, grounded: true, flying: false };

/** Positions in the avatar root's space (+X right, +Y up, -Z ahead) after a frame of the kick. */
function kickAt(asset: AvatarAsset, elapsed: number | undefined, low = false) {
    const avatar = new Avatar(asset);
    avatar.setKick(kickSample(elapsed, low));
    avatar.update(1 / 60, target, "third");
    avatar.root.updateMatrixWorld(true);
    const at = (bone: THREE.Bone) => avatar.root.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));
    const b = asset.bones;
    const toe = new THREE.Vector3(0, 0, 1).applyQuaternion(b.foot_r!.getWorldQuaternion(new THREE.Quaternion()));
    return { hip: at(b.thigh_r!), ankle: at(b.foot_r!), standing: at(b.foot_l!), toe };
}

const bodies: [string, () => AvatarAsset][] = [
    ["placeholder", createPlaceholderAvatar],
    ["cache body", () => createCacheAvatar(decodeNpcModel(new Uint8Array(gunzipSync(readFileSync("public/world/npcs/3105_3105.bin"))).buffer))!],
];

describe("kick pose", () => {
    it("is fully extended at each kick's hit event and over by the end", () => {
        const at = (low: boolean, t: number) => kickSample(t, low)!;
        // The ankle is furthest ahead at the hit.
        for (const low of [false, true]) {
            const hit = low ? tuning.kickHitTimeLow : tuning.kickHitTimeMedium;
            expect(at(low, hit).foot[2]).toBeLessThan(at(low, hit - 0.05).foot[2]);
            expect(at(low, hit).foot[2]).toBeLessThan(at(low, hit + 0.1).foot[2]);
        }
        expect(kickSample(tuning.kickDuration, false)).toBeUndefined();
        expect(kickSample(undefined, false)).toBeUndefined();
        expect(kickSample(tuning.kickDuration - 1e-3, false)!.weight).toBeLessThan(0.01);
    });

    for (const [name, make] of bodies) {
        it(`${name}: kicks the right foot out ahead, sole first, standing foot planted`, () => {
            const rest = kickAt(make(), undefined);
            const medium = kickAt(make(), tuning.kickHitTimeMedium);
            const low = kickAt(make(), tuning.kickHitTimeLow, true);
            const leg = rest.hip.distanceTo(rest.ankle);

            // Medium: ankle well ahead, a little above hip height (stomach height).
            expect(medium.ankle.z).toBeLessThan(rest.ankle.z - 0.8 * leg);
            expect(medium.ankle.y).toBeGreaterThan(medium.hip.y);
            expect(medium.ankle.y).toBeLessThan(medium.hip.y + 0.5 * leg);
            // Low: ahead and near the ground.
            expect(low.ankle.z).toBeLessThan(rest.ankle.z - 0.6 * leg);
            expect(low.ankle.y).toBeLessThan(medium.ankle.y - 0.4 * leg);
            // Toes up: the foot's +Z (its toes, turned to face -Z by the root) points upward.
            expect(medium.toe.y).toBeGreaterThan(0.5);
            for (const pose of [medium, low]) {
                expect(pose.standing.distanceTo(rest.standing)).toBeLessThan(0.02);
            }
        });
    }
});
