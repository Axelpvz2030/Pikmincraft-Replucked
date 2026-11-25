import {
  system,
  EntityComponentTypes,
  MolangVariableMap,
} from "@minecraft/server";
import { NAMESPACE, SETTINGS } from "../game_settings";
import { latchedHosts, pikminManager } from "../exports";
import { Vec3 } from "../utils/Vec3";

export class LatchManager {
  constructor() {
    this.activeStunnedIds = new Set();
  }

  isStunTimerActive(pikminId) {
    return this.activeStunnedIds.has(pikminId);
  }

  /**
   * Attaches a Pikmin to a target entity and caches the host's AABB dimensions for shake-off anger particles.
   */
  attachPikmin(pikmin, hostEntity, impactLocation) {
    if (!pikmin?.isValid || !hostEntity?.isValid) return;

    const hostAabb = hostEntity.getAABB();
    const offset = this.computePaddedOffset(
      pikmin,
      hostEntity,
      impactLocation,
      hostAabb,
    );

    let hostEntry = latchedHosts.get(hostEntity.id);
    if (!hostEntry) {
      const aabbCenterOffset = Vec3.subtract(
        hostAabb.center,
        hostEntity.location,
      );

      const angerMolang = new MolangVariableMap();
      angerMolang.setFloat("variable.half_width", hostAabb.extent.x);
      angerMolang.setFloat("variable.half_height", hostAabb.extent.y);

      hostEntry = {
        host: hostEntity,
        points: 0,
        maxPointsTick: null,
        aabbExtent: {
          x: hostAabb.extent.x,
          y: hostAabb.extent.y,
          z: hostAabb.extent.z,
        },
        aabbCenterOffset,
        angerMolang,
        pikminMap: new Map(),
      };
      latchedHosts.set(hostEntity.id, hostEntry);
    }

    hostEntry.pikminMap.set(pikmin.id, {
      pikmin,
      offset,
    });

    pikmin.triggerEvent(`${NAMESPACE}:enter_latched`);

    system.runTimeout(() => {
      if (
        pikmin?.isValid &&
        hostEntity?.isValid &&
        pikmin.getProperty(SETTINGS.entity_properties.state) === "latched"
      ) {
        pikminManager.forceTargetEntity(pikmin, hostEntity);
      }
    }, 2);
  }

  /**
   * Uses `getAABB()` on both the target and the Pikmin so their collision boxes stay separated while attached.
   */
  computePaddedOffset(pikmin, hostEntity, impactLocation, hostAabb = null) {
    const resolvedHostAabb = hostAabb ?? hostEntity.getAABB();
    const pikminAabb = pikmin.getAABB();

    const rawDelta = Vec3.subtract(impactLocation, hostEntity.location);
    const horizontalDir = new Vec3(rawDelta.x, 0, rawDelta.z);
    const normHoriz =
      Vec3.lengthSq(horizontalDir) > 0.0001
        ? Vec3.normalize(horizontalDir)
        : new Vec3(1, 0, 0);

    const minSafeHorizontalDist =
      Math.max(resolvedHostAabb.extent.x, resolvedHostAabb.extent.z) +
      Math.max(pikminAabb.extent.x, pikminAabb.extent.z) +
      SETTINGS.latch.aabbPadding;

    const clampedY = Math.max(
      0.1,
      Math.min(rawDelta.y, resolvedHostAabb.extent.y * 1.6),
    );

    return new Vec3(
      normHoriz.x * minSafeHorizontalDist,
      clampedY,
      normHoriz.z * minSafeHorizontalDist,
    );
  }

  /**
   * Runs every tick from `main.js` to teleport latched Pikmin and emit box-surface anger particles at 5 points.
   */
  tickLatchedHosts() {
    for (const [hostId, hostEntry] of latchedHosts.entries()) {
      const { host, pikminMap, points, aabbCenterOffset, angerMolang } =
        hostEntry;

      if (!host?.isValid) {
        this.handleHostDeath(hostId);
        continue;
      }

      if (
        points >= SETTINGS.latch.maxPoints &&
        system.currentTick % SETTINGS.latch.angerParticleIntervalTicks === 0
      ) {
        const boxCenter = Vec3.add(host.location, aabbCenterOffset);
        try {
          host.dimension.spawnParticle(
            SETTINGS.latch.angerParticleId,
            boxCenter,
            angerMolang,
          );
        } catch {}
      }

      for (const [pikminId, data] of pikminMap.entries()) {
        const { pikmin, offset } = data;
        if (
          !pikmin?.isValid ||
          pikmin.getProperty(SETTINGS.entity_properties.state) !== "latched"
        ) {
          pikminMap.delete(pikminId);
          continue;
        }

        const targetPos = Vec3.add(host.location, offset);
        pikmin.teleport(targetPos, {
          dimension: host.dimension,
          facingLocation: host.location,
        });
      }

      if (pikminMap.size === 0) {
        latchedHosts.delete(hostId);
      }
    }
  }

