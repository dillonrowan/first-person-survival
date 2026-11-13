import { units } from "../player/MoveMath";

/**
 * Every combat constant, converted to tiles and seconds. Each comment names its source in
 * docs/combat-movement-spec.md: [data], [cvar], [gh]/[ev] (decompiled behaviour), [inferred] or
 * [design]. Mutable so dev builds can tweak values live (window.game.tuning).
 */
export const tuning = {
    // --- 3.1 Melee input ---
    /** Hold time that turns a press into a power-attack charge. [ev E-MELEE: 400 × frametime × 0.06] */
    chargeThreshold: 0.36,
    /** Same for daggers (200). [cvar mm_player_mintime_to_bigslash_daggers] */
    chargeThresholdDaggers: 0.18,
    /** A press buffers the next quick strike once the current one passes this fraction. [cvar 0.6] */
    chainWindowStart: 0.6,
    /** Quick strikes keep alternating sides until the weapon has rested this long; then A again. [design] */
    quickChainReset: 1,
    /** A queued strike cuts into the current one once this fraction of its recovery has played. [design] */
    quickRecoveryCut: 0.4,
    /** Clicks an attack can queue ahead; each becomes one more quick strike. [design] */
    quickQueue: 3,

    // --- Move timelines (no animation data shipped with the spec) [design] ---
    quickWindup: 0.12,
    quickActive: 0.12,
    quickRecovery: 0.26,
    powerWindup: 0.08,
    powerActive: 0.16,
    powerRecovery: 0.42,

    // --- 3.3 Special-attack triggers ---
    /** Fall speed that turns an attack into the falling attack. [cvar mm_player_speed_to_active_fall 125] */
    fallAttackSpeed: units(125),
    /** Pitch below which a power attack on a knocked-down target becomes a trample. [design] */
    tramplePitch: (-30 * Math.PI) / 180,

    // --- 4 / 17.2 Hit detection: the attack ray's 90° fan (see SwingRay) ---
    /** Width of the cone in which a knocked-down target counts as aimed at, for trample. [design] */
    sideArc: (60 * Math.PI) / 180,
    /** Short melee targets get limited downward aim assistance. */
    meleeAimRetries: 3,
    meleeAimDrop: 0.18,

    // --- 5 Damage ---
    /** Scales WDmg × HitPow into health points. [design] */
    strengthScale: 10,
    /** Armour of anyone wearing none. [data first_basic → armordefenderbase] */
    baseArmour: 0.01,
    /** Damage multiplier on NPCs that have not noticed the player. [data ai.mul_damages_Npc_Not_alerted] */
    unawareMultiplier: 3,
    /** Reaction thresholds as a fraction of max health. [cvar/inferred] */
    flinchFraction: 0.05,
    staggerFraction: 0.2,
    pushFraction: 0.3,
    knockdownFraction: 0.4,
    /** [data ai.GlobalStunChanceMultiplier] */
    stunChanceMultiplier: 1.5,
    /** [design; the data's 4 s is gated by 20 hits in the game] */
    stunDuration: 1.0,
    /** [data ai.KnockedDownTime] */
    knockdownDuration: 2.0,
    /** NPC hits push the player. [data ai.PlayerPushOnHit 250 u/s] */
    playerPushOnHit: units(250),
    /** An NPC arrow or spell pushes the player this fraction of playerPushOnHit. [design] */
    npcProjectilePush: 0.3,

    // --- 8 Adrenaline ---
    /** [data player_adrenaline_base_max / _needed] */
    adrenalineMax: 20,
    /** One point is lost each time this many seconds pass. [gh 0x22429280] */
    adrenalineDecayInterval: 20,
    adrenalineDecayAmount: 1,

    // --- NPCs ---
    /** Health per combat level, with a floor. [design] */
    npcHealthPerLevel: 6,
    npcMinHealth: 20,
    /** Seconds an NPC stays in combat mode (not wandering) after being hit. [design] */
    npcCombatMemory: 10,
    /** Seconds a corpse (ragdoll) stays before it is removed. [design] */
    corpseTime: 30,
    /** Most corpses at once; the oldest goes first. [cvar g_ragdoll_maxcount 8] */
    ragdollMax: 8,
    /** Impulse along the killing blow on the body, kg·tiles/s. [data ai.force_damage_death 300; gh 0x222cb600] */
    deathForce: units(300),
    /**
     * A killing blow also launches the whole body along the hit (tiles/s): this much, plus
     * deathLaunchPerPow per unit of the hit's HitPow (counted up to deathLaunchMaxPow), with
     * deathLaunchLift of that speed upwards so it leaves the ground. Scaled by
     * sqrt(npcBaseMass / mass) within deathLaunchMassScale. [design]
     */
    deathLaunchSpeed: 2.5,
    deathLaunchPerPow: 1.5,
    deathLaunchMaxPow: 3,
    deathLaunchLift: 0.4,
    deathLaunchMassScale: [0.5, 1.4] as [number, number],
    /** How much a melee hit drives along the blade's travel rather than away from the attacker. [design] */
    swingPushWeight: 0.7,
    /** A hit too light to push still shoves the target this far per HitPow along the swing. [design] */
    hitNudge: units(16),
    /**
     * A body flying into a standing NPC (spec 20.7): faster than this it knocks the NPC down.
     * [gh 0x22341360: cvar mm_ragdoll_vel_to_damage 300 × 0.25; the game only pushes below 300 u/s]
     */
    ragdollHitSpeed: units(75),
    /** Faster than this the hit also hurts: ragdollHitDamage × strengthScale, never lethal. [gh 0x22341360: 300 u/s, 10] */
    ragdollHurtSpeed: units(300),
    ragdollHitDamage: 10,
    /** The same body knocks the same NPC down at most once in this many seconds. [gh 0x222aabb0: 2.0] */
    ragdollHitRepeat: 2.0,

    // --- Player ---
    /** [source: CBasePlayer default] */
    playerMaxHealth: 100,
    /** The player takes hits (reactions, feedback) but never loses health. [design: testing] */
    playerUnlimitedHealth: true,

    // --- 7 Kick (player_animations.mdl attack_kick_*, 24 fps, 21 frames) ---
    /** Whole kick animation. [data: 21 frames at 24 fps] */
    kickDuration: 21 / 24,
    /** Hit event (2117) of the low and medium kicks. [data: cycle 0.30 / 0.40] */
    kickHitTimeLow: 0.3 * (20 / 24),
    kickHitTimeMedium: 0.4 * (20 / 24),
    /** Looking further down than this picks the low kick. [design; the game has bands at 30–65°] */
    kickLowPitch: (-25 * Math.PI) / 180,
    /** [cvar mm_player_maxdist_for_kick 100 u] */
    kickReach: units(100),
    /** On a miss the trace is retried this many times, each lower. [gh 0x2242e8b0] */
    kickRetries: 6,
    kickRetryDrop: units(10),
    /** [cvar mm_player_stamina_needed_for_kick] */
    kickStaminaNeeded: 3,
    /** [data player.stamina_kick_npc / stamina_kick_all] */
    kickStaminaNpc: 3,
    kickStaminaOther: 1,
    /** [data player.kick_damage] Not applied: kicks knock NPCs down without hurting them. [design] */
    kickDamage: 1,
    /** Kick impactcoeff. [data player_basic.qct attack_kick_*] */
    kickImpactCoeff: 2,
    /** Force by target mass. [data mm_game_settings all.Min/MaxForce, Min/MaxWeigth; gh FUN_223ded60] */
    massForceMin: 1000,
    massForceMax: 7000,
    massWeightMin: 1,
    massWeightMax: 100,
    /** Mass of a one-tile NPC; scales with size². [design] */
    npcBaseMass: 80,
    /** NPC kick dodge chance: starts here, grows per kick. [data npc_guard dodge_on_kick_*] */
    kickDodgeInit: 0.2,
    kickDodgeAdd: 0.3,
    /** Seconds without kicks before the dodge chance resets. [design] */
    kickDodgeReset: 10,
    /** The NPC must face the kicker this squarely to dodge. [gh FUN_222a8810: dot > 0.8] */
    kickDodgeFacing: 0.8,
    /** Upward speed a kicked NPC's ragdoll starts with, so it is sent off instead of dragging its feet (tiles/s). [design] */
    kickLift: 1.2,
    /** Knocked-down time after a kick (every kick that lands knocks down). [data ai.KnockedDownTimeKick] */
    knockdownKick: 2.0,
    /** After a fall off a ledge. [data ai.KnockedDownTimeFall] */
    knockdownFall: 0.5,
    /** Speed a kicked NPC must still have when it meets a wall to be slammed down. [design] */
    wallSlamSpeed: 2.5,
    /** [data ai.PhysicsMediumDamages] */
    wallSlamDamage: 5,

    // --- 5.3 Hit reactions, from npc_guard_combat_animations.mdl (24 fps) ---
    /** Small hit: 14 frames, no movement, does not stop the NPC acting. [data] */
    smallHitTime: 14 / 24,
    /** Medium hit: locked until event 2209 at 0.50 s; moves 31 u (front), 35 u (side), 41 u (back). [data] */
    mediumHitTime: 0.5,
    mediumHitDistance: { front: units(31), side: units(35), back: units(41) },
    /** Long hit / push: locked ~0.92 s; moves 88 u (front), 60 u (side), 64 u (back). [data] */
    longHitTime: 0.92,
    longHitDistance: { front: units(88), side: units(60), back: units(64) },
    /** Stand-up animation after a knockdown (StandUp_front 51 f, StandUp_back 46 f). [data] */
    standUpFront: 51 / 24,
    standUpBack: 46 / 24,

    // --- 10 NPC combat movement (guard data) ---
    /** Ground speeds, tiles/s. [data: Walk 37 u/s, CombatWalk 42, Run 165, run back 111, run side 80] */
    npcWalkSpeed: units(37),
    npcCombatWalkSpeed: units(42),
    npcRunSpeed: units(165),
    /** Beyond this path distance NPCs run, closer they combat-walk. [cvar mm_ai_dist_walk_path 250 u] */
    npcRunDistance: units(250),
    /** Combat zones, centre to centre. [data npc_guard Red 40 / Green 80 / Yellow 120 u] */
    zoneRed: units(40),
    zoneGreen: units(80),
    zoneYellow: units(120),
    /** Combat step lengths (fwd/back 15/30/40 u, sideways 23/47 u) and time (~18 frames). [data] */
    stepLengths: [units(15), units(30), units(40)],
    sideStepLengths: [units(23), units(47)],
    stepTime: 18 / 24,
    /** Pause between combat steps. [design] */
    stepPauseMin: 0.15,
    stepPauseMax: 0.6,
    /** Zig-zag while chasing. [data ai.ZigZag*: cone 15°, steer 35°, min 240 u; gh FUN_22291820] */
    zigzagCone: (15 * Math.PI) / 180,
    zigzagSteer: (35 * Math.PI) / 180,
    zigzagMinDistance: units(240),
    /** Flee below this health fraction for up to TimeFleeStop. [data life_toflee 0.2, ai.TimeFleeStop 20] */
    fleeHealth: 0.2,
    fleeTime: 20,
    /** Give up the fight when the player is this far away for TimeUntilNPCLoosePlayer. [data 1500 u, 3 s] */
    loseDistance: units(1500),
    loseTime: 3,
    /** OSRS walk clip's natural speed, for speed-matched playback (4 RS units per 20 ms). [design] */
    clipWalkSpeed: 200 / 128,

    // --- 16.2 Jump [gh 0x223f2fc0] ---
    /** Take-off speed. */
    jumpSpeed: units(160),
    /** Extra upward acceleration while jump stays held, for jumpHoldTime after take-off (160 × 0.7 × 6). */
    jumpHoldAccel: units(160 * 0.7 * 6),
    jumpHoldTime: 0.3,
    /** A falling player may still jump with ground this close below. [cvar mm_player_dist_to_allow_jump] */
    jumpGroundSnap: units(17),
    /** sv_gravity. */
    gravity: units(600),

    // --- 16.5 Enemy damage [gh 0x224d5840] ---
    /** Player armour with none worn; subtracted ×100 from every hit. [data armordefenderbase] */
    playerArmour: 0.01,
    /** NPC strength added to the weapon's WDmg (guard). [data npc_guard] */
    npcStrength: 7,
    /** NPC weapon damage (short sword WDmg). [data sword_short] */
    npcWeaponDamage: 2,

    // --- 16.7 Aggro [gh 0x222ce8a0, 0x222c74a0, 0x2228ea70; data ai] ---
    /** Full view-cone angles, calm and alerted. */
    fovCalm: (90 * Math.PI) / 180,
    fovAlerted: (160 * Math.PI) / 180,
    /** Half of fielofviewheightangle. */
    fovVertical: (30 * Math.PI) / 180,
    sightRange: units(1500),
    /** visible iff visibility / (dist / range) > visibilityRatio. */
    visibilityRatio: 1.4,
    /** Always seen this close while fighting. [RangeViewToStealthMaxInCombat] */
    sightInCombat: units(200),
    stealthFovScale: 0.4,
    stealthRangeScale: 0.6,
    /** Sight reaction delay: 0 normally, 8 s in stealth scaled by distance. */
    stealthSightDelay: 8,
    stealthDelayBands: [
        [units(500), 0.3],
        [units(700), 0.5],
    ] as [number, number][],
    /** Player presence radii by movement (stealth walk, walk, run, sprint). [data SoundPresenceDist_*] */
    presenceCrouch: units(100),
    presenceWalk: units(300),
    presenceRun: units(500),
    presenceSprint: units(900),
    /** Height difference beyond which presence is not heard. [SoundPresenceHeightClip] */
    hearingHeightClip: units(300),
    /** Hearing reaction delay; none for sprint-level sounds. [delayhear, NoDelayHearAbovePresence] */
    hearingDelay: 1,
    /** Search after losing sight. [cvar mm_ai_search_time; data SearchRadius] */
    searchTime: 10,
    searchRadius: units(600),

    // --- 16.6 NPC attack rhythm [data npc_guard] ---
    attackCoolMin: 2.0,
    attackCoolMax: 3.5,
    attackBerserkMin: 0,
    attackBerserkMax: 1.0,
    rhythmSwitchMin: 10,
    rhythmSwitchMax: 15,
    /** No player attack for this long sends the NPC berserk. [PlayerNoAttackDelayToGoBersekerMode] */
    berserkAfterIdle: 2,
    /** NPC strike cone half-angle. [design] */
    npcStrikeCone: (60 * Math.PI) / 180,

    // --- Player defence ---
    /** View punch while parrying vs not. [cvar mm_player_punch_factor(_when_parrying)] */
    punch: 0.4,
    punchParrying: 0.15,
    /** Death fade before respawning. [cvar mm_player_death_fadeout_duration] */
    deathFade: 4,

    // --- 16.4 Bow ---
    arrowSpeed: units(2100),
    bowDrawReady: 1.433,
    bowDrawTotal: 2.0,
    bowReloadReady: 0.933,
    bowShootTime: 0.233,
    bowReleaseAt: 0.033,
    bowLowerTime: 0.667,
    /**
     * Shortbows (any bow named "shortbow"; every other bow is a longbow, drawn as above): a quicker
     * draw and re-draw, and a slower arrow, so it drops sooner and carries less far. [design]
     */
    shortbowDrawReady: 0.95,
    shortbowReloadReady: 0.6,
    shortbowArrowSpeed: units(1470),
    /**
     * Longbow and crossbow shots fall under this share of gravity: besides flying faster than a
     * shortbow's they stay up longer, so they carry further and hang in the air longer. [design]
     */
    longbowGravityScale: 0.6,
    /** Seconds an arrow or bolt stays stuck in a wall or the ground before it disappears. [design] */
    arrowStuckTime: 10,
    /** Field-of-view scale when zoomed. [design] */
    bowZoomFov: 0.5,
    /** Steady-aim window after the draw. [cvar mm_time_bow_stabilisation] */
    bowSteadyTime: 4,
    /** Aim sway amplitude (radians) without stability. [design] */
    bowSway: 0.02,
    bowHitPow: 1.5,
    bowAdrenaline: 2,
    arrowsStart: 30,
    /** Crossbow: seconds to span the string and seat a bolt, after each shot and on equipping. [design] */
    crossbowReloadTime: 1.8,
    /** Crossbow: seconds of recoil after a shot before the reload starts. [design] */
    crossbowRecoilTime: 0.3,
    /** Repeating crossbow (Karil's): bolts its magazine holds. [design] */
    repeaterMagazine: 7,
    /** Repeater: seconds of one lever stroke, spanning the string and dropping the next bolt. [design] */
    repeaterCycleTime: 0.32,
    /** Repeater: seconds of recoil after a shot before the lever stroke starts. [design] */
    repeaterRecoilTime: 0.1,
    /** Repeater: seconds to lower it, drop a full magazine of bolts in and raise it again. [design] */
    repeaterReloadTime: 2.6,
    boltsStart: 30,
    arrowsMax: 99,

    // --- 19 Physics props ---
    /** Throw impulse = F(mass) × this. [cvar mm_player_throwforce; gh 0x22467290] */
    throwForce: 10,
    /** Throw direction: view pitch lowered by this (Source pitch grows downward). [cvar mm_throw_object_angle_minus] */
    throwPitchDown: (20 * Math.PI) / 180,
    /** Random spin per axis on a throw, × throwforceangular (2), degrees/s. [gh; cvar] */
    throwSpin: 10 * 2,
    /** Pick-up reach. [data player.PlayerTakeDist 130 u] */
    takeReach: units(130),
    /** Heaviest prop the player can lift. [data player.PlayerThrowMassClamp; use inferred] */
    liftMassMax: 100,
    /** Rate at which a held prop follows its hold point, 1/s. [cvar mm_player_take_interp_speed; meaning inferred] */
    holdFollowRate: 12,
    /** A held prop further than this from its hold point (stuck on a wall) is dropped. [design] */
    holdDropDistance: 1.5,
    /** Prop speed below which it does not damage NPCs. [data ai.PhysicsSpeedToDamageNPCs 70 u/s] */
    propSpeedToDamageNpc: units(70),
    /** Mass classes for NPC damage. [data ai.PhysicsWeightToDamageNPCsMedium / Big] */
    propMediumMass: 10,
    propBigMass: 50,
    /** NPC damage per class (× strengthScale, spec 19.11). [data ai.PhysicsSmall/Medium/BigDamages] */
    propDamageSmall: 3,
    propDamageMedium: 5,
    propDamageBig: 8,
    /** Reaction by impact energy in joules (½mv², 1 u = 2.54 cm). [data ai.PropDamageEnergySmall / Medium; units inferred] */
    propEnergySmall: 500,
    propEnergyMedium: 4000,
    /** [data ai.KnockedDownTimePhysics] */
    knockdownPhysics: 2.0,
    /** Seconds after a throw during which hits count as thrown by the player. [gh 0x22365530: 0.6] */
    thrownWindow: 0.6,
    /** Player mass for impacts and pushing. [source: player physics shadow 85 kg] */
    playerMass: 85,
    /** Coulomb friction while sliding on the ground, and bounce. [design, spec 19.10] */
    propFriction: 0.6,
    propRestitution: 0.25,
    /** Pushers move a prop at their speed × min(1, pusher mass / (2 × prop mass)). [design] */
    pushMassFactor: 2,
    /** Sleep below this speed after this long on the ground. [design] */
    propSleepSpeed: 0.05,
    propSleepTime: 0.5,
    /** Gibs fade after this many seconds. [design] */
    gibLifetime: 4,

    // --- 19.8 Falling [gh FUN_221d5750, FUN_22173de0] ---
    /** Landing faster than this hurts. [gh constant 526.5 u/s] */
    fallSafeSpeed: units(526.5),
    /** Damage per u/s above the safe speed (100 / (922.5 − 526.5)). [gh 0.2525] */
    fallDamagePerUnit: 100 / (922.5 - 526.5),
    /** Fraction of fall damage taken. [data player_reduce_fall 60] */
    fallDamageScale: 0.6,
    /** Smaller fall damage is ignored. [cvar min_damage_to_activate_long_fall] */
    fallMinDamage: 5,
};

export type Tuning = typeof tuning;
