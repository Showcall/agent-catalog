# Changesets

Add one changeset with each user-facing or published-package change:

    yarn changeset

Choose patch for fixes and minor for new capabilities. Use major only when the
published API or configuration has a breaking change. The two public plugins
are fixed together and will always receive the same version.

The release workflow opens a version PR after changesets reach main. Review
that PR, confirm the root CHANGELOG.md entry, merge it, and push the matching
vX.Y.Z tag to publish through the existing npm Trusted Publishing workflow.

Not every documentation-only or internal change needs a changeset.
