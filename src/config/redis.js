const { createClient } = require('redis');

const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  socket: {
    reconnectStrategy: (retries) => {
      if (retries > 3) return false; // stop reconnecting after 3 attempts
      return Math.min(retries * 500, 3000);
    },
  },
});

redisClient.on('error', (err) => {
  // Only log once, not on every retry
  if (!redisClient._errorLogged) {
    console.warn('⚠️  Redis unavailable — caching disabled (app continues without it)');
    redisClient._errorLogged = true;
  }
});
redisClient.on('connect', () => console.log('✅ Redis connected'));

const connectRedis = async () => {
  try {
    await redisClient.connect();
  } catch (err) {
    console.warn('⚠️  Redis connection failed — running without cache');
  }
};

const getRedisClient = () => redisClient;

module.exports = { redisClient, connectRedis, getRedisClient };
