# Security policy

## Supported versions

Only the latest published release receives fixes. Cuelume is pre-1.0, so
that means the most recent `0.x` release on npm.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's
private vulnerability reporting on this repository (Security tab →
"Report a vulnerability") and include:

- the affected version,
- a minimal reproduction,
- the impact you observed.

Cuelume runs in the page that imports it and makes no network requests,
reads no storage, and stores nothing across page loads, so reports will
usually concern the build or publish pipeline rather than playback.
