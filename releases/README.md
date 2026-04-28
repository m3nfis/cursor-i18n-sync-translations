# Releases

Versioned, dated snapshots of the published `.vsix`. Devs can install
directly from here without having to build the extension locally:

```bash
cursor --install-extension releases/i18n-sync-translations-1.1.0-2026-04-28.vsix
```

Or via the UI: `Cmd+Shift+P` → *Extensions: Install from VSIX…* → pick
the file under `releases/`.

## Naming convention

```
i18n-sync-translations-<semver>-<YYYY-MM-DD>.vsix
```

- `<semver>` matches the `version` field in `package.json` for that release.
- `<YYYY-MM-DD>` is the UTC date the snapshot was cut. Multiple snapshots
  per semver are allowed (e.g. quick re-issues with the same version).

## Release procedure

1. Bump `version` in `package.json` and add an entry in `CHANGELOG.md`.
2. Let the auto-repackage hook produce the new `.vsix` at the repo root,
   or run `npm run package` manually.
3. Smoke-test with `cd test-app && npm run i18n:e2e` (~50 s).
4. Copy the `.vsix` into this folder with the dated filename:
   ```bash
   cp i18n-sync-translations-<semver>.vsix \
      releases/i18n-sync-translations-<semver>-$(date -u +%F).vsix
   ```
5. Commit and push.

## Git ignore policy

The repo's `.gitignore` excludes `*.vsix` everywhere **except** under
`releases/` (`!releases/*.vsix`). The unversioned `.vsix` at the repo
root that the auto-repackage hook produces is a build artifact and
stays out of git; only intentional snapshots live here.
