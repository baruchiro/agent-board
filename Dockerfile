FROM oven/bun:1-alpine

WORKDIR /app
COPY package.json ./
COPY src ./src

RUN mkdir -p /data
ENV DB_PATH=/data/agent-board.sqlite
ENV PORT=4100
EXPOSE 4100

CMD ["bun", "run", "src/index.ts"]
