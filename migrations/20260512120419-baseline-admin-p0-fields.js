// Baseline migration for the Admin P0 security fields.
//
// During the P0 hardening pass we added several fields to the Admin schema:
//   - passwordChangedAt, failedLoginCount, lockedUntil
//   - lastLoginAt, lastLoginIp
//   - totpSecret, twoFactorEnabled, recoveryCodes
//   - preferences, sessions
//
// Mongoose tolerates missing fields, so existing documents kept working. This
// migration records the "as-of" state by backfilling sane defaults so future
// migrations have a known baseline to build on.

const DEFAULTS = {
  failedLoginCount: 0,
  twoFactorEnabled: false,
  recoveryCodes: [],
  sessions: [],
  preferences: {
    notifications: {
      newTicketUrgent: true,
      paymentFailed: true,
      qualityDropped: true,
      newSignup: false,
      weeklyDigest: true,
    },
  },
};

module.exports = {
  async up(db) {
    const result = await db.collection('admins').updateMany(
      { failedLoginCount: { $exists: false } },
      { $set: DEFAULTS }
    );

    // eslint-disable-next-line no-console
    console.log(
      `[baseline-admin-p0-fields] matched=${result.matchedCount} modified=${result.modifiedCount}`
    );
  },

  async down(db) {
    // eslint-disable-next-line no-console
    console.warn(
      '[baseline-admin-p0-fields] DOWN: $unset of P0 fields is destructive — ' +
        'failedLoginCount, twoFactorEnabled, recoveryCodes, sessions, and preferences ' +
        'will be removed from every admin document. Take a backup first.'
    );

    await db.collection('admins').updateMany(
      {},
      {
        $unset: {
          failedLoginCount: '',
          twoFactorEnabled: '',
          recoveryCodes: '',
          sessions: '',
          preferences: '',
        },
      }
    );
  },
};
