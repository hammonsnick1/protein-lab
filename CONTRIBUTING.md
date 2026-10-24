# Contributing to Protein Lab

Thanks for helping improve Protein Lab. Please use issues for bugs and proposals, and keep pull requests focused on one outcome.

## Development workflow

1. Create a branch named `<area>/<issue-id>-<slug>` from `main`.
2. Make the smallest change that solves the issue and add a regression test.
3. Run the relevant checks before opening a pull request:
   - UI: `npm run lint`, `npm run typecheck`, and `npm test` in `protein-labs-web/`.
   - Engine: `python -m pytest` in `protein-labs/backend/`.
4. Open a pull request against `main` with the issue number, test results, and any user-visible changes.

Do not commit credentials, generated build output, local project data, or experiment material. Changes to scientific calculations must include a test with a known expected result; visual plausibility is not sufficient evidence.

## Review and conduct

Every pull request needs a maintainer review before merging. Be respectful and follow the [Code of Conduct](CODE_OF_CONDUCT.md).
