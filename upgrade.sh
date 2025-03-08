pnpm stop-deps
docker system prune -a
git fetch origin
git pull origini dev
pnpm install
pnpm build:packages
pnpm codegen
pnpm start-deps
