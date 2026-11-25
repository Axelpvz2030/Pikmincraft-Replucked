import { system, EntityComponentTypes } from "@minecraft/server";
import { NAMESPACE, SETTINGS } from "../game_settings";
import { activeCarriers, pikminManager } from "../exports";
import { Vec3 } from "../utils/Vec3";

export class CarryManager {
  /**
   * Checks for a nearby boat, chest boat, minecart, or existing owner-matched carrier dummy.
   * Returns true if the Pikmin was assigned to carry one.
   */
  tryAssignPikminToNearbyCarrier(pikmin, center, radius, owner) {
    if (!pikmin?.isValid || !owner?.isValid) return false;

    const dimension = pikmin.dimension;

    // 1. Scan for nearby boats and minecarts
    const nearbyBoats = dimension.getEntities({
      location: center,
      maxDistance: radius,
      families: ["boat"],
    });
    const nearbyMinecarts = dimension.getEntities({
      location: center,
      maxDistance: radius,
      families: ["minecart"],
    });

    const candidates = [
      ...nearbyBoats.map(entity => ({
        entity,
        config: SETTINGS.carry.vehicles.boat,
      })),
      ...nearbyMinecarts.map(entity => ({
        entity,
        config: SETTINGS.carry.vehicles.minecart,
      })),
    ];

    candidates.sort(
      (a, b) =>
        Vec3.distance(center, a.entity.location) -
        Vec3.distance(center, b.entity.location),
    );

    for (const { entity: vehicle, config } of candidates) {
      if (!vehicle?.isValid) continue;

      const ridingComp = vehicle.getComponent(EntityComponentTypes.Riding);
      const currentMount = ridingComp?.entityRidingOn;

      // Case A: Vehicle is already riding a carry dummy -> reuse it if same owner & has open capacity
      if (currentMount?.isValid) {
        const mountFamily = currentMount.getComponent(
          EntityComponentTypes.TypeFamily,
        );
        if (!mountFamily?.hasTypeFamily("carry_dummy")) continue;

        const carrierEntry = activeCarriers.get(currentMount.id);
        if (!carrierEntry) continue;
        if (carrierEntry.ownerId !== owner.id) continue;

        const maxCap = Math.floor(
          carrierEntry.requiredPikmin * SETTINGS.carry.maxCapMultiplier,
        );
        const totalAssigned =
          carrierEntry.mountedPikmin.size + carrierEntry.pendingPikmin.size;
        if (totalAssigned >= maxCap) continue;

        this.sendPikminToDummy(pikmin, carrierEntry);
        return true;
      }

      // Case B: Free vehicle -> spawn a new carrier dummy, mount vehicle on seat 0, and send Pikmin
      const carrierEntry = this.createCarrierForVehicle(vehicle, config, owner);
      if (carrierEntry) {
        this.sendPikminToDummy(pikmin, carrierEntry);
        return true;
      }
    }

    return false;
  }

  /**
   * Spawns the matching dummy entity, instantly tames it to the owner, and mounts the vehicle on seat 0.
   */
  createCarrierForVehicle(vehicle, config, owner) {
    const dimension = vehicle.dimension;
    const spawnLoc = { ...vehicle.location };
    const dummy = dimension.spawnEntity(config.dummyId, spawnLoc);

    // Instantly tame to the owner so only this owner's Pikmin can join
    dummy.setDynamicProperty(SETTINGS.dynamic_properties.ownerId, owner.id);
    const tameable = dummy.getComponent(EntityComponentTypes.Tameable);
    try {
      tameable?.tame(owner);
    } catch {}

    const rideable = dummy.getComponent(EntityComponentTypes.Rideable);
    const vehicleMounted = rideable?.addRider(vehicle);
    if (!vehicleMounted) {
      dummy.remove();
      return null;
    }

    const entry = {
      dummy,
      vehicle,
      ownerId: owner.id,
      requiredPikmin: config.requiredPikmin,
      maxPikmin: Math.floor(
        config.requiredPikmin * SETTINGS.carry.maxCapMultiplier,
      ),
      mountDistance: config.mountDistance,
      reachedBaseQuota: false,
      reachedMaxQuota: false,
      mountedPikmin: new Map(), // pikminId -> Entity
      pendingPikmin: new Map(), // pikminId -> { pikmin, startTick }
    };

    activeCarriers.set(dummy.id, entry);
    this.updateDummyNameTag(entry);
    return entry;
  }

