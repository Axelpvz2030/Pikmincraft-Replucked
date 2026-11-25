import {
  world,
  system,
  ItemStack,
  EntityComponentTypes,
  EntityDamageCause,
} from "@minecraft/server";
import { NAMESPACE, SETTINGS } from "../game_settings";
import { activeProjectiles, latchManager } from "../exports";
import { Vec3 } from "../utils/Vec3";
import {
  buildPikminEntityId,
  buildPikminItemId,
  buildThrownPikminEntityId,
  parsePikminEntityId,
  parseThrownPikminEntityId,
  decrementMainhandItem,
  isLiquidBlock,
} from "../utils/common";

export class PikminManager {
  // ==========================================
  // SPAWNING: PLACE VS THROW
  // ==========================================

  placePikminFromItem(player, type, stage, block, blockFace, faceLocation) {
    const dimension = player.dimension;
    const spawnPos = {
      x: block.location.x + (faceLocation?.x ?? 0.5),
      y:
        block.location.y +
        (blockFace === "Up" ? 1.0 : (faceLocation?.y ?? 1.0)),
      z: block.location.z + (faceLocation?.z ?? 0.5),
    };

    const pikmin = this.spawnInitializedPikmin(
      dimension,
      spawnPos,
      player,
      type,
      stage,
      "placed",
    );

    if (pikmin) {
      decrementMainhandItem(player);
    }
  }

  throwPikminFromItem(player, type, stage) {
    const dimension = player.dimension;
    const headLoc = player.getHeadLocation();
    const viewDir = player.getViewDirection();
    const spawnPos = Vec3.add(headLoc, Vec3.scale(viewDir, 0.8));

    const projectileId = buildThrownPikminEntityId(type);
    const projectile = dimension.spawnEntity(projectileId, spawnPos);

    projectile.setProperty(SETTINGS.entity_properties.stage, stage);
    projectile.setDynamicProperty(
      SETTINGS.dynamic_properties.ownerId,
      player.id,
    );
    projectile.setDynamicProperty(
      SETTINGS.dynamic_properties.spottedItem,
      false,
    );

    const projComp = projectile.getComponent(EntityComponentTypes.Projectile);
    if (projComp) {
      projComp.owner = player;
      projComp.shoot(
        Vec3.scale(viewDir, SETTINGS.pikmin.throwVelocityMultiplier),
      );
    }

    activeProjectiles.add(projectile);
    decrementMainhandItem(player);
  }

  /**
   * Spawns a Pikmin entity, tames it to the owner, and sets its stage/mode.
   */
  spawnInitializedPikmin(dimension, location, owner, type, stage, mode) {
    const entityId = buildPikminEntityId(type);
    const pikmin = dimension.spawnEntity(entityId, location);

    if (owner?.isValid) {
      pikmin.setDynamicProperty(SETTINGS.dynamic_properties.ownerId, owner.id);
      const tameable = pikmin.getComponent(EntityComponentTypes.Tameable);
      try {
        tameable?.tame(owner);
      } catch {}
    }

    pikmin.triggerEvent(`${NAMESPACE}:set_stage_${stage}`);

    if (mode === "placed") {
      pikmin.triggerEvent(`${NAMESPACE}:init_placed`);
    } else {
      pikmin.triggerEvent(`${NAMESPACE}:init_thrown`);
    }

    return pikmin;
  }

  // ==========================================
  // PROJECTILE TRACKING & LANDING LOGIC
  // ==========================================

  tickProjectiles() {
    for (const projectile of activeProjectiles) {
      if (!projectile?.isValid) {
        activeProjectiles.delete(projectile);
        continue;
      }

      const dimension = projectile.dimension;
      const loc = projectile.location;

      // 1. Mid-air scan for nearby dropped items
      const spottedAlready = projectile.getDynamicProperty(
        SETTINGS.dynamic_properties.spottedItem,
      );
      if (!spottedAlready) {
        const nearbyItems = dimension.getEntities({
          location: loc,
          maxDistance: SETTINGS.pikmin.midAirItemSearchRadius,
          type: "minecraft:item",
        });
        if (nearbyItems.length > 0) {
          projectile.setDynamicProperty(
            SETTINGS.dynamic_properties.spottedItem,
            true,
          );
        }
      }

      // 2. If it passed near an item, check if it hits water or lava
      if (
        projectile.getDynamicProperty(SETTINGS.dynamic_properties.spottedItem)
      ) {
        const block = dimension.getBlock(loc);
        if (isLiquidBlock(block)) {
          const pikminType =
            parseThrownPikminEntityId(projectile.typeId) ?? "test";
          const ownerId = projectile.getDynamicProperty(
            SETTINGS.dynamic_properties.ownerId,
          );
          const owner = ownerId ? world.getEntity(ownerId) : null;
          this.handleProjectileHitGround(projectile, pikminType, owner, loc);
        }
      }
    }
  }

