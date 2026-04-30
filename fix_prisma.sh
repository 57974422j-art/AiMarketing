#!/bin/bash
for file in $(find src/app/api -name "route.ts"); do
  count=$(grep -c "^const prisma = new PrismaClient" "$file" 2>/dev/null || echo "0")
  if [ "$count" -gt 1 ]; then
    awk '/^const prisma = new PrismaClient/ && !seen { seen=1; print; next } /^const prisma/ { next } 1' "$file" > tmp && mv tmp "$file"
  fi
  if grep -q "import prisma from" "$file"; then
    sed -i "/import prisma from/d" "$file"
  fi
done
echo "Fix complete"
