# משתמשים בגרסת node אחידה
FROM node:20

# יוצרים תיקייה לפרויקט בתוך הדוקר
WORKDIR /app

# מעתיקים את רשימת הספריות
COPY package*.json ./

# מתקינים את הספריות
RUN npm install

RUN npm install -g typescript

# מעתיקים את כל שאר הקבצים מהמחשב שלך לדוקר
COPY . .


CMD ["npx", "tsc", "--noEmit"]