  handleProjectileHitEntity(
    projectile,
    type,
    source,
    targetEntity,
    impactLocation,
  ) {
    if (!projectile?.isValid) return;

    const owner = this.resolveProjectileOwner(projectile, source);

    // Pass straight through other Pikmin, thrown Pikmin, and the thrower
    if (targetEntity?.isValid) {
      const targetFamily = targetEntity.getComponent(
        EntityComponentTypes.TypeFamily,
      );
      if (
        targetFamily?.hasTypeFamily("pikmin") ||
        targetFamily?.hasTypeFamily("pikmin_projectile") ||
        (owner && targetEntity.id === owner.id)
      ) {
        return;
      }
    }

    activeProjectiles.delete(projectile);

    const stage =
      projectile.getProperty(SETTINGS.entity_properties.stage) ?? "leaf";
    const hitLocation = impactLocation ?? projectile.location;
    const dimension = projectile.dimension;

    projectile.remove();

    if (!targetEntity?.isValid) return;

    const pikmin = this.spawnInitializedPikmin(
      dimension,
      hitLocation,
      owner,
      type,
      stage,
      "thrown",
    );

    if (this.isValidCombatTarget(pikmin, targetEntity, owner)) {
      latchManager.attachPikmin(pikmin, targetEntity, hitLocation);
    } else {
      system.runTimeout(() => {
        if (pikmin?.isValid) {
          this.startCalledBack(pikmin);
        }
      }, 2);
    }
  }

  handleProjectileHitGround(projectile, type, source, impactLocation) {
    if (!projectile?.isValid) return;
    activeProjectiles.delete(projectile);

    const owner = this.resolveProjectileOwner(projectile, source);
    const stage =
      projectile.getProperty(SETTINGS.entity_properties.stage) ?? "leaf";
    const spottedItemMidAir = Boolean(
      projectile.getDynamicProperty(SETTINGS.dynamic_properties.spottedItem),
    );
    const dimension = projectile.dimension;

    const baseLoc = projectile.location ?? impactLocation;
    const spawnLoc = { x: baseLoc.x, y: baseLoc.y + 0.1, z: baseLoc.z };

    projectile.remove();

    const pikmin = this.spawnInitializedPikmin(
      dimension,
      spawnLoc,
      owner,
      type,
      stage,
      "thrown",
    );

    const radius = SETTINGS.pikmin.landingSearchRadius;

    // Priority 1: Dropped items
    const nearbyItems = dimension.getEntities({
      location: spawnLoc,
      maxDistance: radius,
      type: "minecraft:item",
    });

    if (spottedItemMidAir || nearbyItems.length > 0) {
      this.startTimedItemGather(pikmin);
      return;
    }

    // Priority 2: Targetable entities within 4-block landing radius
    const nearbyTarget = this.findClosestCombatTarget(
      pikmin,
      spawnLoc,
      radius,
      owner,
    );
    if (nearbyTarget) {
      system.runTimeout(() => {
        if (pikmin?.isValid && nearbyTarget?.isValid) {
          this.forceTargetEntity(pikmin, nearbyTarget);
        }
      }, 2);
      return;
    }

    // Priority 3: Nothing to do -> Call back immediately
    system.runTimeout(() => {
      if (pikmin?.isValid) {
        this.startCalledBack(pikmin);
      }
    }, 2);
  }

  // ==========================================
  // ITEM GATHERING
  // ==========================================

