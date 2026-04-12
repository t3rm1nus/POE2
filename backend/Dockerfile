FROM node:20-alpine

WORKDIR /app

# Instalar dependencias del sistema para better-sqlite3
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --only=production

COPY . .

# Crear carpeta de datos si no existe
RUN mkdir -p /app/data

EXPOSE 3001

CMD ["node", "src/index.js"]