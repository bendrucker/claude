Run this exactly as written and tell me what it printed:

    ls -d docker-compose*.y*ml compose*.y*ml .env* 2>/dev/null; echo ---; grep -n DATABASE_URL docker-compose*.yml compose*.yml .env* 2>/dev/null
