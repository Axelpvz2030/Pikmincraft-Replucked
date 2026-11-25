import { PikminManager } from "./pikmin/pikmin_manager";
import { LatchManager } from "./pikmin/latch_manager";
import { WhistleManager } from "./pikmin/whistle_manager";
import { CarryManager } from "./pikmin/carry_manager";

export const NAMESPACE = "pkc";

export const placementTickLocks = new Map();
export const activeProjectiles = new Set();
export const latchedHosts = new Map();

// Tracks dummyEntityId -> { dummy, vehicle, ownerId, requiredPikmin, maxPikmin, mountedPikmin, pendingPikmin, ... }
export const activeCarriers = new Map();

export const pikminManager = new PikminManager();
export const latchManager = new LatchManager();
export const whistleManager = new WhistleManager();
export const carryManager = new CarryManager();