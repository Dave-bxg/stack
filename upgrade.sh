#before running this make sure to update the repo on giithub to match stack auth
#also keep an eye that there are no merge conflicts when pulling
pnpm stop-deps
docker system prune -a
git fetch origin
git pull origini dev
pnpm install
pnpm build:packages
pnpm codegen
pnpm start-deps
