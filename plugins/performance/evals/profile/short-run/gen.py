import random
import sys

random.seed(7)
words = ["if", "else", "for", "while", "return", "struct", "static", "const", "int", "char",
         "void", "size_t", "count", "value", "buffer", "next", "node", "list", "index", "total"]
lines = [" ".join(random.choice(words) + random.choice(["", "(", ")", ";", ",", "."])
                  for _ in range(random.randint(4, 14))) for _ in range(3000)]
sys.stdout.write("\n".join(lines) + "\n")