  /**
   * Directs a Pikmin to walk up to the dummy (or mount immediately if already adjacent).
   */
  sendPikminToDummy(pikmin, entry) {
    const dist = Vec3.distance(pikmin.location, entry.dummy.location);
    if (dist <= entry.mountDistance) {
      this.mountPikminOnDummy(pikmin, entry);
      return;
    }

    entry.pendingPikmin.set(pikmin.id, {
      pikmin,
      startTick: system.currentTick,
    });

    pikmin.triggerEvent(`${NAMESPACE}:start_approach_carry`);

    system.runTimeout(() => {
      if (
        pikmin?.isValid &&
        entry.dummy?.isValid &&
        entry.pendingPikmin.has(pikmin.id)
      ) {
        pikminManager.forceTargetEntity(pikmin, entry.dummy);
      }
    }, 2);
  }

  /**
   * Mounts a Pikmin onto the next open seat of the carrier dummy and checks quota thresholds.
   */
  mountPikminOnDummy(pikmin, entry) {
    entry.pendingPikmin.delete(pikmin.id);
    if (!pikmin?.isValid || !entry.dummy?.isValid) return false;

    if (entry.mountedPikmin.size >= entry.maxPikmin) {
      pikminManager.startCalledBack(pikmin);
      return false;
    }

    const rideable = entry.dummy.getComponent(EntityComponentTypes.Rideable);
    const mounted = rideable?.addRider(pikmin);
    if (!mounted) {
      pikminManager.startCalledBack(pikmin);
      return false;
    }

    pikmin.triggerEvent(`${NAMESPACE}:enter_carry`);
    entry.mountedPikmin.set(pikmin.id, pikmin);

    const count = entry.mountedPikmin.size;
    this.updateDummyNameTag(entry);

    // Threshold 1: Reached required Pikmin count (20 boats / 10 minecarts) -> 1/4 average speed
    if (!entry.reachedBaseQuota && count >= entry.requiredPikmin) {
      entry.reachedBaseQuota = true;
      this.applyAveragePikminSpeed(entry, SETTINGS.carry.baseSpeedMultiplier);
      entry.dummy.triggerEvent(`${NAMESPACE}:start_following`);
    }

    // Threshold 2: Reached 1.5x max cap (30 boats / 15 minecarts) -> 1/2 average speed
    if (!entry.reachedMaxQuota && count >= entry.maxPikmin) {
      entry.reachedMaxQuota = true;
      this.applyAveragePikminSpeed(entry, SETTINGS.carry.maxSpeedMultiplier);
    }

    return true;
  }

  /**
   * Averages the movement value of all mounted Pikmin, scales by `multiplier`,
   * and snaps to the closest 0.1 step in [0.0, 5.0].
   */
  applyAveragePikminSpeed(entry, multiplier = 1.0) {
    let totalSpeed = 0;
    let validCount = 0;

    for (const pikmin of entry.mountedPikmin.values()) {
      if (!pikmin?.isValid) continue;
      const moveComp = pikmin.getComponent(EntityComponentTypes.Movement);
      const speed = moveComp?.currentValue ?? moveComp?.defaultValue ?? 0.28;
      totalSpeed += speed;
      validCount += 1;
    }

    if (validCount === 0) return;

    const scaledSpeed = (totalSpeed / validCount) * multiplier;
    const clamped = Math.max(
      SETTINGS.carry.minSpeed,
      Math.min(SETTINGS.carry.maxSpeed, scaledSpeed),
    );
    let snapped = Math.round(clamped * 10) / 10;

    // Avoid freezing the dummy if a slow Pikmin type rounds down to 0.0
    if (scaledSpeed > 0 && snapped === 0) {
      snapped = 0.1;
    }

    const speedKey = snapped.toFixed(1).replace(".", "_");

    entry.dummy.triggerEvent(`${NAMESPACE}:reset_speed`);
    entry.dummy.triggerEvent(`${NAMESPACE}:set_speed_${speedKey}`);
  }

  updateDummyNameTag(entry) {
    if (!entry.dummy?.isValid) return;

    const count = entry.mountedPikmin.size;
    const required = entry.requiredPikmin;

    let color = "§c"; // Red: below required count
    if (count >= entry.maxPikmin) {
      color = "§9"; // Blue: max cap reached (swap to "§b" if you want lighter aqua)
    } else if (count >= required) {
      color = "§a"; // Green: enough to carry
    }

    entry.dummy.nameTag = `${color}${count}/${required}`;
  }

