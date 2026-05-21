# CountUpTimer

A simple count-up timer app for tracking how long you have gone without a habit, modeled on the Android "I Am Sober" app.

It is designed for sobriety tracking or any other use case where you want to count up from zero, and it runs on Windows and Mac.

## Features

- Count up continuously from a start time
- Styled with vanilla HTML, CSS, and TypeScript
- Built with Tauri for native Windows and Mac support
- Minimal interface for focus and tracking

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/)
- [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
- [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Build the frontend:
   ```bash
   npm run build:frontend
   ```
3. Run the app in development mode:
   ```bash
   npm run tauri -- dev
   ```
