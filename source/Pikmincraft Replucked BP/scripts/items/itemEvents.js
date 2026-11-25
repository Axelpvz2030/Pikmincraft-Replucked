import { system } from "@minecraft/server";
import { SETTINGS } from "../game_settings";
import {
  placementTickLocks,
  pikminManager,
  whistleManager,
} from "../exports";
import { parsePikminItemId } from "../utils/common";

export function itemComponentsRegistry(event) {
  const registry = event.itemComponentRegistry;
  const components = SETTINGS.custom_components;

  registry.registerCustomComponent(components.pikmin_item.id, {
    onUseOn: data => {
      const { source: player, itemStack, block, blockFace, faceLocation } = data;
      const parsed = parsePikminItemId(itemStack?.typeId);
      if (!parsed || !player?.isValid) return;

      // Only place when sneaking; otherwise allow onUse to throw
      if (!player.isSneaking) return;

      placementTickLocks.set(player.id, system.currentTick);

      pikminManager.placePikminFromItem(
        player,
        parsed.type,
        parsed.stage,
        block,
        blockFace,
        faceLocation,
      );
    },

    onUse: data => {
      const { source: player, itemStack } = data;
      const parsed = parsePikminItemId(itemStack?.typeId);
      if (!parsed || !player?.isValid) return;

      const usedTick = system.currentTick;

      system.runTimeout(() => {
        if (!player?.isValid) return;
        const lastPlaceTick = placementTickLocks.get(player.id);
        if (
          lastPlaceTick !== undefined &&
          Math.abs(usedTick - lastPlaceTick) <= 1
        ) {
          return;
        }

        pikminManager.throwPikminFromItem(player, parsed.type, parsed.stage);
      }, 1);
    },
  });

  registry.registerCustomComponent(components.whistle.id, {
    onUse: data => {
      const { source: player } = data;
      if (!player?.isValid) return;
      whistleManager.useWhistle(player);
    },
  });

  console.warn("[PKC] Custom item components registered.");
}

export function onItemStartUseOn(event) {
  const { source: player, itemStack } = event;
  if (player?.isSneaking && parsePikminItemId(itemStack?.typeId)) {
    placementTickLocks.set(player.id, system.currentTick);
  }
}