import { PikminManager } from "./pikmin/pikmin_manager";
import { LatchManager } from "./pikmin/latch_manager";
import { WhistleManager } from "./pikmin/whistle_manager";

export const NAMESPACE = "pkc";

// Tracks players who placed a Pikmin on a block in the current tick to suppress accidental throws
export const placementTickLocks = new Map();

// Tracks active thrown Pikmin projectiles for mid-air item scanning & liquid impact
export const activeProjectiles = new Set();

// Tracks hostEntityId -> { host, points, maxPointsTick, pikminMap: Map<pikminId, { pikmin, offset }> }
export const latchedHosts = new Map();

export const pikminManager = new PikminManager();
export const latchManager = new LatchManager();
export const whistleManager = new WhistleManager();