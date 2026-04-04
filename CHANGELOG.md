# Changelog

All notable changes to this project should be documented in this file.

The format is based on Keep a Changelog and the project uses Semantic Versioning.

## [Unreleased]

### Added
- 

### Changed
- Updated GitHub Actions workflows to newer action versions and GitHub CLI-based release creation to avoid Node 20 deprecation warnings.

### Fixed
- 

## [0.1.0] - 2026-04-04

### Added
- Initial release of `pi-llm-wiki`
- README now explicitly credits Andrej Karpathy’s LLM Wiki gist as the inspiration for this implementation
- Pi extension with wiki bootstrap, source capture, search, page resolution, lint, status, event logging, and metadata rebuild tools
- Bundled `llm-wiki` skill
- Immutable raw-source capture packets
- Generated registry, backlinks, index, log, and lint report workflows
- Guardrails that protect raw and generated metadata paths
