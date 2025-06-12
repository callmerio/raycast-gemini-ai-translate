#!/bin/bash

# 如果任何命令失败，立即退出脚本
set -e
set -o pipefail

# 检查参数
if [ $# -eq 0 ]; then
    echo "❌ 错误: 请提供项目路径参数"
    echo "用法: $0 <项目相对路径>"
    echo "示例: $0 ./my-project"
    echo "示例: $0 ../other-project"
    exit 1
fi

# 获取项目路径参数
PROJECT_PATH="$1"

# 检查项目路径是否存在
if [ ! -d "$PROJECT_PATH" ]; then
    echo "❌ 错误: 项目路径不存在: $PROJECT_PATH"
    exit 1
fi

echo "🚀 开始生成项目文档..."
echo "📁 项目路径: $PROJECT_PATH"

# --- 配置 ---
OUTPUT_DIR="$PROJECT_PATH/docs/code2prompt-output"

# 通用排除项 - 支持多种语言和框架
COMMON_EXCLUDE="node_modules/**,dist/**,build/**,target/**,.next/**,docs-output/**,.wxt/**,*.log,pnpm-lock.yaml,yarn.lock,package-lock.json,**/*.spec.ts,**/*.test.ts,**/*.spec.js,**/*.test.js,**/*_test.py,**/*_test.go,**/*Test.java,**/*test.c,**/*test.cpp,public/**,coverage/**,__pycache__/**,*.pyc,*.pyo,*.class,*.o,*.so,*.dll,*.exe,.pytest_cache/**,.coverage,htmlcov/**,.tox/**,venv/**,env/**,.env/**,*.egg-info/**,.gradle/**,.idea/**,.vscode/**,.DS_Store,Thumbs.db"

# 检测项目类型和结构
detect_project_type() {
    local project_path="$1"
    local project_type=""
    local core_include=""
    local config_include=""

    # 检测文件存在性来判断项目类型
    if [ -f "$project_path/package.json" ]; then
        project_type="JavaScript/TypeScript/Node.js"
        if [ -d "$project_path/src" ]; then
            core_include="src/**/*.ts,src/**/*.tsx,src/**/*.js,src/**/*.jsx,src/**/*.mjs,src/**/*.cjs"
        elif [ -d "$project_path/app" ]; then
            core_include="app/**/*.ts,app/**/*.tsx,app/**/*.js,app/**/*.jsx,lib/**/*.ts,components/**/*.tsx,hooks/**/*.ts,pages/**/*.tsx,utils/**/*.ts"
        else
            core_include="**/*.ts,**/*.tsx,**/*.js,**/*.jsx,**/*.mjs,**/*.cjs"
        fi
        config_include="package.json,tsconfig.json,*.config.ts,*.config.js,*.config.mjs,eslint.config.js,raycast-env.d.ts,.eslintrc.*,prettier.config.*,vite.config.*,webpack.config.*,next.config.*"

    elif [ -f "$project_path/requirements.txt" ] || [ -f "$project_path/pyproject.toml" ] || [ -f "$project_path/setup.py" ] || [ -f "$project_path/Pipfile" ]; then
        project_type="Python"
        if [ -d "$project_path/src" ]; then
            core_include="src/**/*.py"
        elif [ -d "$project_path/app" ]; then
            core_include="app/**/*.py"
        else
            core_include="**/*.py"
        fi
        config_include="requirements.txt,pyproject.toml,setup.py,setup.cfg,Pipfile,Pipfile.lock,tox.ini,pytest.ini,.flake8,mypy.ini,poetry.lock"

    elif [ -f "$project_path/pom.xml" ] || [ -f "$project_path/build.gradle" ] || [ -f "$project_path/build.gradle.kts" ]; then
        project_type="Java"
        core_include="src/**/*.java,src/**/*.kt,src/**/*.scala"
        config_include="pom.xml,build.gradle,build.gradle.kts,settings.gradle,gradle.properties,application.properties,application.yml,application.yaml"

    elif [ -f "$project_path/Cargo.toml" ]; then
        project_type="Rust"
        core_include="src/**/*.rs,examples/**/*.rs,benches/**/*.rs"
        config_include="Cargo.toml,Cargo.lock,rust-toolchain.toml,.cargo/config.toml"

    elif [ -f "$project_path/go.mod" ] || [ -f "$project_path/go.sum" ]; then
        project_type="Go"
        if [ -d "$project_path/cmd" ]; then
            core_include="cmd/**/*.go,internal/**/*.go,pkg/**/*.go,**/*.go"
        else
            core_include="**/*.go"
        fi
        config_include="go.mod,go.sum,go.work,go.work.sum"

    elif [ -f "$project_path/CMakeLists.txt" ] || [ -f "$project_path/Makefile" ] || [ -f "$project_path/configure" ]; then
        project_type="C/C++"
        if [ -d "$project_path/src" ]; then
            core_include="src/**/*.c,src/**/*.cpp,src/**/*.cc,src/**/*.cxx,src/**/*.h,src/**/*.hpp,src/**/*.hxx"
        elif [ -d "$project_path/include" ]; then
            core_include="include/**/*.h,include/**/*.hpp,**/*.c,**/*.cpp,**/*.cc,**/*.cxx"
        else
            core_include="**/*.c,**/*.cpp,**/*.cc,**/*.cxx,**/*.h,**/*.hpp,**/*.hxx"
        fi
        config_include="CMakeLists.txt,Makefile,configure,configure.ac,configure.in,*.cmake,conanfile.txt,conanfile.py"

    elif [ -f "$project_path/Gemfile" ]; then
        project_type="Ruby"
        if [ -d "$project_path/lib" ]; then
            core_include="lib/**/*.rb,app/**/*.rb"
        else
            core_include="**/*.rb"
        fi
        config_include="Gemfile,Gemfile.lock,Rakefile,config.ru,.ruby-version,.rvmrc"

    elif [ -f "$project_path/composer.json" ]; then
        project_type="PHP"
        if [ -d "$project_path/src" ]; then
            core_include="src/**/*.php"
        else
            core_include="**/*.php"
        fi
        config_include="composer.json,composer.lock,phpunit.xml,phpunit.xml.dist,.php-cs-fixer.php"

    elif [ -f "$project_path/mix.exs" ]; then
        project_type="Elixir"
        core_include="lib/**/*.ex,lib/**/*.exs,test/**/*.exs"
        config_include="mix.exs,mix.lock,config/*.exs"

    elif [ -f "$project_path/pubspec.yaml" ]; then
        project_type="Dart/Flutter"
        core_include="lib/**/*.dart,test/**/*.dart"
        config_include="pubspec.yaml,pubspec.lock,analysis_options.yaml"

    elif [ -f "$project_path/Package.swift" ]; then
        project_type="Swift"
        core_include="Sources/**/*.swift,Tests/**/*.swift"
        config_include="Package.swift,Package.resolved"

    else
        # 通用检测 - 基于目录结构
        project_type="通用项目"
        if [ -d "$project_path/src" ]; then
            core_include="src/**/*"
        elif [ -d "$project_path/lib" ]; then
            core_include="lib/**/*"
        elif [ -d "$project_path/app" ]; then
            core_include="app/**/*"
        else
            core_include="**/*.py,**/*.js,**/*.ts,**/*.java,**/*.cpp,**/*.c,**/*.h,**/*.rs,**/*.go,**/*.rb,**/*.php,**/*.cs,**/*.swift,**/*.kt,**/*.scala"
        fi
        config_include="*.json,*.toml,*.yaml,*.yml,*.xml,*.ini,*.cfg,Makefile,Dockerfile,docker-compose.yml"
    fi

    echo "$project_type|$core_include|$config_include"
}

# 调用检测函数
DETECTION_RESULT=$(detect_project_type "$PROJECT_PATH")
PROJECT_TYPE=$(echo "$DETECTION_RESULT" | cut -d'|' -f1)
CORE_APP_INCLUDE=$(echo "$DETECTION_RESULT" | cut -d'|' -f2)
CONFIG_INCLUDE=$(echo "$DETECTION_RESULT" | cut -d'|' -f3)

echo "🔍 检测到项目类型: $PROJECT_TYPE"
echo "📋 核心代码包含模式: $CORE_APP_INCLUDE"
echo "⚙️ 配置文件模式: $CONFIG_INCLUDE"

# 项目内文档 - 通用文档模式
DOCS_INCLUDE="docs/**/*.md,doc/**/*.md,documentation/**/*.md,README.md,CHANGELOG.md,CONTRIBUTING.md,LICENSE.md,*.md"

# --- 执行 ---

# 创建输出目录（包括 docs 目录）
echo "📁 创建输出目录: $OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

# 处理 .gitignore 文件
GITIGNORE_EXCLUDE=""
if [ -f "$PROJECT_PATH/.gitignore" ]; then
    echo "🔍 发现 .gitignore 文件，解析排除规则..."
    # 读取 .gitignore 并转换为 code2prompt 格式
    GITIGNORE_EXCLUDE=$(grep -v '^#' "$PROJECT_PATH/.gitignore" | grep -v '^$' | sed 's/^/,/' | tr -d '\n' | sed 's/^,//')
    if [ -n "$GITIGNORE_EXCLUDE" ]; then
        COMMON_EXCLUDE="$COMMON_EXCLUDE,$GITIGNORE_EXCLUDE"
        echo "📋 .gitignore 排除规则: $GITIGNORE_EXCLUDE"
    fi
fi

# 动态生成完整项目包含模式
FULL_PROJECT_INCLUDE="$CORE_APP_INCLUDE,*.md,*.txt,*.json,*.yaml,*.yml,*.toml,*.xml,*.ini,*.cfg,*.sh,*.bat,*.ps1,*.d.ts,*.css,*.scss,*.less,*.html"

# 生成包含配置的源码模式（source + config）
SOURCE_WITH_CONFIG_INCLUDE="$CORE_APP_INCLUDE,$CONFIG_INCLUDE"

# 1. 生成完整项目文档 (不含测试和依赖)
echo "📄 1/5: 生成完整项目文档 (lucid-full.md)..."
echo "🔧 使用包含模式: $FULL_PROJECT_INCLUDE"
code2prompt "$PROJECT_PATH" \
  --include="$FULL_PROJECT_INCLUDE" \
  --exclude="$COMMON_EXCLUDE" \
  --output-file="$OUTPUT_DIR/lucid-full.md" \
  --line-numbers \
  --full-directory-tree \
  --tokens=format

# 2. 生成核心源码文档
echo "💻 2/5: 生成核心源码文档 (lucid-source.md)..."
code2prompt "$PROJECT_PATH" \
  --include="$CORE_APP_INCLUDE" \
  --exclude="$COMMON_EXCLUDE" \
  --output-file="$OUTPUT_DIR/lucid-source.md" \
  --line-numbers \
  --tokens=format

# 3. 生成配置文档
echo "⚙️ 3/5: 生成配置文档 (lucid-config.md)..."
code2prompt "$PROJECT_PATH" \
  --include="$CONFIG_INCLUDE" \
  --output-file="$OUTPUT_DIR/lucid-config.md" \
  --line-numbers

# 4. 生成文档集合
echo "📚 4/5: 生成项目内文档集合 (lucid-docs.md)..."
code2prompt "$PROJECT_PATH" \
  --include="$DOCS_INCLUDE" \
  --output-file="$OUTPUT_DIR/lucid-docs.md"

# 5. 生成核心源码的 JSON 格式
echo "🔧 5/5: 生成核心源码 JSON 格式 (lucid-source.json)..."
code2prompt "$PROJECT_PATH" \
  --include="$CORE_APP_INCLUDE" \
  --exclude="$COMMON_EXCLUDE" \
  --output-format=json \
  --output-file="$OUTPUT_DIR/lucid-source.json" \
  --tokens=format

echo "✅ 文档生成完成！输出目录：$OUTPUT_DIR/"
echo "📊 文件列表："
ls -la "$OUTPUT_DIR/"
