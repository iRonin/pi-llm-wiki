# Releasing pi-llm-wiki

This project uses:

- Semantic Versioning
- `CHANGELOG.md` with an `Unreleased` section
- local release scripts
- GitHub Actions for CI and tagged publish

## First-time setup

### 1) Make sure the npm package name is still available

```bash
npm view pi-llm-wiki version
```

If it returns a version, the package already exists on npm.

### 2) Log in to npm locally

```bash
npm login
```

### 3) Create an npm token

On npmjs.com:
- open **Account Settings**
- open **Access Tokens**
- create a token with publish access for `pi-llm-wiki`

### 4) Add the npm token to GitHub

```bash
gh secret set NPM_TOKEN --repo Kausik-A/pi-llm-wiki
```

## First publish options

### Option A — manual first publish

```bash
npm run check
npm publish --access public
```

### Option B — tag-driven first publish

Once `NPM_TOKEN` is set, create and push a release tag using the normal flow.

## Normal release flow

### 1) Update the changelog

Add notes under:

```md
## [Unreleased]
```

Suggested buckets:
- `Added`
- `Changed`
- `Fixed`

### 2) Cut a release locally

```bash
npm run release:patch
# or
npm run release:minor
# or
npm run release:major
```

This will:
- verify the working tree is clean
- verify you are on `main`
- run checks
- bump `package.json`
- move `Unreleased` notes into a dated release section
- create a release commit
- create a tag like `v0.1.1`

### 3) Push the release

```bash
npm run release:push
```

This pushes:
- `main`
- all local tags

### 4) GitHub Actions completes the publish

The `release.yml` workflow will:
- install dependencies
- run checks
- publish to npm
- create a GitHub Release

## Troubleshooting

### npm publish fails with auth error
Make sure:
- `npm login` works locally
- `NPM_TOKEN` is set in GitHub secrets
- the token has publish permission

### release script says working tree is not clean
Commit or stash all changes first.

### release script says you are not on main
Switch branches:

```bash
git checkout main
```

## Current package

- npm name: `pi-llm-wiki`
- repo: `Kausik-A/pi-llm-wiki`
