FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY apps/web apps/web
ENV API_INTERNAL_URL=http://api:4000
RUN npm run build -w @accounts/web
ENV NODE_ENV=production
CMD ["npm","start","-w","@accounts/web"]

