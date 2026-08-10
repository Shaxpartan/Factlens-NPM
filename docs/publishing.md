# Publishing

The repository is prepared for the future public package `factlens`, version `1.0.0`. It is not published as part of repository setup.

Release checklist:

1. Confirm `npm view factlens` still reports that the name is available.
2. Confirm `package.json` contains the intended release version.
3. Run `npm ci` and `npm run check`.
4. Review the exact `npm pack --dry-run` file list.
5. Create the protected GitHub environment named `npm`.
6. Configure npm trusted publishing for `Shaxpartan/Factlens-NPM` and `.github/workflows/release.yml`.
7. Run the release workflow from the verified commit.

The workflow uses GitHub OIDC and npm provenance. Do not add a long-lived `NPM_TOKEN` to the repository.
