---
description: Deploy changes to Railway via GitHub
---
// turbo-all

1. Stage all changes: `git add -A`
2. Commit with message: `git commit -m "<message>"`
3. Push to branch: `git push origin <branch>`
4. Create PR: `gh pr create --title "<title>" --body "<body>" --base master --head <branch>`
5. Merge PR: `gh pr merge --merge`
6. Verify deployment: `railway logs -n 5`
