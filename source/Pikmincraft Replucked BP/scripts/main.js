import { world, system } from "@minecraft/server";
import { itemComponentsRegistry, onItemStartUseOn } from "./items/itemEvents";
import {
  onDataDrivenEntityTrigger,
  onProjectileHitEntity,
  onProjectileHitBlock,
  onEntityDie,
  onEntityHurtBefore,
  onEntityHitEntity,
  onPlayerInteractWithEntity,
} from "./entities/entityEvents";
import { pikminManager, latchManager, carryManager } from "./exports";


system.beforeEvents.startup.subscribe(data => {
  itemComponentsRegistry(data);
});

world.afterEvents.itemStartUseOn.subscribe(data => {
  onItemStartUseOn(data);
});

world.afterEvents.dataDrivenEntityTrigger.subscribe(data => {
  onDataDrivenEntityTrigger(data);
});

world.afterEvents.projectileHitEntity.subscribe(data => {
  onProjectileHitEntity(data);
});

world.afterEvents.projectileHitBlock.subscribe(data => {
  onProjectileHitBlock(data);
});

world.afterEvents.entityDie.subscribe(data => {
  onEntityDie(data);
});

world.beforeEvents.entityHurt.subscribe(data => {
  onEntityHurtBefore(data);
});

world.afterEvents.entityHitEntity.subscribe(data => {
  onEntityHitEntity(data);
});

world.afterEvents.playerInteractWithEntity.subscribe(data => {
  onPlayerInteractWithEntity(data);
});

// Master 1-tick loop for projectile scanning & latched entity teleportation
system.runInterval(() => {
  pikminManager.tickProjectiles();
  latchManager.tickLatchedHosts();
  carryManager.tickCarriers();
}, 1);