# Genesis Release Process

Policy-Version: 2.0.0
Authority: Explanatory

Genesis releases are versioned CLI artifacts built from the governed repository. Packaging is an internal, reversible build action. Publishing to npm, creating a public GitHub release, or making release claims is a protected public/production action and requires a separate valid Human Authority approval record.

## Compatibility contract

- Package versions follow Semantic Versioning.
- Node.js 22 or newer is required.
- `genesis.yaml` remains the normative policy manifest and currently requires policy version `2.0.0`.
- Record schema compatibility is explicit. A breaking schema or record-layout change requires a package major version change and a documented migration.
- Patch and minor releases must continue reading valid append-only workspaces created by earlier releases in the same major version.
- SQLite is a rebuildable cache. Canonical YAML records must remain sufficient to reconstruct it.
- Releases never migrate, delete, or rewrite a user workspace automatically.

## Build and verification

```bash
npm ci
npm run check
npm run pack:preview
npm run release:verify
```

`release:verify` creates the npm tarball, checks its allowlisted contents, installs it in a clean temporary project, and runs the packaged `genesis --help`. The tarball excludes tests, historical review artifacts, governance approval records, the landing page, and experiment assets.

The `Package Genesis CLI` GitHub Actions workflow repeats these checks on manual dispatch or a `v*` tag and retains the tarball as a workflow artifact. It does not publish to npm.

## Release checklist

1. Confirm the working tree is clean and `main` is synchronized.
2. Update `package.json` and `CHANGELOG.md` together.
3. Run the complete build and verification commands above.
4. Confirm the tag exactly matches `v<package version>`.
5. Obtain a valid Human Authority record covering the exact registry, package name, version, public claims, actor, and release window.
6. Choose and record a software license before any public registry publication. The current package remains `UNLICENSED` and `private`.
7. Only after authorization, enable the separately reviewed public publishing step and configure npm trusted publishing or a narrowly scoped token.
8. Verify the installed public artifact, provenance, checksums, and CLI version after publication.

## Rollback reality

npm versions are immutable and should not be overwritten. A bad release is corrected with a new version; deprecation may point users away from the faulty version. Canonical user records remain untouched.
