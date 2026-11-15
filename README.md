# ClaudeMom

**Use an API key with the full Claude Desktop experience — Chat, Code, Cowork, voice input, and computer control — without signing in to a Claude account.**

> **English Windows build:** The source on the `english-windows-build` branch uses an English interface and defaults to leaving Claude Desktop's Chinese localization disabled. Download the unsigned Windows installer from the successful [GitHub Actions build](https://github.com/shekharcharles/ClaudeMom/actions/workflows/english-windows.yml) under **Artifacts**. This is a development build, not a signed official release.

![ClaudeMom](docs/images/cover.jpg)

## How it works

Claude Desktop has two traditional modes:

- **Official account login:** Full Chat, Code, Cowork, voice input, and computer-control functionality (subject to account and platform availability).
- **API key / third-party mode:** Uses your API provider but may hide some features.

ClaudeMom provides a local compatibility service that presents a signed-in-style session to Claude Desktop and routes model traffic to the configured **Base URL + API key**. It does not modify the official application or overwrite your official account credentials. A locally trusted certificate is used to handle requests; you can revoke trust later.

**Important:** This is an independent project. Availability of features is not guaranteed, and using third-party endpoints with Claude may have privacy, security, terms-of-service or compatibility implications. Only use API providers and features for which you are authorized.

## Features

- Full-feature-style Claude Desktop access: Chat, Code, Cowork (subject to local capability checks)
- Multiple Anthropic-compatible API providers; fetch model lists and switch profiles
- Import Claude providers from cc-switch, Magpie, and Codex++
- English ClaudeMom user interface
- Optional local offline speech dictation with SenseVoice
- Optional sharing of `~/.claude` sessions with the Code tab
- Session synchronization and advanced controls
- Windows NSIS installer builds through GitHub Actions

![ClaudeMom main window](docs/images/claudemom.png)

## Windows setup

1. Install the official **Claude Desktop** application and **Node.js 22 or later**.
2. Download the `.exe` installer from the latest successful [English Windows build](https://github.com/shekharcharles/ClaudeMom/actions/workflows/english-windows.yml). Select the run, then download **ClaudeMom-English-Windows-x64** under **Artifacts**.
3. Run the installer. Windows may display an unrecognized-publisher warning because the development installer is unsigned. Review the source and confirm the artifact before proceeding.
4. Open ClaudeMom. Follow prompts to prepare and trust the **local** certificate.
5. Add a provider with an Anthropic-compatible Base URL and key, then choose a model.
6. Select **Launch Claude**.

### Building the executable yourself

On Windows with a supported Rust toolchain, Node.js 22+, and the usual [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/):

```powershell
git clone https://github.com/shekharcharles/ClaudeMom.git
cd ClaudeMom
git checkout english-windows-build
cd apps/claude-mom
npm ci
npm run check
npm run tauri -- build --bundles nsis --config windows-build.conf.json
```

The installer will be generated at `target/release/bundle/nsis/ClaudeMom_<version>_x64-setup.exe` relative to the repository root.

### Notes about updates and language

The original project ships a Chinese localization catalog for Claude Desktop. New installations of this English branch default to **Chinese interface translation off** under **Claude settings**. Existing installations may retain their previous setting; turn it off manually if needed. The app's updater remains configured to the original upstream releases; installing an upstream update can overwrite the English build.

## Project structure

| Directory | Purpose |
|---|---|
| `apps/claude-mom` | Tauri + React desktop application |
| `crates/claude-local` | Local compatibility service, profiles, certificates, process control, and dictation |
| `crates/claude-local/runtime` | Node.js runtime and protocol handlers |
| `.github/workflows/english-windows.yml` | Windows executable build and downloadable artifact |

## Development and testing

```bash
cd apps/claude-mom
npm ci
npm run check
npm test

# From the repository root:
cargo test --workspace
```

## License

AGPL-3.0-only. Retain license and attribution when distributing modified builds.
