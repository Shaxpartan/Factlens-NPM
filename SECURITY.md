# Security policy

## Supported version

Security fixes are prepared for the latest released `1.x` version once the package is published.

## Report a vulnerability

Do not open a public issue containing a live FactLens API key, developer token, request payload, customer information, or exploit details.

Use GitHub's private vulnerability reporting for this repository. Include the affected version, impact, reproduction steps, and any request IDs with credentials and sensitive payloads removed.

## Credential handling

- Keep `fl_*` project API keys and `fldev_*` developer tokens in server-side secret storage.
- Never bundle them into browser or mobile applications.
- Revoke a credential immediately if it may have been disclosed.
- Create separate project keys for separate environments.
- Use developer tokens only where account management is required.
