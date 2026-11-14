# Vendored `mobx-utils`

`computedFn` was the only thing we ever used from the `mobx-utils` npm package. That package peers
`mobx: ^6.0.0`, has never shipped a MobX 7 release, and so blocked our MobX 7 upgrade.
Rather than carry the dependency, we vendor the two source files it needs.

## Do not adapt these files

Gather's linters and formatters skip `**/vendor/**` so this copy stays byte-identical to upstream.
Reformatting them is what makes this directory expensive again.

Behavior that differs from upstream belongs in a wrapper outside this directory.

Each file's banner lists its own deltas.

## Provenance

`mobx-utils@6.1.1`, MIT — see `./LICENSE`.