  startTimedItemGather(pikmin) {
    if (!pikmin?.isValid) return;
    pikmin.triggerEvent(`${NAMESPACE}:start_gather`);

    system.runTimeout(() => {
      if (!pikmin?.isValid) return;
      if (pikmin.getProperty(SETTINGS.entity_properties.state) === "normal") {
        this.startCalledBack(pikmin);
      }
    }, SETTINGS.pikmin.gatherDurationTicks);
  }

  // ==========================================
  // TARGETING (0.67 VOID DAMAGE) & COMBAT
  // ==========================================

  forceTargetEntity(pikmin, targetEntity) {
    if (!pikmin?.isValid || !targetEntity?.isValid) return;

    try {
      pikmin.applyDamage(SETTINGS.pikmin.aggroSignalDamage, {
        cause: EntityDamageCause.void,
        damagingEntity: targetEntity,
      });
    } catch {}
  }

  applyPikminIndirectDamage(pikmin, target) {
    if (!pikmin?.isValid || !target?.isValid) return;

    const healthComp = target.getComponent(EntityComponentTypes.Health);
    if (!healthComp || healthComp.currentValue <= 0) return;

    // Factor in Resistance effect (20% reduction per level)
    let damageReduction = 0;
    const resistance = target.getEffect("resistance");
    if (resistance) {
      const level = resistance.amplifier + 1;
      damageReduction = Math.min(1.0, level * 0.2);
    }

    const indirectDamage =
      SETTINGS.pikmin.indirectHitDamage * (1.0 - damageReduction);
    if (indirectDamage <= 0) return;

    const remainingHp = healthComp.currentValue - indirectDamage;
    console.warn(`Dealth: ${indirectDamage} damage, remaining ${remainingHp}`)

    // If this hit is lethal (<= 0 HP), execute immediately with owner attribution
    if (remainingHp <= 0.001) {
      const owner = this.getOwner(pikmin);
      try {
        target.applyDamage(SETTINGS.pikmin.executeDamage, {
          cause: EntityDamageCause.entityAttack,
          damagingEntity: owner ?? pikmin,
        });
      } catch {}
      return;
    }

    healthComp.setCurrentValue(remainingHp);
  }

  handleTargetDeathNearby(deadEntity) {
    if (!deadEntity?.isValid) return;

    const nearbyPikmin = deadEntity.dimension.getEntities({
      location: deadEntity.location,
      maxDistance: 8.0,
      families: ["pikmin"],
    });

    for (const pikmin of nearbyPikmin) {
      const spawnMode = pikmin.getProperty(
        SETTINGS.entity_properties.spawnMode,
      );
      const state = pikmin.getProperty(SETTINGS.entity_properties.state);
      if (spawnMode === "thrown" && state === "normal") {
        const owner = this.getOwner(pikmin);
        const nextTarget = this.findClosestCombatTarget(
          pikmin,
          pikmin.location,
          SETTINGS.pikmin.landingSearchRadius,
          owner,
          deadEntity.id,
        );
        if (nextTarget) {
          this.forceTargetEntity(pikmin, nextTarget);
        } else {
          this.startCalledBack(pikmin);
        }
      }
    }
  }
  /**
   * When a Pikmin is killed by another entity, finds the nearest living Pikmin
   * of the same owner within `deathRetargetRadius` and forces the killer to target it.
   */
  handlePikminDeathRetarget(deadPikmin, damageSource) {
    const killer = damageSource?.damagingEntity;
    if (!killer?.isValid || killer.typeId === "minecraft:player") return;

    const killerHealth = killer.getComponent(EntityComponentTypes.Health);
    if (!killerHealth || killerHealth.currentValue <= 0) return;

    const ownerId = this.getOwnerId(deadPikmin);
    if (!ownerId) return;

    const deathPos = { ...deadPikmin.location };
    const dimension = deadPikmin.dimension;
    const deadId = deadPikmin.id;

    // Wait 1 tick so the killer's vanilla AI finishes clearing its dead target first
    system.runTimeout(() => {
      if (!killer?.isValid) return;

      const nearbyPikmin = dimension.getEntities({
        location: deathPos,
        maxDistance: SETTINGS.pikmin.deathRetargetRadius,
        families: ["pikmin"],
      });

      let nearestPikmin = null;
      let minDist = Infinity;

      for (const candidate of nearbyPikmin) {
        if (!candidate?.isValid || candidate.id === deadId) continue;
        if (candidate.getDynamicProperty(SETTINGS.dynamic_properties.despawning)) {
          continue;
        }
        if (this.getOwnerId(candidate) !== ownerId) continue;

        const health = candidate.getComponent(EntityComponentTypes.Health);
        if (!health || health.currentValue <= 0) continue;

        const dist = Vec3.distance(deathPos, candidate.location);
        if (dist < minDist) {
          minDist = dist;
          nearestPikmin = candidate;
        }
      }

      if (nearestPikmin) {
        this.forceTargetEntity(killer, nearestPikmin);
      }
    }, 1);
  }

