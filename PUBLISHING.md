# Publishing

## Versioning

The package version is pinned to the `@livestore/common` peer dependency version. When LiveStore releases a new version, update the version in `package.json` to match before publishing.

## Local testing

Build and pack a tarball for local testing:

```sh
pnpm run pack
```

This produces a `.tgz` file in the project root. Install it in another project with:

```sh
pnpm add /path/to/convex-livestore-x.y.z.tgz
```

If component function signatures changed, regenerate the checked-in Convex component API before packing:

```sh
pnpm run build:codegen
```

## Publishing

Set the version in `package.json` to match the current `@livestore/common` version, then run:

```sh
# Alpha release
pnpm run publish:alpha

# Stable release
pnpm run publish:stable
```

`prepublishOnly` runs `build:clean` automatically before publishing.

After publishing, tag the release and push:

```sh
git tag vX.Y.Z
git push --follow-tags
```
