# Security Policy

## Supported versions
Only the latest version on the `main` branch receives security fixes.

## Reporting a vulnerability
Please **do not open a public issue** for security problems.

Report privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Include the steps to reproduce, the affected page or API route, and the impact you expect. You should get a reply within a few days.

Please do not access other people's data, run denial-of-service tests, or test against a deployment you do not own.

## How FinVista protects data
- Never asks for bank logins or account numbers; users enter or import their own records.
- Passwords hashed with scrypt; server-side sessions with HttpOnly, Secure, SameSite cookies.
- Every query scoped to the signed-in user; strict Content Security Policy; CSRF and brute-force protection.
- API keys and database credentials live only in server environment variables, never in the browser or the repository.

Full details, test results and known limitations: [docs/SECURITY.md](docs/SECURITY.md).
