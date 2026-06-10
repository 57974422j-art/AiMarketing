#!/bin/bash
# AiMarketing 数据库自动备份脚本
# 每天凌晨1点执行，保留最近7天的备份

DB_PATH="/root/AiMarketing/prisma/dev.db"
BACKUP_DIR="/root/AiMarketing/prisma/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
KEEP_DAYS=7

# 创建备份目录
mkdir -p "$BACKUP_DIR"

# 备份文件名
BACKUP_FILE="$BACKUP_DIR/dev.db_$TIMESTAMP.backup"

# 复制数据库（SQLite 需要先关闭写入锁）
cp "$DB_PATH" "$BACKUP_FILE"

# 压缩备份
gzip "$BACKUP_FILE"

# 清理超过保留天数的旧备份
find "$BACKUP_DIR" -name "dev.db_*.backup.gz" -mtime +$KEEP_DAYS -delete

# 输出日志
echo "[$(date)] 备份完成: $(ls -lh "$BACKUP_FILE.gz" | awk '{print $5}')"
echo "[$(date)] 保留备份数: $(ls -1 "$BACKUP_DIR"/dev.db_*.backup.gz 2>/dev/null | wc -l)"
