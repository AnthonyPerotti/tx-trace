FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

RUN mkdir -p /DATA/AppData/tx-trace

EXPOSE 3000

ENV NODE_ENV=production
ENV DB_PATH=/DATA/AppData/tx-trace/txTrace.db

CMD ["node", "--experimental-sqlite", "src/app.js"]
