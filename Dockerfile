FROM node:22-alpine

WORKDIR /app

# Install native dependencies for bcrypt compilation on Alpine
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /DATA/AppData/tx-trace

EXPOSE 3400

ENV PORT=3400
ENV NODE_ENV=production
ENV DB_PATH=/DATA/AppData/tx-trace/txTrace.db

CMD ["node", "--experimental-sqlite", "src/app.js"]

