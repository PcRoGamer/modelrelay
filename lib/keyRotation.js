/**
 * @file lib/keyRotation.js
 * @description Multi-API key rotation and load balancing for providers
 *
 * Features:
 * - Round-robin key rotation
 * - Weighted distribution
 * - Priority-based fallback
 * - Rate limit tracking per key
 * - Automatic key exclusion on failure
 */

import { createHash } from 'crypto';

// Key rotation strategies
export const ROTATION_STRATEGIES = {
  ROUND_ROBIN: 'round-robin',
  WEIGHTED: 'weighted',
  PRIORITY: 'priority',
  RANDOM: 'random'
};

// Default config for multi-key
export const DEFAULT_MULTI_KEY_CONFIG = {
  rotation: ROTATION_STRATEGIES.ROUND_ROBIN,
  fallback: true,
  retryAttempts: 3,
  cooldownMs: 60000 // 1 minute cooldown after rate limit
};

/**
 * Key state manager per provider
 */
export class KeyRotationManager {
  constructor(providerKey, config) {
    this.providerKey = providerKey;
    this.keys = config.keys || [];
    this.strategy = config.rotation || DEFAULT_MULTI_KEY_CONFIG.rotation;
    this.fallback = config.fallback ?? DEFAULT_MULTI_KEY_CONFIG.fallback;
    this.retryAttempts = config.retryAttempts || DEFAULT_MULTI_KEY_CONFIG.retryAttempts;
    
    // State tracking
    this.currentIndex = 0;
    this.keyStates = new Map(); // key -> { failures, lastUsed, rateLimitUntil, usageCount }
    
    // Initialize states
    for (const keyData of this.keys) {
      const key = typeof keyData === 'string' ? keyData : keyData.key;
      this.keyStates.set(key, {
        failures: 0,
        lastUsed: null,
        rateLimitUntil: null,
        usageCount: 0,
        weight: keyData.weight || 1,
        priority: keyData.priority || 1,
        limit: keyData.limit || null, // Optional usage limit
        limitWindow: keyData.limitWindow || 'day', // day, hour, minute
        windowUsage: 0,
        windowStart: Date.now()
      });
    }
  }

  /**
   * Get next available key based on rotation strategy
   */
  getNextKey() {
    const availableKeys = this.getAvailableKeys();
    
    if (availableKeys.length === 0) {
      // All keys exhausted - reset rate limits if cooldown passed
      this.resetExpiredCooldowns();
      const retryKeys = this.getAvailableKeys();
      if (retryKeys.length === 0) {
        return null; // No keys available
      }
      return this.selectKeyByStrategy(retryKeys);
    }
    
    return this.selectKeyByStrategy(availableKeys);
  }

  /**
   * Get keys that are not rate limited or failed
   */
  getAvailableKeys() {
    const now = Date.now();
    return this.keys.filter(keyData => {
      const key = typeof keyData === 'string' ? keyData : keyData.key;
      const state = this.keyStates.get(key);
      
      if (!state) return false;
      
      // Check rate limit cooldown
      if (state.rateLimitUntil && now < state.rateLimitUntil) {
        return false;
      }
      
      // Check usage limit
      if (state.limit && state.windowUsage >= state.limit) {
        // Check if window reset needed
        const windowMs = this.getWindowMs(state.limitWindow);
        if (now - state.windowStart >= windowMs) {
          // Reset window
          state.windowUsage = 0;
          state.windowStart = now;
          return true;
        }
        return false;
      }
      
      // Check failure threshold
      if (state.failures >= this.retryAttempts) {
        return false;
      }
      
      return true;
    }).map(k => typeof k === 'string' ? k : k.key);
  }

  /**
   * Select key based on rotation strategy
   */
  selectKeyByStrategy(availableKeys) {
    if (availableKeys.length === 0) return null;
    if (availableKeys.length === 1) {
      this.markKeyUsed(availableKeys[0]);
      return availableKeys[0];
    }

    switch (this.strategy) {
      case ROTATION_STRATEGIES.ROUND_ROBIN:
        return this.roundRobinSelect(availableKeys);
      
      case ROTATION_STRATEGIES.WEIGHTED:
        return this.weightedSelect(availableKeys);
      
      case ROTATION_STRATEGIES.PRIORITY:
        return this.prioritySelect(availableKeys);
      
      case ROTATION_STRATEGIES.RANDOM:
        return this.randomSelect(availableKeys);
      
      default:
        return this.roundRobinSelect(availableKeys);
    }
  }

  /**
   * Round-robin selection
   */
  roundRobinSelect(availableKeys) {
    // Find next index in available keys
    let startIndex = this.currentIndex % this.keys.length;
    let selected = null;
    
    for (let i = 0; i < this.keys.length; i++) {
      const idx = (startIndex + i) % this.keys.length;
      const keyData = this.keys[idx];
      const key = typeof keyData === 'string' ? keyData : keyData.key;
      
      if (availableKeys.includes(key)) {
        selected = key;
        this.currentIndex = idx + 1;
        break;
      }
    }
    
    if (selected) {
      this.markKeyUsed(selected);
    }
    return selected;
  }

  /**
   * Weighted random selection
   */
  weightedSelect(availableKeys) {
    const weights = availableKeys.map(key => {
      const state = this.keyStates.get(key);
      return state?.weight || 1;
    });
    
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let random = Math.random() * totalWeight;
    
    for (let i = 0; i < availableKeys.length; i++) {
      random -= weights[i];
      if (random <= 0) {
        this.markKeyUsed(availableKeys[i]);
        return availableKeys[i];
      }
    }
    
    this.markKeyUsed(availableKeys[0]);
    return availableKeys[0];
  }

