FROM node:24-alpine

WORKDIR /app

# Copia dependências e instala
COPY package*.json ./
RUN npm install

# Copia código fonte e arquivos estáticos
COPY . .

# Compila ou roda direto via tsx
EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

CMD ["npm", "start"]
