FROM node:18-alpine
WORKDIR /opt/application
COPY package.json server.js run.sh ./
RUN chmod +x run.sh
EXPOSE 8000
ENV PORT=8000
