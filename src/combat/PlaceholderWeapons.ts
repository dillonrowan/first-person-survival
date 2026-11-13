import * as THREE from "three";

import type { WeaponDef } from "./weapons";

/**
 * Simple weapon meshes built in code, following the same contract as glTF weapons
 * (docs/weapon-models.md): units are tiles, the origin is the centre of the grip, the blade or head
 * points along +Y and the edge faces +Z.
 */
export function createPlaceholderWeapon(weapon: WeaponDef): THREE.Group {
    const group = new THREE.Group();
    group.name = `weapon_${weapon.id}`;
    const steel = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: 0.8, roughness: 0.35 });
    const leather = new THREE.MeshStandardMaterial({ color: 0x4a2e1c, roughness: 0.9 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a5530, roughness: 0.8 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xb08d3c, metalness: 0.7, roughness: 0.4 });
    const add = (geometry: THREE.BufferGeometry, material: THREE.Material, y: number) => {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.y = y;
        group.add(mesh);
        return mesh;
    };

    switch (weapon.id) {
        // Blades are thin in X and wide in Z, so the edge (Z) leads the swing; guards lie in the
        // blade's plane, across it.
        case "daggers":
            add(new THREE.BoxGeometry(0.03, 0.12, 0.03), leather, 0);
            add(new THREE.BoxGeometry(0.035, 0.02, 0.12), brass, 0.07);
            add(new THREE.BoxGeometry(0.008, 0.26, 0.04), steel, 0.21).name = "blade";
            break;
        case "club":
            add(new THREE.CylinderGeometry(0.02, 0.025, 0.16, 8), leather, 0);
            add(new THREE.CylinderGeometry(0.06, 0.03, 0.42, 10), wood, 0.29);
            break;
        case "bow": {
            // A limb arc through the grip (+Y up the bow), with a string on the -Z side.
            add(new THREE.CylinderGeometry(0.025, 0.025, 0.12, 8), leather, 0);
            const limb = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.015, 6, 24, Math.PI * 0.6), wood);
            limb.rotation.set(0, Math.PI / 2, Math.PI / 2 - Math.PI * 0.3);
            limb.position.z = 0.5;
            group.add(limb);
            const string = new THREE.Mesh(
                new THREE.CylinderGeometry(0.003, 0.003, 0.88, 4),
                new THREE.MeshStandardMaterial({ color: 0xe8e0c8 }),
            );
            string.position.z = 0.06;
            group.add(string);
            break;
        }
        case "staff":
            add(new THREE.CylinderGeometry(0.022, 0.022, 1.3, 8), wood, 0.15);
            add(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 8), brass, 0.8);
            add(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 8), brass, -0.5);
            break;
        default: {
            if (weapon.family === "bow") {
                add(new THREE.CylinderGeometry(0.025, 0.025, 0.12, 8), leather, 0);
                const limb = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.015, 6, 24, Math.PI * 0.6), wood);
                limb.rotation.set(0, Math.PI / 2, Math.PI / 2 - Math.PI * 0.3);
                limb.position.z = 0.5;
                group.add(limb);
                const string = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.003, 0.003, 0.88, 4),
                    new THREE.MeshStandardMaterial({ color: 0xe8e0c8 }),
                );
                string.position.z = 0.06;
                group.add(string);
                break;
            }
            if (weapon.family === "staff") {
                add(new THREE.CylinderGeometry(0.022, 0.022, 1.3, 8), wood, 0.15);
                add(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 8), brass, 0.8);
                add(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 8), brass, -0.5);
                break;
            }
            if (weapon.family === "daggers") {
                add(new THREE.BoxGeometry(0.03, 0.12, 0.03), leather, 0);
                add(new THREE.BoxGeometry(0.035, 0.02, 0.12), brass, 0.07);
                add(new THREE.BoxGeometry(0.008, 0.26, 0.04), steel, 0.21).name = "blade";
                break;
            }
            const blade = weapon.id === "shortsword" ? 0.44 : 0.62;
            add(new THREE.CylinderGeometry(0.02, 0.02, 0.16, 8), leather, 0);
            add(new THREE.SphereGeometry(0.03, 8, 6), brass, -0.1);
            add(new THREE.BoxGeometry(0.04, 0.025, 0.2), brass, 0.09);
            add(new THREE.BoxGeometry(0.01, blade, 0.05), steel, 0.1 + blade / 2).name = "blade";
            break;
        }
    }
    return group;
}
