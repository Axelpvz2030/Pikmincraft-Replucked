import { NAMESPACE, SETTINGS } from "../game_settings";
import { pikminManager, latchManager, carryManager } from "../exports";
import { Vec3 } from "../utils/Vec3";

export class WhistleManager {
  useWhistle(player) {
    const dimension = player.dimension;
    const headPos = player.getHeadLocation();
    const viewDir = player.getViewDirection();
    const maxDist = SETTINGS.whistle.maxRayDistance;
    const whistleRadius = SETTINGS.whistle.whistleRadius;

    // 1. Fire raycast up to 30 blocks, ignoring liquids and passable blocks
    const rayHit = dimension.getBlockFromRay(headPos, viewDir, {
      maxDistance: maxDist,
      includeLiquidBlocks: false,
      includePassableBlocks: false,
    });

    const endPos = rayHit
      ? Vec3.add(rayHit.block.location, rayHit.faceLocation)
      : Vec3.add(headPos, Vec3.scale(viewDir, maxDist));

    // 2. Filter all player-owned Pikmin within whistleRadius of the search vector [headPos, endPos]
    const allPikmin = dimension.getEntities({
      families: ["pikmin"],
    });

    let closestPikminToPlayer = null;
    let minPlayerDist = Infinity;

    for (const pikmin of allPikmin) {
      if (!pikminManager.isOwnedBy(pikmin, player)) continue;

      const distToSegment = Vec3.distanceToSegment(
        pikmin.location,
        headPos,
        endPos,
      );

      if (distToSegment <= whistleRadius) {
        const distToPlayer = Vec3.distance(headPos, pikmin.location);
        if (distToPlayer < minPlayerDist) {
          minPlayerDist = distToPlayer;
          closestPikminToPlayer = pikmin;
        }
      }
    }

    const callPoint = closestPikminToPlayer
      ? Vec3.closestPointOnSegment(
          closestPikminToPlayer.location,
          headPos,
          endPos,
        )
      : endPos;

    // 3. Emit whistle particle & sound at the call point
    try {
      dimension.spawnParticle(SETTINGS.whistle.callParticleId, callPoint);
      dimension.playSound(SETTINGS.whistle.callSoundId, callPoint);
    } catch {}

    // 4. Call all player-owned Pikmin (placed and thrown) inside the whistleRadius sphere
    const spherePikmin = dimension.getEntities({
      location: callPoint,
      maxDistance: whistleRadius,
      families: ["pikmin"],
    });

    for (const pikmin of spherePikmin) {
      if (!pikminManager.isOwnedBy(pikmin, player)) continue;

      // If this Pikmin is carrying a boat/minecart, dissolve the dummy outright (recalls all Pikmin on it)
      if (carryManager.isPikminCarrying(pikmin.id)) {
        carryManager.dissolveCarrierForPikmin(pikmin);
        continue;
      }

      carryManager.cancelPendingPikmin(pikmin);

      const currentState = pikmin.getProperty(SETTINGS.entity_properties.state);
      const stage =
        pikmin.getProperty(SETTINGS.entity_properties.stage) ?? "leaf";

      if (currentState === "latched") {
        latchManager.detachSinglePikmin(pikmin, true);
      } else if (currentState === "stunned") {
        pikmin.triggerEvent(`${NAMESPACE}:set_stage_${stage}`);
      }

      pikminManager.startCalledBack(pikmin);
    }
  }
}