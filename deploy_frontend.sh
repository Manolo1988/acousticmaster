#!/bin/bash

# 定义关键目录路径
TARGET_DIR="./docker/nginx/html"
SOURCE_DIR="./frontend/dist"

# ====================== 第一步：安全检查 ======================
# 检查源目录是否存在
if [ ! -d "$SOURCE_DIR" ]; then
    echo "❌ 错误：源目录 $SOURCE_DIR 不存在，请检查路径是否正确！"
    exit 1
fi

# 检查目标目录是否存在
if [ ! -d "$TARGET_DIR" ]; then
    echo "❌ 错误：目标目录 $TARGET_DIR 不存在，请检查路径是否正确！"
    exit 1
fi

# ====================== 第二步：清空目标目录 ======================
echo "🔄 正在清空目标目录：$TARGET_DIR"
# 使用 rm -rf 删除目标目录下所有文件/文件夹（* 会匹配所有，.开头的隐藏文件也包含）
# 添加 || 处理删除失败的情况
rm -rf "$TARGET_DIR"/* || {
    echo "❌ 错误：清空目标目录失败！"
    exit 1
}

# ====================== 第三步：复制文件 ======================
echo "📤 正在复制源目录 $SOURCE_DIR 下的文件到 $TARGET_DIR..."
# -r：递归复制（处理子目录），-p：保留文件权限/时间，-v：显示复制详情（可选）
cp -rp "$SOURCE_DIR"/* "$TARGET_DIR"/ || {
    echo "❌ 错误：复制文件失败！"
    exit 1
}

# ====================== 第四步：验证结果 ======================
# 检查目标目录是否有文件（简单验证）
FILE_COUNT=$(ls -A "$TARGET_DIR" | wc -l)
if [ "$FILE_COUNT" -gt 0 ]; then
    echo "✅ 成功！文件已复制到 $TARGET_DIR，共 $FILE_COUNT 个文件/目录"
else
    echo "⚠️ 警告：文件复制完成，但目标目录为空！请检查源目录是否有文件。"
fi

exit 0