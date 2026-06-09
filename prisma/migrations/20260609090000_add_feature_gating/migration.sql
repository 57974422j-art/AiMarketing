-- CreateDate: 2026-06-09 09:00:00
-- 功能付费开关 + 文案按天配额 + 系统配置表

-- 1. User 表新增字段
ALTER TABLE "User" ADD COLUMN "paidFeatures" TEXT;
ALTER TABLE "User" ADD COLUMN "videoEditCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "copyUsedToday" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "copyLastResetDate" TEXT;

-- 2. 新增系统配置表
CREATE TABLE "SystemConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "key" TEXT NOT NULL UNIQUE,
    "value" TEXT NOT NULL,
    "label" TEXT,
    "description" TEXT,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
