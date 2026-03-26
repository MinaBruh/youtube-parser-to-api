FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY services ./services
COPY tools ./tools

RUN npm ci
RUN npm run build --workspace @ytpa/web

ENV NODE_ENV=production
ENV WEB_PORT=4173
ENV API_ORIGIN=http://api:3000
ENV MEDIA_ORIGIN=http://media:3001

EXPOSE 4173

CMD ["npm", "run", "start", "--workspace", "@ytpa/web"]
