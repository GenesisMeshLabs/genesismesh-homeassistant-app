# Repeatable Home Assistant publication

Push tested implementation to `main`. The pinned GitHub Actions workflow does
the remaining work without a local Docker installation, uploaded image or
long-lived publication secret:

1. Install locked JavaScript dependencies and the pinned authority with its
   constraints; run unit, real-authority integration and browser tests. A separate
   pinned real HA Core container verifies native role changes and REST catalog
   compatibility; it never dispatches a physical command.
2. Allocate `0.1.0-dev.<workflow run number>` (the base is in app config).
3. Build native amd64 and arm64 images on separate runners. Each starts a fresh
   authority automatically and passes scoped-access, deny, fresh native-role,
   non-root PID, spoofed-header, restart and revocation container checks.
4. Publish immutable architecture tags; combine their digests into one versioned
   multi-architecture image. A rerun reuses and retests matching existing tags;
   revision/version mismatches stop publication rather than overwriting a tag.
5. Verify anonymous registry access. Create a GitHub prerelease with source SHA,
   image digest and limitations. Only then commit the advertised config version,
   changelog and repository metadata back to `main`.

The pipeline uses the ephemeral `GITHUB_TOKEN`. Generated bot commits do not
start another release. Concurrent releases queue; a stale run cannot force its
metadata over newer source. `workflow_dispatch` is an optional recovery path,
not part of normal publication. A failed gate leaves the previously advertised
version in place. There are no mutable `latest` tags for HA installations.

The package used by this repository is public; anonymous access was verified for
both published iterations. If this pipeline is forked to a new package, check
its initial visibility: GitHub documents new packages as private by default.
The anonymous-access gate prevents a private image being advertised.
Repository/organization settings must continue to permit Actions package writes
and bot commits. No household credentials are stored in GitHub.

HA installs updates through its usual update mechanism. This pipeline does not
silently enable automatic installation in a user's home. Software/container
gates use a simulated Supervisor/Core proxy. Actual HA OS installation,
appliance lifecycle and physical-device acceptance are separate release gates
before stable/production claims. Releases remain experimental prereleases.

References: [HA publishing](https://contributors.home-assistant.io/apps/guides/publishing/),
[app repositories](https://contributors.home-assistant.io/apps/guides/repository/),
[ingress trust](https://contributors.home-assistant.io/apps/guides/ingress/),
[GHCR publication and visibility](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).
