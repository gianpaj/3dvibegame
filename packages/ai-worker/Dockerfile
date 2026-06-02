# AI worker for the player app's geometry compilation.
#
# Serves a keyless `POST /compile` (browser-Gemini path) and, when
# GOOGLE_GENERATIVE_AI_API_KEY is set, the full `POST /generate` path.
#
# Build context MUST be the repo root (it's a pnpm workspace). In Coolify set:
#   Build Pack: Dockerfile
#   Dockerfile location: packages/ai-worker/Dockerfile
#   Base directory / context: / (repo root)
#
# Locally: docker build -f packages/ai-worker/Dockerfile -t vibe-ai-worker .
FROM node:24-slim

RUN corepack enable
WORKDIR /app

# Workspace deps (@3dvibegame/ai-planning, @3dvibegame/scene-authority-ts) are
# consumed as TypeScript source via tsx, so copy the monorepo and install it.
COPY . .
RUN pnpm install --frozen-lockfile

WORKDIR /app/packages/ai-worker

ENV AI_WORKER_HOST=0.0.0.0 \
    AI_WORKER_PORT=8787 \
    AI_WORKER_ALLOWED_ORIGIN=*

EXPOSE 8787
CMD ["pnpm", "start"]
