# Contributing

Thanks for considering a contribution to `dsh-timeout`.

## Before you start

- Read the [README](README.md) to understand the bundle and its behavior.
- The plugin targets [DeepSeek Harness](https://www.deepseek.com/en/harness/)
  0.2.x and hooks the `tools/execute` waterfall.

## Development

The package has a single runtime dependency (`@deepseek-ai/schemastery` for
the settings schema) and no build step.

```bash
npm install              # install the settings schema library
npm test                 # unit + manifest tests
npm run test:unit        # same suites
npm run pack:check       # inspect the files npm would publish
```

Requirements: Node.js 20 or newer. Run the tests before opening a pull
request. CI runs them on Linux and Windows with Node.js 20, 22, and 24.

## Bundle checklist

This repository is a DSH plugin bundle, so keep these invariants:

- `package.json` declares `dsh.bundle.patch` and the patch inserts exactly one
  `backoff` row pointing at the package name.
- Runtime modules live in `lib/` and are covered by the `files` array
  (`lib/*.js`). The manifest test fails when a module is missing from it.
- `locale/en.json` and `locale/ru.json` keep meaningful `meta.title` and
  `meta.description`; the icon stays a valid SVG below 256 KiB.
- Configuration stays backward compatible: unknown fields are ignored and all
  fields remain optional.
- The retry loop must never retry a call whose caller signal is aborted, and
  it must restore `exec.signal` after arming a per-attempt deadline.
- Documentation links to https://www.deepseek.com/en/harness/ and the project
  repository.

## Code style

- ES modules, 2-space indentation, no semicolons, single quotes.
- Pure logic goes in `lib/config.js` and `lib/backoff.js` so it can be tested
  without a process or a Harness.
- Context wiring stays in `lib/plugin.js`; the browser settings page stays in
  `client.js`.
- Add or update tests with every behavior change.

## Reporting issues

Open an issue at https://github.com/WatchDG/dsh-timeout/issues with the DSH
version, the operating system, the tool name and error code that behaved
unexpectedly, and the relevant log excerpt.

## License

By contributing, you agree that your contributions are licensed under the
Apache License 2.0, as described in [LICENSE](LICENSE).
