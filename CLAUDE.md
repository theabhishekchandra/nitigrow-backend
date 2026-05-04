# NitiGrow Backend — Claude Instructions

## What Is This?
Node.js + Express API server for NitiGrow WhatsApp marketing platform.
This is the core — every other part (web, mobile, SDK) depends on this.

## Tech Stack
- **Runtime:** Node.js 20 LTS
- **Framework:** Express.js
- **Database:** MongoDB 7.x (mongoose ODM)
- **Cache:** Redis 7.x
- **Real-time:** Socket.io
- **Auth:** JWT (access token 15min + refresh token 30 days)
- **File Storage:** MinIO (self-hosted S3-compatible)
- **WhatsApp:** Meta Cloud API (direct HTTP calls via axios)
- **AI:** Claude API — @anthropic-ai/sdk
- **Payments:** Razorpay
- **Queue/Jobs:** node-cron + Bull (Redis-backed)
- **Email:** Resend

## Project Structure (Build This)
```
src/
├── config/         db.js, redis.js, env.js
├── models/         MongoDB schemas
├── routes/         API endpoint definitions
├── controllers/    Business logic
├── middleware/     auth.js, tenant.js, rateLimit.js, permissions.js
├── services/       whatsapp.js, ai.js, payment.js, email.js, storage.js
├── utils/          helpers, constants, validators
└── jobs/           cron jobs, schedulers
```

## Critical Rules
- **EVERY** MongoDB query must filter by `tenantId` — no exceptions
- Access tokens (Meta System User tokens) stored AES-256 encrypted — never plain text
- Never log sensitive data (tokens, passwords) — use `***REDACTED***`
- All secrets in `.env` — never hardcoded
- Rate limit every public endpoint
- Validate all input at route level (use Joi)

## Environment Variables Needed
```
PORT=3000
MONGODB_URI=
REDIS_URL=
JWT_SECRET=
JWT_REFRESH_SECRET=
WHATSAPP_API_URL=https://graph.facebook.com/v19.0
META_APP_ID=
META_APP_SECRET=
ANTHROPIC_API_KEY=
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
MINIO_ENDPOINT=
MINIO_ACCESS_KEY=
MINIO_SECRET_KEY=
RESEND_API_KEY=
ENCRYPTION_KEY=
```

## API Base URL
- Production: `https://api.nitigrow.in`
- Staging: `https://staging.nitigrow.in`
- Local: `http://localhost:3000`

## Key Phase Docs
- `../docs/phase-1-backend.md` — full backend build checklist
- `../docs/phase-2-onboarding.md` — Meta Embedded Signup + RBAC
- `../docs/phase-4-ai.md` — AI features with Claude API
- `../docs/phase-8-billing.md` — Razorpay subscriptions

## Start Here (Phase 1 Order)
1. Server + MongoDB + Redis setup (Section 1)
2. Multi-tenant MongoDB architecture (Section 2)
3. Auth system — JWT + refresh tokens (Section 3)
4. WhatsApp Cloud API integration (Section 4)
5. Contacts management (Section 5)
6. Broadcast campaign sender (Section 6)
7. Inbox + real-time Socket.io (Section 7)
