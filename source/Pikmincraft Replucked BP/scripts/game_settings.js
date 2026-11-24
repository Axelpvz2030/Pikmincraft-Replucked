export const NAMESPACE = "pkc";

export const SETTINGS = {
  custom_components: {
    pikmin_item: {
      id: `${NAMESPACE}:pikmin_item`,
    },
    whistle: {
      id: `${NAMESPACE}:whistle`,
    },
  },
  dynamic_properties: {
    ownerId: `${NAMESPACE}:owner_id`,
    invulnerableUntil: `${NAMESPACE}:invulnerable_until`,
    calledBackActive: `${NAMESPACE}:called_back_active`,
    spottedItem: `${NAMESPACE}:spotted_item`,
    despawning: `${NAMESPACE}:despawning`,
  },
  entity_properties: {
    stage: `${NAMESPACE}:stage`,
    state: `${NAMESPACE}:state`,
    spawnMode: `${NAMESPACE}:spawn_mode`,
  },
  pikmin: {
    landingSearchRadius: 4.0,
    midAirItemSearchRadius: 2.5,
    gatherDurationTicks: 60, // 3 seconds
    returnRetryTicks: 20, // 1 second
    postWhistleInvulnTicks: 100, // 5 seconds
    despawnSweepDelayTicks: 2, // Wait for transform -> drop_equipment
    despawnSweepRadius: 2.5,
    aggroSignalDamage: 0.67,
    indirectHitDamage: 0.2,
    executeThresholdHp: 1.0,
    executeDamage: 9999,
    throwVelocityMultiplier: 1.2,
  },
  latch: {
    maxPoints: 5,
    angerDelayTicks: 60, // 2 seconds after hitting 5 points
    stunDurationTicks: 40, // 2 seconds stunned
    shakeKnockbackHorizontal: 0.8,
    shakeKnockbackVertical: 0.4,
    aabbPadding: 0.15,
    validDamageCauses: ["entityAttack", "contact", "projectile"],
  },
  whistle: {
    maxRayDistance: 30.0,
    whistleRadius: 4.5,
    callParticleId: "minecraft:heart_particle",
    callSoundId: "random.orb",
  },
  exclude_target_families: [
    "pikmin",
    "pikmin_projectile",
    "inanimate",
    "projectile",
    "player",
  ],
  exclude_target_types: [
    "minecraft:item",
    "minecraft:xp_orb",
    "minecraft:armor_stand",
    "minecraft:arrow",
    "minecraft:snowball",
    "minecraft:thrown_trident",
  ],
};