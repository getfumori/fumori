# Fumori

Fumori is a private, self-hosted knowledge system: a forest grown from your
words.

The product is designed around durable Markdown notes, explicit links and
relationships, isolated Vaults, and AI that can read and map authorized
knowledge without silently rewriting Human Notes.

## Foundation tracer

The first runnable tracer bootstraps an operator-created empty Git repository
as a Blank Vault and serves its virtual Today surface from the packaged CLI:

```sh
git init ~/fumori-vault
npx fumori vault bootstrap --path ~/fumori-vault
npx fumori serve --vault ~/fumori-vault
```

The server binds to `127.0.0.1:3000` by default. Passing `--host` explicitly can
expose it elsewhere, but this Foundation tracer provides neither
authentication nor TLS.

Bootstrap creates the canonical Vault Manifest, neutral Core Model, reserved
ownership zones, and one initial Git commit. Opening a missing Today surface is
read-only: it does not create a Daily Note or dirty the repository.

## Development

Fumori requires Node.js 24 LTS, pnpm, and the system Git CLI:

```sh
corepack pnpm install
corepack pnpm run typecheck
corepack pnpm test
```

The end-to-end test packs the npm artifact, installs it outside this checkout,
uses its real CLI against a temporary Git repository, starts its real server,
and opens Chromium at the accepted desktop viewports.

## Project documents

- [`CONTEXT.md`](CONTEXT.md) is the living domain glossary and records the
  accepted product and architecture boundaries.
- [`docs/architecture/accepted-baseline.md`](docs/architecture/accepted-baseline.md)
  is the self-contained implementation-facing digest of the accepted research
  architecture.
- [`docs/product/foundation-release.md`](docs/product/foundation-release.md)
  records the accepted first shippable scope, desktop interaction boundary,
  explicit deferrals, and measurable acceptance contract.
- [`docs/research-provenance.md`](docs/research-provenance.md) identifies the
  historical source repository, baseline commit, and canonical evidence.
- [`docs/adr/`](docs/adr/) records accepted decisions that would otherwise be
  surprising or expensive to reverse.
- [`docs/research/`](docs/research/) contains implementation-planning evidence
  gathered from primary sources.
- [`docs/product/brand.md`](docs/product/brand.md) records the Fumori name,
  meaning, metaphor, and brand direction.
- [`docs/brand/`](docs/brand/) contains brand references. The current image is
  a raster concept, not a production logo.
- [`docs/agents/`](docs/agents/) defines the repository's agent workflow,
  GitHub issue tracker, triage vocabulary, and domain-doc conventions.

## License

[MIT](LICENSE)