  /**
   * Runs every tick from `main.js` to board approaching Pikmin and verify vehicles remain attached.
   */
  tickCarriers() {
    for (const [dummyId, entry] of activeCarriers.entries()) {
      const { dummy, vehicle, mountedPikmin, pendingPikmin } = entry;

      // If the dummy or its carried boat/minecart disappeared, dissolve cleanly
      if (!dummy?.isValid || !vehicle?.isValid) {
        this.dissolveCarrier(dummyId);
        continue;
      }

      const vehicleMount = vehicle.getComponent(
        EntityComponentTypes.Riding,
      )?.entityRidingOn;
      if (!vehicleMount || vehicleMount.id !== dummy.id) {
        this.dissolveCarrier(dummyId);
        continue;
      }

      // Check approaching Pikmin
      for (const [pikminId, pending] of pendingPikmin.entries()) {
        const { pikmin, startTick } = pending;
        if (!pikmin?.isValid) {
          pendingPikmin.delete(pikminId);
          continue;
        }

        const dist = Vec3.distance(pikmin.location, dummy.location);
        const elapsed = system.currentTick - startTick;

        if (dist <= entry.mountDistance) {
          this.mountPikminOnDummy(pikmin, entry);
          continue;
        }

        // Gentle fallback nudge if vanilla pathing stalls on terrain
        if (elapsed > 10 && elapsed % 6 === 0 && dist <= 6.0) {
          const dir = Vec3.normalize(
            Vec3.subtract(dummy.location, pikmin.location),
          );
          try {
            pikmin.applyKnockback({ x: dir.x * 0.35, z: dir.z * 0.35 }, 0.15);
          } catch {}
        }

        // Timeout fallback so a Pikmin never stays stuck approaching forever
        if (elapsed >= SETTINGS.carry.approachTimeoutTicks) {
          if (dist <= 5.0) {
            this.mountPikminOnDummy(pikmin, entry);
          } else {
            pendingPikmin.delete(pikminId);
            pikminManager.startCalledBack(pikmin);
          }
        }
      }

      // If a mounted Pikmin somehow dismounted or died without triggering dissolve, dissolve outright
      for (const [pikminId, pikmin] of mountedPikmin.entries()) {
        if (!pikmin?.isValid) {
          this.dissolveCarrier(dummyId);
          break;
        }
        const riderMount = pikmin.getComponent(
          EntityComponentTypes.Riding,
        )?.entityRidingOn;
        if (!riderMount || riderMount.id !== dummy.id) {
          this.dissolveCarrier(dummyId);
          break;
        }
      }

      // Clean up if nobody is mounted and nobody is approaching
      if (
        activeCarriers.has(dummyId) &&
        mountedPikmin.size === 0 &&
        pendingPikmin.size === 0
      ) {
        this.dissolveCarrier(dummyId);
      }
    }
  }

  /**
   * Immediately despawns the carrier dummy, drops the boat/minecart, and calls back every participating Pikmin.
   */
  dissolveCarrier(dummyId, excludePikminId = null) {
    const entry = activeCarriers.get(dummyId);
    if (!entry) return;

    activeCarriers.delete(dummyId);

    const { dummy, mountedPikmin, pendingPikmin } = entry;

    if (dummy?.isValid) {
      const rideable = dummy.getComponent(EntityComponentTypes.Rideable);
      try {
        rideable?.ejectRiders();
      } catch {}
      dummy.remove();
    }

    for (const [pikminId, pikmin] of mountedPikmin.entries()) {
      if (pikminId === excludePikminId || !pikmin?.isValid) continue;
      pikminManager.startCalledBack(pikmin);
    }

    for (const [pikminId, { pikmin }] of pendingPikmin.entries()) {
      if (pikminId === excludePikminId || !pikmin?.isValid) continue;
      pikminManager.startCalledBack(pikmin);
    }
  }

  /**
   * Dissolves the carrier dummy associated with a carrying Pikmin (e.g. whistled, interacted, or killed).
   */
  dissolveCarrierForPikmin(pikmin, excludePikminId = null) {
    if (!pikmin) return false;
    const dummyId = this.findDummyIdByMountedPikmin(pikmin.id);
    if (!dummyId) return false;

    this.dissolveCarrier(dummyId, excludePikminId);
    return true;
  }

  /**
   * Cancels a Pikmin that is still walking toward a dummy; dissolves the dummy if it becomes empty.
   */
  cancelPendingPikmin(pikmin) {
    if (!pikmin) return false;

    for (const [dummyId, entry] of activeCarriers.entries()) {
      if (entry.pendingPikmin.has(pikmin.id)) {
        entry.pendingPikmin.delete(pikmin.id);
        if (entry.mountedPikmin.size === 0 && entry.pendingPikmin.size === 0) {
          this.dissolveCarrier(dummyId, pikmin.id);
        }
        return true;
      }
    }
    return false;
  }

