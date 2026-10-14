# Security policy

## Supported versions

Only the latest release of Voiceify receives security fixes.

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report privately through GitHub's [private vulnerability reporting](https://github.com/iam-kanav/Voiceify/security/advisories/new). Include steps to reproduce, the impact, and your Voiceify version. You should get a response within a few days.

## Scope notes

- Voiceify's local API and MCP server bind to `127.0.0.1` only and reject cross-origin browser requests. Anything that lets a website or another machine reach them is in scope.
- Model weights are downloaded from Hugging Face over HTTPS. Issues with third-party models themselves should be reported upstream.
