const factory = require('@backstage/cli/config/eslint-factory')(__dirname);

// Enforce the core seam: nothing under src/core/ may import @backstage/*.
// The neutral core stays portable; all Backstage knowledge lives in the
// adapter (the Entity → AgentSnapshot mapper, the module, the plugin).
// See ADR 0011 and CONTEXT.md.
module.exports = {
  ...factory,
  overrides: [
    ...(factory.overrides ?? []),
    {
      files: ['src/core/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['@backstage/*'],
                message:
                  'core/ must stay framework-neutral — no @backstage imports. Map at the adapter seam instead.',
              },
            ],
          },
        ],
      },
    },
  ],
};
