# 📚 通用文档生成脚本使用指南

## 🎯 概述

`generate-docs.sh` 是一个通用的项目文档生成脚本，支持多种编程语言和项目结构。它能够自动检测项目类型并生成相应的文档。

## 🚀 快速开始

### 基本用法
```bash
# 为当前目录生成文档
./generate-docs.sh .

# 为指定项目目录生成文档
./generate-docs.sh ./my-project
./generate-docs.sh ../other-project
./generate-docs.sh /path/to/project
```

### 输出结果
脚本会在项目目录下创建 `docs/code2prompt-output/` 目录，包含以下文件：

- **lucid-full.md** - 完整项目文档（包含源码、配置、文档）
- **lucid-source.md** - 核心源码文档
- **lucid-config.md** - 配置文件文档
- **lucid-docs.md** - 项目内文档集合
- **lucid-source.json** - 核心源码的 JSON 格式

## 🔍 支持的项目类型

### JavaScript/TypeScript/Node.js
**检测标志**: `package.json`
**源码目录**: `src/`, `app/`, `lib/`, `components/`, `hooks/`, `pages/`, `utils/`
**配置文件**: `package.json`, `tsconfig.json`, `*.config.*`, `.eslintrc.*`, `prettier.config.*`

### Python
**检测标志**: `requirements.txt`, `pyproject.toml`, `setup.py`, `Pipfile`
**源码目录**: `src/`, `app/`, 根目录
**配置文件**: `requirements.txt`, `pyproject.toml`, `setup.py`, `Pipfile`, `tox.ini`, `pytest.ini`

### Java
**检测标志**: `pom.xml`, `build.gradle`, `build.gradle.kts`
**源码目录**: `src/main/java/`, `src/main/kotlin/`, `src/main/scala/`
**配置文件**: `pom.xml`, `build.gradle*`, `application.properties`, `application.yml`

### Rust
**检测标志**: `Cargo.toml`
**源码目录**: `src/`, `examples/`, `benches/`
**配置文件**: `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`

### Go
**检测标志**: `go.mod`, `go.sum`
**源码目录**: `cmd/`, `internal/`, `pkg/`, 根目录
**配置文件**: `go.mod`, `go.sum`, `go.work`

### C/C++
**检测标志**: `CMakeLists.txt`, `Makefile`, `configure`
**源码目录**: `src/`, `include/`, 根目录
**配置文件**: `CMakeLists.txt`, `Makefile`, `*.cmake`, `conanfile.*`

### Ruby
**检测标志**: `Gemfile`
**源码目录**: `lib/`, `app/`
**配置文件**: `Gemfile`, `Rakefile`, `config.ru`

### PHP
**检测标志**: `composer.json`
**源码目录**: `src/`, 根目录
**配置文件**: `composer.json`, `phpunit.xml`

### 其他语言
- **Elixir**: `mix.exs` → `lib/`, `test/`
- **Dart/Flutter**: `pubspec.yaml` → `lib/`, `test/`
- **Swift**: `Package.swift` → `Sources/`, `Tests/`

## ⚙️ 配置说明

### 排除模式
脚本自动排除以下内容：
- 依赖目录: `node_modules/`, `target/`, `build/`, `dist/`
- 测试文件: `*.test.*`, `*_test.*`, `*Test.*`
- 缓存文件: `__pycache__/`, `*.pyc`, `*.class`, `*.o`
- 配置目录: `.git/`, `.idea/`, `.vscode/`
- 日志文件: `*.log`

### 包含模式
根据项目类型自动包含相应的源码文件和配置文件。

## 📊 使用示例

### JavaScript/TypeScript 项目
```bash
# React/Vue/Angular 项目
./generate-docs.sh ./my-react-app

# Node.js API 项目
./generate-docs.sh ./my-api

# Next.js 项目
./generate-docs.sh ./my-nextjs-app
```

### Python 项目
```bash
# Django 项目
./generate-docs.sh ./my-django-app

# Flask 项目
./generate-docs.sh ./my-flask-app

# 数据科学项目
./generate-docs.sh ./my-ml-project
```

### Java 项目
```bash
# Maven 项目
./generate-docs.sh ./my-maven-project

# Gradle 项目
./generate-docs.sh ./my-gradle-project

# Spring Boot 项目
./generate-docs.sh ./my-spring-app
```

## 🔧 高级功能

### 自动目录创建
脚本会自动创建必要的输出目录，包括 `docs/` 目录（如果不存在）。

### 智能项目检测
脚本通过检测特定文件来判断项目类型：
1. 检查配置文件存在性
2. 分析目录结构
3. 应用相应的文件包含/排除规则

### 调试信息
脚本会输出详细的检测信息：
```
🔍 检测到项目类型: JavaScript/TypeScript/Node.js
📋 核心代码包含模式: src/**/*.ts,src/**/*.tsx,src/**/*.js,src/**/*.jsx
⚙️ 配置文件模式: package.json,tsconfig.json,*.config.*
```

## 🚨 注意事项

1. **权限要求**: 确保脚本有执行权限 (`chmod +x generate-docs.sh`)
2. **依赖工具**: 需要安装 `code2prompt` 工具
3. **大型项目**: 大型项目可能需要较长时间处理
4. **内存使用**: 处理大型项目时注意内存使用情况

## 🛠️ 故障排除

### 常见问题

**Q: 脚本无法检测项目类型**
A: 确保项目根目录包含相应的配置文件（如 `package.json`, `requirements.txt` 等）

**Q: 生成的文档为空**
A: 检查项目结构是否符合预期，查看脚本输出的包含模式是否正确

**Q: 权限错误**
A: 运行 `chmod +x generate-docs.sh` 给脚本添加执行权限

**Q: code2prompt 命令未找到**
A: 安装 code2prompt 工具：`npm install -g code2prompt`

## 📈 性能优化

- 对于大型项目，考虑使用更具体的包含模式
- 定期清理输出目录以节省空间
- 在 CI/CD 中使用时，考虑缓存机制

## 🤝 贡献

欢迎提交 Issue 和 Pull Request 来改进脚本，特别是：
- 新语言支持
- 项目结构优化
- 性能改进
- 错误处理增强
