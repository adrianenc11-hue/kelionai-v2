#!/bin/bash
echo "Deploying to Railway..."
git add .
git commit -m "Auto-deploy: 04/16/2026 11:33:04"
git push origin master
echo "Deploy complete!"