  /**
   * Priority-based selection (lower priority number = higher priority)
   */
  prioritySelect(availableKeys) {
    // Sort by priority
    const sorted = [...availableKeys].sort((a, b) => {
      const stateA = this.keyStates.get(a);
      const stateB = this.keyStates.get(b);
      return (stateA?.priority || 1) - (stateB?.priority || 1);
    });
    
    this.markKeyUsed(sorted[0]);
    return sorted[0];
  }

  /**
   * Random selection
   */
  randomSelect(availableKeys) {
    const idx = Math.floor(Math.random() * availableKeys.length);
    this.markKeyUsed(availableKeys[idx]);
    return availableKeys[idx];
  }

  /**
   * Mark key as used
   */
  markKeyUsed(key) {
    const state = this.keyStates.get(key);
    if (state) {
      state.lastUsed = Date.now();
      state.usageCount++;
      state.windowUsage++;
    }
  }

  /**
   * Mark key as failed
   */
  markKeyFailed(key, error) {
    const state = this.keyStates.get(key);
    if (state) {
      state.failures++;
      
      // Check for rate limit error
      if (error?.status === 429 || error?.message?.includes('rate limit')) {
        state.rateLimitUntil = Date.now() + DEFAULT_MULTI_KEY_CONFIG.cooldownMs;
      }
    }
  }

  /**
   * Mark key as succeeded (reset failures)
   */
  markKeySuccess(key) {
    const state = this.keyStates.get(key);
    if (state) {
      state.failures = 0;
    }
  }

  /**
   * Reset expired rate limit cooldowns
   */
  resetExpiredCooldowns() {
    const now = Date.now();
    for (const [key, state] of this.keyStates) {
      if (state.rateLimitUntil && now >= state.rateLimitUntil) {
        state.rateLimitUntil = null;
        state.failures = 0;
      }
    }
  }

  /**
   * Get window duration in milliseconds
   */
  getWindowMs(window) {
    switch (window) {
      case 'minute': return 60 * 1000;
      case 'hour': return 60 * 60 * 1000;
      case 'day': return 24 * 60 * 60 * 1000;
      case 'month': return 30 * 24 * 60 * 60 * 1000;
      default: return 24 * 60 * 60 * 1000; // Default to day
    }
  }

  /**
   * Get stats for all keys
   */
  getStats() {
    const stats = {};
    for (const [key, state] of this.keyStates) {
      stats[key.substring(0, 8) + '...'] = {
        usageCount: state.usageCount,
        failures: state.failures,
        rateLimited: state.rateLimitUntil ? new Date(state.rateLimitUntil).toISOString() : null,
        windowUsage: state.windowUsage,
        weight: state.weight,
        priority: state.priority
      };
    }
    return stats;
  }
}

/**
 * Global key rotation managers per provider
 */
const keyRotationManagers = new Map();

/**
 * Initialize or get key rotation manager for provider
 */
export function getKeyRotationManager(providerKey, config) {
  if (!keyRotationManagers.has(providerKey)) {
    if (config?.keys && Array.isArray(config.keys)) {
      keyRotationManagers.set(providerKey, new KeyRotationManager(providerKey, config));
    }
  }
  return keyRotationManagers.get(providerKey);
}

/**
 * Clear all managers (for testing/config reload)
 */
export function clearKeyRotationManagers() {
  keyRotationManagers.clear();
}

/**
 * Check if provider has multi-key config
 */
export function hasMultiKeyConfig(config, providerKey) {
  return config?.apiKeysV2?.[providerKey]?.keys?.length > 0;
}

/**
 * Get API key with rotation support
 * Returns { key: string, manager: KeyRotationManager|null }
 */
export function getApiKeyWithRotation(config, providerKey) {
  // Check for multi-key config
  const multiKeyConfig = config?.apiKeysV2?.[providerKey];
  if (multiKeyConfig?.keys?.length > 0) {
    const manager = getKeyRotationManager(providerKey, multiKeyConfig);
    if (manager) {
      const key = manager.getNextKey();
      if (key) {
        return { key, manager };
      }
    }
  }
  
  // Fallback to single key
  return { key: config?.apiKeys?.[providerKey] || null, manager: null };
}

/**
 * Report key result (success/failure) for rotation tracking
 */
export function reportKeyResult(providerKey, key, success, error = null) {
  const manager = keyRotationManagers.get(providerKey);
  if (manager) {
    if (success) {
      manager.markKeySuccess(key);
    } else {
      manager.markKeyFailed(key, error);
    }
  }
}

/**
 * Migrate legacy single key to multi-key format
 */
export function migrateToMultiKey(singleKey, options = {}) {
  return {
    keys: [{ 
      key: singleKey, 
      weight: options.weight || 1,
      priority: options.priority || 1 
    }],
    rotation: options.rotation || ROTATION_STRATEGIES.ROUND_ROBIN,
    fallback: options.fallback ?? true
  };
}

/**
 * Get key rotation stats for all providers
 */
export function getAllKeyStats(config) {
  const stats = {};
  for (const [providerKey, manager] of keyRotationManagers) {
    stats[providerKey] = manager.getStats();
  }
  return stats;
}
