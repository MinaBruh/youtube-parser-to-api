FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY services ./services
COPY tools ./tools

RUN npm ci
RUN npm run build --workspace @ytpa/shared && npm run build --workspace @ytpa/media

ENV NODE_ENV=production
EXPOSE 3001

CMD ["npm", "run", "start", "--workspace", "@ytpa/media"]
