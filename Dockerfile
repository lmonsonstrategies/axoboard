FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json server.mjs ./
COPY wireframes ./wireframes

USER node
EXPOSE 3000

CMD ["node", "server.mjs"]
