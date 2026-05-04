const { redisClient } = require('../config/redis');

const CACHE_TTL_DEFAULT = 3600; // 1 hour

/**
 * Get or set a cached value
 * @param {string} key Redis key
 * @param {Function} fetchFn Function to execute if cache miss (must return Promise)
 * @param {number} ttl Time to live in seconds
 */
const getOrSetCache = async (key, fetchFn, ttl = CACHE_TTL_DEFAULT) => {
  if (!redisClient || !redisClient.isOpen) {
    // If Redis is not connected, gracefully bypass
    return await fetchFn();
  }

  try {
    const cachedData = await redisClient.get(key);
    if (cachedData) {
      return JSON.parse(cachedData);
    }
  } catch (err) {
    console.warn(`[Redis Cache GET Error] ${key}:`, err.message);
  }

  // Cache miss, execute fetch function
  const freshData = await fetchFn();

  try {
    if (freshData !== undefined && freshData !== null) {
      await redisClient.set(key, JSON.stringify(freshData), { EX: ttl });
    }
  } catch (err) {
    console.warn(`[Redis Cache SET Error] ${key}:`, err.message);
  }

  return freshData;
};

/**
 * Invalidate a cached key (e.g. after update)
 * @param {string} key Redis key
 */
const invalidateCache = async (key) => {
  if (redisClient && redisClient.isOpen) {
    await redisClient.del(key);
  }
};

/**
 * Invalidate multiple keys by pattern
 * @param {string} pattern Match pattern e.g. "tenant:*"
 */
const invalidateCachePattern = async (pattern) => {
  if (redisClient && redisClient.isOpen) {
    const keys = await redisClient.keys(pattern);
    if (keys.length > 0) {
      await redisClient.del(keys);
    }
  }
}

module.exports = {
  getOrSetCache,
  invalidateCache,
  invalidateCachePattern
};
