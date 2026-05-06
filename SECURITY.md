# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this package, please report it to us.

**DO NOT** create a public GitHub issue for security vulnerabilities.

### How to Report

Email: support@revenium.io

Please include:
- Package version (`npx @revenium/revvy --version`)
- Description of the vulnerability
- Steps to reproduce (if applicable)
- Potential impact
- Suggested fix (if available)

We will review and respond to security reports in a timely manner.

## Security Best Practices

When using this CLI:

1. **API Keys**: Never commit `REVENIUM_METERING_API_KEY` or other API keys to version control. Revvy writes the key to your project's `.env` file (which should be in your `.gitignore`).
2. **Code Modifications**: Revvy modifies source files in-place when instrumenting (with `*.revvy-backup` files alongside originals). Always run with `--dry-run` first on important codebases and review the diff before applying.
3. **CI Secrets**: The generated GitHub Actions workflow expects `REVENIUM_METERING_API_KEY` to be a repository secret. Do not pass it via plaintext workflow input.
4. **Network Security**: All connections to Revenium APIs use HTTPS.
5. **Updates**: Keep the package updated to the latest version (`npm outdated -g @revenium/revvy`).

## Data Transmission

The Revvy CLI itself transmits the following to the Revenium API only during the verification phase:

- A single test metering event (provider, model, dummy token counts) to validate the configured API key

No source code, file paths, or contents of your project are ever transmitted by the CLI. AST analysis runs locally and never leaves your machine.

## Additional Resources

- [Revenium Documentation](https://docs.revenium.io)
