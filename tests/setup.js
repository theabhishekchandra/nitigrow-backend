
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Test env — set BEFORE any src/* module is required.
// NOTE: ENCRYPTION_KEY must be 64 hex chars (32 bytes) per services/encryption.js.
// The brief specified a 32-char value; that would throw at decrypt-time, so we
// expand it to 64 hex chars while keeping the deterministic pattern.
process.env.NODE_ENV = 'test';
process.env.USE_MOCK = 'true';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.WEBHOOK_VERIFY_TOKEN = 'test-verify-token';
process.env.META_APP_SECRET = 'test-app-secret';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();
  await mongoose.connect(process.env.MONGODB_URI);
});

afterEach(async () => {
  if (mongoose.connection.readyState !== 1) return;
  const collections = mongoose.connection.collections;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});
