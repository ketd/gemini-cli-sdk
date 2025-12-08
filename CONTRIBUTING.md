# Contributing to Gemini CLI SDK

Thank you for your interest in contributing to Gemini CLI SDK! This document provides guidelines and instructions for contributing.

## Development Setup

### Prerequisites

- Node.js >= 18.0.0
- pnpm >= 10.0.0
- Git

### Getting Started

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/yourusername/gemini-cli-sdk.git
   cd gemini-cli-sdk
   ```

3. Install dependencies:
   ```bash
   pnpm install
   ```

4. Create a branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```

## Development Workflow

### Building

```bash
# Build once
pnpm build

# Watch mode
pnpm dev
```

### Testing

```bash
# Run tests
pnpm test

# Watch mode
pnpm test:watch

# Coverage
pnpm test:coverage
```

### Linting and Formatting

```bash
# Lint
pnpm lint

# Fix lint issues
pnpm lint:fix

# Format code
pnpm format

# Type check
pnpm typecheck
```

## Code Style

- Use TypeScript strict mode
- Follow ESLint and Prettier configurations
- Write meaningful commit messages
- Add tests for new features
- Update documentation

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `test:` - Test changes
- `refactor:` - Code refactoring
- `chore:` - Build/tooling changes

Examples:
```
feat: add timeout support for queries
fix: handle empty API key correctly
docs: update README with new examples
test: add tests for utility functions
```

## Pull Request Process

1. Update documentation if needed
2. Add tests for new features
3. Ensure all tests pass
4. Update CHANGELOG.md
5. Create a pull request with a clear description

## Testing Guidelines

- Write unit tests for all new functions
- Aim for >80% code coverage
- Test edge cases and error conditions
- Use descriptive test names

Example:
```typescript
describe('validateApiKey', () => {
  it('should return true for valid API key', () => {
    expect(validateApiKey('valid-key')).toBe(true);
  });

  it('should return false for empty API key', () => {
    expect(validateApiKey('')).toBe(false);
  });
});
```

## Documentation

- Update README.md for user-facing changes
- Add JSDoc comments for public APIs
- Include code examples
- Update CHANGELOG.md

## Release Process

1. Update version in package.json
2. Update CHANGELOG.md
3. Create a git tag
4. Push tag to trigger release workflow

## Questions?

Feel free to open an issue for questions or discussions.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
