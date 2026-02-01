FROM node:20
WORKDIR /app
COPY package*.json ./
RUN npm install

# לא צריך ts-node גלובלי – נשתמש ב-tsx שכבר מותקן בפרויקט
COPY . .
EXPOSE 3001
CMD echo "Starting Signal Server..." && npx tsx server/index.ts