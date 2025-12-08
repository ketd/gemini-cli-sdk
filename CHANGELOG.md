# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2025-12-08

### Added
- Initial release of Gemini CLI SDK
- Core `query()` function for streaming Gemini CLI events
- High-level `GeminiClient` class with event emitters
- Full TypeScript support with type definitions
- Support for all Gemini CLI features:
  - Streaming responses
  - Tool calling (automatic execution by CLI)
  - Session management
  - Approval modes (default, auto_edit, yolo)
  - Custom working directories
  - Timeout handling
- Utility functions:
  - `findGeminiCLI()` - Auto-discover CLI path
  - `validateApiKey()` - Validate API key
  - `getApiKey()` - Get API key from env or options
  - `validateModel()` - Validate model name
  - `formatDuration()` - Format duration
  - `formatTokens()` - Format token count
- Comprehensive test suite with 18 tests
- Examples for basic usage, streaming, tools, and events
- Full documentation in README.md
- CI/CD with GitHub Actions
- ESLint and Prettier configuration
- TypeScript strict mode

### Documentation
- Complete API reference
- Usage examples
- Configuration guide
- Event types documentation
- Comparison with Claude Code SDK

[Unreleased]: https://github.com/yourusername/gemini-cli-sdk/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/yourusername/gemini-cli-sdk/releases/tag/v0.1.0
