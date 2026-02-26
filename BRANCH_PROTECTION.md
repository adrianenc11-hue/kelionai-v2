# Branch Protection Setup

## How to protect the `master` branch

1. Go to: https://github.com/adrianenc11-hue/kelionai-v2/settings/branches
2. Click "Add branch protection rule"
3. Branch name pattern: `master`
4. Enable:
   - ✅ Require a pull request before merging
   - ✅ Require status checks to pass before merging
     - Add "test" as required status check (after first workflow run)
   - ✅ Require branches to be up to date before merging
5. Click "Create"

This ensures:
- Nobody can push directly to master
- All changes must go through a PR
- Tests must pass before merging
- Railway only deploys tested code
