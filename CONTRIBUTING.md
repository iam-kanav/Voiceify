# Contributing to Voiceify

Thanks for helping make Voiceify better! Bug reports, model suggestions, docs fixes and code are all welcome.

## Ways to contribute

- **Report a bug:** [open a bug report](https://github.com/iam-kanav/Voiceify/issues/new?template=bug_report.yml). Include your Mac model, memory and the model you were using.
- **Suggest a feature or model:** use the [feature request](https://github.com/iam-kanav/Voiceify/issues/new?template=feature_request.yml) or [model request](https://github.com/iam-kanav/Voiceify/issues/new?template=model_request.yml) templates.
- **Send a pull request:** for anything bigger than a small fix, open an issue first so we can agree on the approach.

## Development setup

Requirements: an Apple silicon Mac and Node.js 22+.

```bash
git clone https://github.com/iam-kanav/Voiceify.git
cd Voiceify
npm install
npm run dev
```

The first launch runs the setup wizard, which installs an isolated Python runtime and the models you pick. To test the wizard without touching your real data, use a throwaway profile:

```bash
VOICEIFY_USER_DATA=/tmp/voiceify-test npm run dev
```

> **Running inside an Electron-based terminal** (VS Code, T3 Code, …)? These often export `ELECTRON_RUN_AS_NODE=1`, which stops Electron from starting. `npm run dev` already unsets it; if you launch Electron another way, run `env -u ELECTRON_RUN_AS_NODE …`.

## Before you open a pull request

```bash
npm run typecheck   # must pass
npm run build       # must succeed
```

- Keep pull requests focused: one change per PR.
- Match the surrounding code style (TypeScript, React function components, Tailwind classes, no semicolons, single quotes).
- Write user-facing copy in plain language. Voiceify is for people who aren't ML experts, so explain what an option does rather than naming the technique.
- New models go in `src/shared/catalog.ts`; new pages are registered in `src/renderer/src/app/registry.tsx`. See [How it works](README.md#how-it-works).
- If you change the UI, add a screenshot to the PR.

## Commit messages

Write a short summary in the imperative mood (“Add speech-to-text page”), followed by a blank line and details if needed.

## License

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](LICENSE).
