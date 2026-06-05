# Contributing

Biblioteca is currently a **personal project** and not open for external contributions.
This file is retained for reference and future use.

## Development

```bash
# Setup
git submodule update --init --recursive
pnpm install
pnpm --filter @readest/readest-app setup-vendors

# Development
pnpm dev-web          # Web-only dev server
pnpm tauri dev        # Desktop dev with Tauri

# Build
dotenv -e apps/readest-app/.env.tauri -- pnpm --filter @readest/readest-app tauri build
```

## Credits

This project is based on [Readest](https://github.com/readest/readest), an open-source ebook reader by Bilingify LLC.
The original CONTRIBUTING.md from Readest was used as a reference for this file.