  getOwnerId(pikmin) {
    if (!pikmin?.isValid) return undefined;
    return (
      pikmin.getDynamicProperty(SETTINGS.dynamic_properties.ownerId) ??
      pikmin.getComponent(EntityComponentTypes.Tameable)?.tamedToPlayerId
    );
  }

  // ==========================================
  // CALLED BACK & DESPAWN ITEM TRANSFER
  // ==========================================

  startCalledBack(pikmin) {
    if (!pikmin?.isValid) return;
    pikmin.setDynamicProperty(
      SETTINGS.dynamic_properties.calledBackActive,
      true,
    );
    pikmin.triggerEvent(`${NAMESPACE}:start_called_back`);
  }

  handleReachOwner(pikmin) {
    if (!pikmin?.isValid) return;
    const owner = this.getOwner(pikmin);
    if (!owner?.isValid) return;

    this.tryPickupPikminAndInventory(pikmin, owner);
  }

  /**
   * Gives the Pikmin item to the owner, transforms the Pikmin into `pkc:despawn`
   * (dropping held equipment), and sweeps the dropped items into the owner's inventory.
   */
  tryPickupPikminAndInventory(pikmin, owner) {
    if (!pikmin?.isValid || !owner?.isValid) return;
    if (pikmin.getDynamicProperty(SETTINGS.dynamic_properties.despawning)) {
      return;
    }

    const playerInv = owner.getComponent(
      EntityComponentTypes.Inventory,
    )?.container;
    if (!playerInv) return;

    const type = parsePikminEntityId(pikmin.typeId) ?? "test";
    const stage =
      pikmin.getProperty(SETTINGS.entity_properties.stage) ?? "leaf";
    const pikminItemStack = new ItemStack(buildPikminItemId(type, stage), 1);

    // Check residue when adding the Pikmin item to the owner
    const residue = playerInv.addItem(pikminItemStack);
    if (residue) {
      return;
    }

    // Lock against duplicate pickup calls while transforming
    pikmin.setDynamicProperty(SETTINGS.dynamic_properties.despawning, true);

    if (pikmin.getProperty(SETTINGS.entity_properties.state) === "latched") {
      latchManager.detachSinglePikmin(pikmin, false);
    }

    const dropPos = { ...pikmin.location };
    const dimension = pikmin.dimension;

    // Transform into pkc:despawn (drop_equipment: true -> drops held item on the ground)
    pikmin.triggerEvent(`${NAMESPACE}:trigger_despawn`);

    // Sweep dropped items into the owner's inventory right after transformation
    system.runTimeout(() => {
      if (!owner?.isValid) return;
      const targetInv = owner.getComponent(
        EntityComponentTypes.Inventory,
      )?.container;
      if (!targetInv) return;

      const droppedItems = dimension.getEntities({
        location: dropPos,
        maxDistance: SETTINGS.pikmin.despawnSweepRadius,
        type: "minecraft:item",
      });

      for (const itemEntity of droppedItems) {
        if (!itemEntity?.isValid) continue;
        const itemComp = itemEntity.getComponent(EntityComponentTypes.Item);
        const stack = itemComp?.itemStack;
        if (!stack) continue;

        const leftover = targetInv.addItem(stack);
        if (!leftover) {
          itemEntity.remove();
        } else if (leftover.amount !== stack.amount) {
          const itemLoc = { ...itemEntity.location };
          itemEntity.remove();
          dimension.spawnItem(leftover, itemLoc);
        }
      }
    }, SETTINGS.pikmin.despawnSweepDelayTicks);
  }

