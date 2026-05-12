// migrate-mongo configuration
// Loads MONGODB_URI from .env so migrations run against the same database as the app.
// IMPORTANT: this script resolves whichever MONGODB_URI is in your current environment —
// double-check before running against prod.

require('dotenv').config();

const url = process.env.MONGODB_URI;

if (!url) {
  // Fail fast — migrate-mongo would otherwise produce a confusing error.
  throw new Error(
    'MONGODB_URI is not set. Add it to .env before running migrate-mongo.'
  );
}

const config = {
  mongodb: {
    url,
    // Database name is inferred from the connection string. Leave `databaseName`
    // unset so migrate-mongo uses whatever DB is encoded in MONGODB_URI.
    options: {
      // Modern MongoDB driver (v6+) ignores useNewUrlParser/useUnifiedTopology;
      // leave options empty and rely on driver defaults.
    },
  },

  // The migrations dir, can be a relative or absolute path. Only edit this when really necessary.
  migrationsDir: 'migrations',

  // The mongodb collection where the applied changes are stored.
  changelogCollectionName: 'migrations_changelog',

  // The file extension to create migrations and search for in migration dir.
  migrationFileExtension: '.js',

  // Enable the algorithm to create a checksum of the file contents and use that in the comparison
  // to determine if the file should be run. Requires that scripts are coded to be run multiple times.
  useFileHash: false,

  // Don't change this, unless you know what you're doing.
  moduleSystem: 'commonjs',
};

module.exports = config;
