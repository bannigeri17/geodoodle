// Shared tunable constants. Change these to adjust difficulty and pacing.
export const ROUND_COUNT = 5;    // shapes per daily round

// Scoring
export const G = 128;            // scoring raster grid (target + user drawing compared at this size)
export const S = 256;            // interim raster grid the user's raw strokes are rendered at first
export const HINT_COST = 3;      // points deducted per hint used
export const MAX_HINTS = 3;
export const JOIN = 0.07;        // stroke-endpoint join distance, as a fraction of canvas width
export const ROT_FREE = 15;      // degrees of tilt forgiven at no cost
export const ROT_PENALTY_PER_DEG = 0.5; // points lost per degree beyond ROT_FREE

// Storage
export const STORE_KEY = 'roughborders:v2';