  /**
   * Triggered by `animation.pkc.carry_dummy.on_load` if a dummy survives a world/chunk reload untracked.
   */
  handleDummyReload(dummy) {
    if (!dummy?.isValid) return;
    if (activeCarriers.has(dummy.id)) return;

    const rideable = dummy.getComponent(EntityComponentTypes.Rideable);
    const riders = rideable?.getRiders() ?? [];

    try {
      rideable?.ejectRiders();
    } catch {}

    for (const rider of riders) {
      if (!rider?.isValid) continue;
      const family = rider.getComponent(EntityComponentTypes.TypeFamily);
      if (family?.hasTypeFamily("pikmin")) {
        pikminManager.startCalledBack(rider);
      }
    }

    dummy.remove();
  }

  findDummyIdByMountedPikmin(pikminId) {
    for (const [dummyId, entry] of activeCarriers.entries()) {
      if (entry.mountedPikmin.has(pikminId)) {
        return dummyId;
      }
    }
    return null;
  }

  isPikminCarrying(pikminId) {
    return this.findDummyIdByMountedPikmin(pikminId) !== null;
  }

  isPikminPending(pikminId) {
    for (const entry of activeCarriers.values()) {
      if (entry.pendingPikmin.has(pikminId)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Resolves whether an entity hit directly by a thrown Pikmin is a carry dummy,
   * a boat/minecart, or an entity riding a boat/minecart.
   */
  resolveCarryTarget(entity) {
    if (!entity?.isValid) return null;

    const family = entity.getComponent(EntityComponentTypes.TypeFamily);

    if (family?.hasTypeFamily("carry_dummy")) {
      return { kind: "dummy", dummy: entity };
    }

    if (family?.hasTypeFamily("boat")) {
      return {
        kind: "vehicle",
        vehicle: entity,
        config: SETTINGS.carry.vehicles.boat,
      };
    }

    if (family?.hasTypeFamily("minecart")) {
      return {
        kind: "vehicle",
        vehicle: entity,
        config: SETTINGS.carry.vehicles.minecart,
      };
    }

    // If the hit entity is riding a boat or minecart, target that boat/minecart instead of attacking
    const mount = entity.getComponent(
      EntityComponentTypes.Riding,
    )?.entityRidingOn;
    if (mount?.isValid) {
      const mountFamily = mount.getComponent(EntityComponentTypes.TypeFamily);
      if (mountFamily?.hasTypeFamily("boat")) {
        return {
          kind: "vehicle",
          vehicle: mount,
          config: SETTINGS.carry.vehicles.boat,
        };
      }
      if (mountFamily?.hasTypeFamily("minecart")) {
        return {
          kind: "vehicle",
          vehicle: mount,
          config: SETTINGS.carry.vehicles.minecart,
        };
      }
    }

    return null;
  }

  /**
   * Immediately mounts a freshly spawned Pikmin onto an existing or newly created carrier dummy
   * so it never gets pulled into a boat or minecart passenger seat.
   */
  assignPikminDirectlyToTarget(pikmin, carryTarget, owner) {
    if (!pikmin?.isValid || !owner?.isValid || !carryTarget) return false;

    if (carryTarget.kind === "dummy") {
      const entry = activeCarriers.get(carryTarget.dummy.id);
      if (!entry || entry.ownerId !== owner.id) return false;
      if (entry.mountedPikmin.size >= entry.maxPikmin) return false;

      return this.mountPikminOnDummy(pikmin, entry);
    }

    if (carryTarget.kind === "vehicle") {
      const { vehicle, config } = carryTarget;
      if (!vehicle?.isValid) return false;

      const currentMount = vehicle.getComponent(
        EntityComponentTypes.Riding,
      )?.entityRidingOn;

      // Vehicle is already on a carry dummy -> mount straight onto that dummy
      if (currentMount?.isValid) {
        const mountFamily = currentMount.getComponent(
          EntityComponentTypes.TypeFamily,
        );
        if (!mountFamily?.hasTypeFamily("carry_dummy")) return false;

        const entry = activeCarriers.get(currentMount.id);
        if (!entry || entry.ownerId !== owner.id) return false;
        if (entry.mountedPikmin.size >= entry.maxPikmin) return false;

        return this.mountPikminOnDummy(pikmin, entry);
      }

      // Free vehicle -> spawn dummy, mount vehicle on seat 0, and mount Pikmin on seat 1
      const entry = this.createCarrierForVehicle(vehicle, config, owner);
      if (!entry) return false;

      return this.mountPikminOnDummy(pikmin, entry);
    }

    return false;
  }
}