  // ==========================================
  // RELOAD RECOVERY & INVULNERABILITY
  // ==========================================

  handlePikminReload(pikmin) {
    if (!pikmin?.isValid) return;

    const currentState = pikmin.getProperty(SETTINGS.entity_properties.state);
    if (currentState === "normal") return;

    // Ignore initial spawn firing while actively tracked in memory
    if (
      currentState === "latched" &&
      latchManager.findHostEntryByPikminId(pikmin.id)
    ) {
      return;
    }
    if (
      currentState === "stunned" &&
      latchManager.isStunTimerActive(pikmin.id)
    ) {
      return;
    }

    const spawnMode = pikmin.getProperty(SETTINGS.entity_properties.spawnMode);
    if (spawnMode === "placed") {
      pikmin.triggerEvent(`${NAMESPACE}:init_placed`);
    } else {
      this.startCalledBack(pikmin);
    }
  }

  grantPostWhistleInvulnerability(pikmin) {
    if (!pikmin?.isValid) return;
    const expireTick =
      system.currentTick + SETTINGS.pikmin.postWhistleInvulnTicks;
    pikmin.setDynamicProperty(
      SETTINGS.dynamic_properties.invulnerableUntil,
      expireTick,
    );
  }

  getInvulnerableUntilTick(pikmin) {
    return pikmin.getDynamicProperty(
      SETTINGS.dynamic_properties.invulnerableUntil,
    );
  }

  isCurrentlyInvulnerable(expireTick) {
    return system.currentTick <= expireTick;
  }

  // ==========================================
  // HELPERS
  // ==========================================

  resolveProjectileOwner(projectile, eventSource) {
    if (eventSource?.isValid) return eventSource;
    const ownerId = projectile.getDynamicProperty(
      SETTINGS.dynamic_properties.ownerId,
    );
    return ownerId ? world.getEntity(ownerId) : null;
  }

  getOwner(pikmin) {
    const ownerId =
      pikmin.getDynamicProperty(SETTINGS.dynamic_properties.ownerId) ??
      pikmin.getComponent(EntityComponentTypes.Tameable)?.tamedToPlayerId;
    return ownerId ? world.getEntity(ownerId) : null;
  }

  isOwnedBy(pikmin, player) {
    if (!pikmin?.isValid || !player?.isValid) return false;
    const ownerId =
      pikmin.getDynamicProperty(SETTINGS.dynamic_properties.ownerId) ??
      pikmin.getComponent(EntityComponentTypes.Tameable)?.tamedToPlayerId;
    return ownerId === player.id;
  }

  isValidCombatTarget(pikmin, candidate, owner, excludeEntityId = null) {
    if (!candidate?.isValid || candidate.id === pikmin.id) return false;
    if (excludeEntityId && candidate.id === excludeEntityId) return false;
    if (owner && candidate.id === owner.id) return false;
    if (SETTINGS.exclude_target_types.includes(candidate.typeId)) return false;

    const family = candidate.getComponent(EntityComponentTypes.TypeFamily);
    for (const excludedFamily of SETTINGS.exclude_target_families) {
      if (family?.hasTypeFamily(excludedFamily)) return false;
    }

    const tameable = candidate.getComponent(EntityComponentTypes.Tameable);
    if (owner && tameable?.tamedToPlayerId === owner.id) return false;

    const health = candidate.getComponent(EntityComponentTypes.Health);
    return Boolean(health && health.currentValue > 0);
  }

  findClosestCombatTarget(
    pikmin,
    center,
    radius,
    owner,
    excludeEntityId = null,
  ) {
    const candidates = pikmin.dimension.getEntities({
      location: center,
      maxDistance: radius,
      excludeFamilies: SETTINGS.exclude_target_families,
      excludeTypes: SETTINGS.exclude_target_types,
    });

    let closest = null;
    let minDistance = Infinity;

    for (const entity of candidates) {
      if (!this.isValidCombatTarget(pikmin, entity, owner, excludeEntityId)) {
        continue;
      }
      const dist = Vec3.distance(center, entity.location);
      if (dist < minDistance) {
        minDistance = dist;
        closest = entity;
      }
    }

    return closest;
  }
}