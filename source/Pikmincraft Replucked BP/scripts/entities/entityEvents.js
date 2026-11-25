import { system, EntityComponentTypes } from "@minecraft/server";
import { NAMESPACE, SETTINGS } from "../game_settings";
import { pikminManager, latchManager } from "../exports";
import { parseThrownPikminEntityId } from "../utils/common";

export function onDataDrivenEntityTrigger(event) {
  const { entity, eventId } = event;
  if (!entity?.isValid) return;

  switch (eventId) {
    case `${NAMESPACE}:on_load`: {
      pikminManager.handlePikminReload(entity);
      break;
    }
    case `${NAMESPACE}:on_reach_owner`: {
      pikminManager.handleReachOwner(entity);
      break;
    }
    default:
      break;
  }
}

export function onProjectileHitEntity(event) {
  const { projectile, source, location } = event;
  const pikminType = parseThrownPikminEntityId(projectile?.typeId);
  if (!pikminType) return;

  const hitEntity = event.getEntityHit()?.entity;
  pikminManager.handleProjectileHitEntity(
    projectile,
    pikminType,
    source,
    hitEntity,
    location,
  );
}

export function onProjectileHitBlock(event) {
  const { projectile, source, location } = event;
  const pikminType = parseThrownPikminEntityId(projectile?.typeId);
  if (!pikminType) return;

  pikminManager.handleProjectileHitGround(
    projectile,
    pikminType,
    source,
    location,
  );
}

export function onEntityHurtBefore(event) {
  const { hurtEntity, damage, damageSource } = event;
  if (!hurtEntity?.isValid) return;

  // 1. Cancel the 0.67 void damage aggro signal for ANY entity (Pikmin or retargeted mobs)
  if (
    damageSource.cause === "void" &&
    Math.abs(damage - SETTINGS.pikmin.aggroSignalDamage) < 0.01
  ) {
    event.cancel = true;
    return;
  }

  const typeFamily = hurtEntity.getComponent(EntityComponentTypes.TypeFamily);
  if (!typeFamily?.hasTypeFamily("pikmin")) return;

  // 2. Ignore hits from thrown Pikmin projectiles so they never hurt or add shake-off points
  const projFamily = damageSource.damagingProjectile?.getComponent(
    EntityComponentTypes.TypeFamily,
  );
  if (projFamily?.hasTypeFamily("pikmin_projectile")) {
    event.cancel = true;
    return;
  }

  // 3. Check post-whistle 5-second invulnerability via saved game tick dynamic property
  const invulnTick = pikminManager.getInvulnerableUntilTick(hurtEntity);
  if (
    invulnTick !== undefined &&
    pikminManager.isCurrentlyInvulnerable(invulnTick)
  ) {
    event.cancel = true;
    return;
  }

  // 4. Handle Latched-On Pikmin immunity & shake-off progress points
  const currentState = hurtEntity.getProperty(SETTINGS.entity_properties.state);
  if (
    currentState === "latched" &&
    SETTINGS.latch.validDamageCauses.includes(damageSource.cause)
  ) {
    event.cancel = true;
    system.run(() => {
      if (hurtEntity?.isValid) {
        latchManager.registerLatchedPikminHit(hurtEntity, damage);
      }
    });
  }
}

export function onEntityHitEntity(event) {
  const { damagingEntity, hitEntity } = event;
  if (!damagingEntity?.isValid || !hitEntity?.isValid) return;

  const typeFamily = damagingEntity.getComponent(
    EntityComponentTypes.TypeFamily,
  );
  if (typeFamily?.hasTypeFamily("pikmin")) {
    pikminManager.applyPikminIndirectDamage(damagingEntity, hitEntity);
  }
}

export function onEntityDie(event) {
  const { deadEntity, damageSource } = event;
  if (!deadEntity) return;

  const typeFamily = deadEntity.getComponent(EntityComponentTypes.TypeFamily);
  if (typeFamily?.hasTypeFamily("pikmin")) {
    pikminManager.handlePikminDeathRetarget(deadEntity, damageSource);
    return;
  }

  latchManager.handleHostDeath(deadEntity.id);
  pikminManager.handleTargetDeathNearby(deadEntity);
}

export function onPlayerInteractWithEntity(event) {
  const { player, target } = event;
  if (!player?.isValid || !target?.isValid) return;

  const typeFamily = target.getComponent(EntityComponentTypes.TypeFamily);
  if (!typeFamily?.hasTypeFamily("pikmin")) return;

  if (pikminManager.isOwnedBy(target, player)) {
    pikminManager.tryPickupPikminAndInventory(target, player);
  }
}