  /**
   * Called from `beforeEvents.entityHurt` when a latched Pikmin takes entityAttack, contact, or projectile damage.
   */
  registerLatchedPikminHit(pikmin, incomingDamage) {
    const hostEntry = this.findHostEntryByPikminId(pikmin.id);
    if (!hostEntry) return;

    const { host } = hostEntry;
    if (!host?.isValid) return;

    // Optional: see every hit and how many ticks have elapsed since the countdown started
    if (hostEntry.maxPointsTick !== null) {
      const elapsed = system.currentTick - hostEntry.maxPointsTick;
      //console.warn(`[PKC] Hit during countdown on ${host.typeId} | elapsed=${elapsed}/${SETTINGS.latch.angerDelayTicks} ticks`,);
    }

    if (
      hostEntry.points >= SETTINGS.latch.maxPoints &&
      hostEntry.maxPointsTick !== null &&
      system.currentTick - hostEntry.maxPointsTick >=
        SETTINGS.latch.angerDelayTicks
    ) {
      console.warn(`[PKC] Countdown finished! Shaking off Pikmin on ${host.typeId}`);
      this.shakeOffAllPikmin(host.id);
      return;
    }

    if (hostEntry.points < SETTINGS.latch.maxPoints) {
      const maxHp =
        pikmin.getComponent(EntityComponentTypes.Health)?.effectiveMax ?? 6;
      const addedPoints = incomingDamage >= maxHp ? 2 : 1;

      hostEntry.points = Math.min(
        SETTINGS.latch.maxPoints,
        hostEntry.points + addedPoints,
      );

      console.warn(
        `[PKC] ${host.typeId} shake-off points: ${hostEntry.points}/${SETTINGS.latch.maxPoints} (+${addedPoints})`,
      );

      if (
        hostEntry.points >= SETTINGS.latch.maxPoints &&
        hostEntry.maxPointsTick === null
      ) {
        hostEntry.maxPointsTick = system.currentTick;
        // <-- Countdown starts here
        console.warn(
          `[PKC] Shake-off countdown STARTED for ${host.typeId} at tick ${hostEntry.maxPointsTick}`,
        );
      }
    }
  }

  /**
   * Shakes off all Pikmin attached to `hostId`, stunning and knocking them back in the host's view direction.
   */
  shakeOffAllPikmin(hostId) {
    const hostEntry = latchedHosts.get(hostId);
    if (!hostEntry) return;

    const { host, pikminMap } = hostEntry;
    latchedHosts.delete(hostId);

    const viewDir = host?.isValid ? host.getViewDirection() : new Vec3(0, 0, 1);

    for (const { pikmin } of pikminMap.values()) {
      if (!pikmin?.isValid) continue;

      const pikminId = pikmin.id;
      this.activeStunnedIds.add(pikminId);
      pikmin.triggerEvent(`${NAMESPACE}:enter_stunned`);

      try {
        pikmin.applyKnockback(
          {
            x: viewDir.x * SETTINGS.latch.shakeKnockbackHorizontal,
            z: viewDir.z * SETTINGS.latch.shakeKnockbackHorizontal,
          },
          SETTINGS.latch.shakeKnockbackVertical,
        );
      } catch {}

      system.runTimeout(() => {
        this.activeStunnedIds.delete(pikminId);
        if (!pikmin?.isValid) return;
        if (pikmin.getProperty(SETTINGS.entity_properties.state) !== "stunned") {
          return;
        }

        const spawnMode = pikmin.getProperty(
          SETTINGS.entity_properties.spawnMode,
        );
        const stage =
          pikmin.getProperty(SETTINGS.entity_properties.stage) ?? "leaf";

        pikmin.triggerEvent(`${NAMESPACE}:set_stage_${stage}`);
        if (spawnMode === "placed") {
          pikmin.triggerEvent(`${NAMESPACE}:init_placed`);
        } else {
          pikmin.triggerEvent(`${NAMESPACE}:init_thrown`);
        }

        const health = host?.isValid
          ? host.getComponent(EntityComponentTypes.Health)
          : null;
        if (host?.isValid && health && health.currentValue > 0) {
          system.runTimeout(() => {
            if (pikmin?.isValid && host?.isValid) {
              pikminManager.forceTargetEntity(pikmin, host);
            }
          }, 2);
        } else if (spawnMode === "thrown") {
          pikminManager.startCalledBack(pikmin);
        }
      }, SETTINGS.latch.stunDurationTicks);
    }
  }

  detachSinglePikmin(pikmin, grantWhistleInvulnerability = false) {
    const hostEntry = this.findHostEntryByPikminId(pikmin.id);
    if (hostEntry) {
      hostEntry.pikminMap.delete(pikmin.id);
      if (hostEntry.pikminMap.size === 0) {
        latchedHosts.delete(hostEntry.host.id);
      }
    }

    if (!pikmin?.isValid) return;

    const stage = pikmin.getProperty(SETTINGS.entity_properties.stage) ?? "leaf";
    pikmin.triggerEvent(`${NAMESPACE}:set_stage_${stage}`);

    if (grantWhistleInvulnerability) {
      pikminManager.grantPostWhistleInvulnerability(pikmin);
    }
  }

  handleHostDeath(hostId) {
    const hostEntry = latchedHosts.get(hostId);
    if (!hostEntry) return;

    latchedHosts.delete(hostId);

    for (const { pikmin } of hostEntry.pikminMap.values()) {
      if (!pikmin?.isValid) continue;

      const stage =
        pikmin.getProperty(SETTINGS.entity_properties.stage) ?? "leaf";
      const spawnMode = pikmin.getProperty(
        SETTINGS.entity_properties.spawnMode,
      );

      pikmin.triggerEvent(`${NAMESPACE}:set_stage_${stage}`);

      if (spawnMode === "placed") {
        pikmin.triggerEvent(`${NAMESPACE}:init_placed`);
      } else {
        pikminManager.startCalledBack(pikmin);
      }
    }
  }

  findHostEntryByPikminId(pikminId) {
    for (const hostEntry of latchedHosts.values()) {
      if (hostEntry.pikminMap.has(pikminId)) {
        return hostEntry;
      }
    }
    return null;
  }
}