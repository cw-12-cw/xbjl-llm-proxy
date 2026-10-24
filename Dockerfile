FROM node:18-alpine
WORKDIR /app
COPY package.json server.js ./
EXPOSE 8000
ENV PORT=8000
CMD ["node", "server.js"]
