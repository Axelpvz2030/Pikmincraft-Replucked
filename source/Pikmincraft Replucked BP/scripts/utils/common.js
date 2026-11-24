import { EntityComponentTypes, GameMode } from "@minecraft/server";
import { NAMESPACE } from "../game_settings";

/**
 * Parses an item ID formatted as `pkc:<type>_pikmin_<stage>`
 * @param {string} typeId
 * @returns {{ type: string, stage: string } | null}
 */
export function parsePikminItemId(typeId) {
  if (!typeId?.startsWith(`${NAMESPACE}:`)) return null;
  const raw = typeId.slice(NAMESPACE.length + 1);
  const match = raw.match(/^(.+)_pikmin_(leaf|bud|flower)$/);
  if (!match) return null;

  return {
    type: match[1],
    stage: match[2],
  };
}

/**
 * Parses a thrown Pikmin projectile ID formatted as `pkc:thrown_<type>_pikmin`
 * @param {string} typeId
 * @returns {string | null} The Pikmin type (e.g., "test"), or null if not a thrown Pikmin projectile.
 */
export function parseThrownPikminEntityId(typeId) {
  if (!typeId?.startsWith(`${NAMESPACE}:thrown_`)) return null;
  const raw = typeId.slice(NAMESPACE.length + 1);
  const match = raw.match(/^thrown_(.+)_pikmin$/);
  return match ? match[1] : null;
}

/**
 * Parses a Pikmin entity ID formatted as `pkc:<type>_pikmin`
 * @param {string} typeId
 * @returns {string | null} The Pikmin type (e.g., "test"), or null if invalid.
 */
export function parsePikminEntityId(typeId) {
  if (!typeId?.startsWith(`${NAMESPACE}:`) || typeId.startsWith(`${NAMESPACE}:thrown_`)) {
    return null;
  }
  const raw = typeId.slice(NAMESPACE.length + 1);
  const match = raw.match(/^(.+)_pikmin$/);
  return match ? match[1] : null;
}

/**
 * Builds the Pikmin item ID from type and stage (`pkc:<type>_pikmin_<stage>`).
 */
export function buildPikminItemId(type, stage) {
  return `${NAMESPACE}:${type}_pikmin_${stage}`;
}

/**
 * Builds the Pikmin entity ID from type (`pkc:<type>_pikmin`).
 */
export function buildPikminEntityId(type) {
  return `${NAMESPACE}:${type}_pikmin`;
}

/**
 * Builds the Thrown Pikmin projectile entity ID from type (`pkc:thrown_<type>_pikmin`).
 */
export function buildThrownPikminEntityId(type) {
  return `${NAMESPACE}:thrown_${type}_pikmin`;
}

/**
 * Decrements 1 item from the player's mainhand unless in Creative mode.
 */
export function decrementMainhandItem(player) {
  if (!player?.isValid || player.getGameMode() === GameMode.Creative) return;

  const equippable = player.getComponent(EntityComponentTypes.Equippable);
  if (!equippable) return;

  const mainhandSlot = equippable.getEquipmentSlot("Mainhand");
  const item = mainhandSlot?.getItem();
  if (!item) return;

  if (item.amount > 1) {
    item.amount -= 1;
    mainhandSlot.setItem(item);
  } else {
    mainhandSlot.setItem(undefined);
  }
}

/**
 * Checks if a block is water or lava.
 */
export function isLiquidBlock(block) {
  if (!block) return false;
  const id = block.typeId;
  return (
    id === "minecraft:water" ||
    id === "minecraft:flowing_water" ||
    id === "minecraft:lava" ||
    id === "minecraft:flowing_lava" ||
    block.isWaterlogged
  );
}