FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p /DATA/AppData/tx-trace

EXPOSE 3400

ENV PORT=3400
ENV NODE_ENV=production
ENV DB_PATH=/DATA/AppData/tx-trace/txTrace.db

CMD ["node", "--experimental-sqlite", "src/app.js"]
