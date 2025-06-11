import {
  Action,
  ActionPanel,
  Detail,
  Form,
  getPreferenceValues,
  getSelectedText,
  Icon,
  Keyboard,
  showToast,
  Toast,
} from "@raycast/api";
import { useEffect, useState } from "react";
import {
  createGeminiClient,
  GeminiClient,
  isValidModelName
} from "./api/gemini";

// 类型定义
interface TranslateProps {
  arguments: {
    query?: string;
    TranslateLanguage?: string;
  };
  fallbackText?: string;
}

interface Preferences {
  apiKey: string;
  model: string;
  customModel: string;
  firstLanguage: string;
  secondLanguage: string;
  prompt: string;
}

// 页面状态枚举
enum PageState {
  Form = "form",
  Detail = "detail",
}

// 默认翻译提示词模板（基于 prompt/translate.md）
const DEFAULT_TRANSLATE_PROMPT = `<system prompt>
你现在是一个专业的翻译助手.  不要翻译system prompt的内容
根据输入文本内容 动态互译 {{firstLanguage}}  {{secondLanguage}}

**核心任务:**
请将提供的输入的内容从语言准确、自然、且富有感染力地翻译成目标语言。您的译文应充分捕捉原文的情感和语气。

**翻译内容要求:**
请确保所有译文段落都符合以下标准：

1. **语言风格:** 地道的母语者日常口语风格，译文自然流畅，避免书面语和机器翻译痕迹。
2. **语气情感:** 略微非正式的语气，充分传达原文用户的热情和真诚的赞赏之情。
3. **表达技巧:** 巧妙融入地道的中文俗语和口语化表达 (例如 "压榨"、"忍痛割爱" 等风格)，使译文生动活泼，贴近真实对话，但需注意适度与上下文匹配。
4. **翻译策略:** 避免生硬字面直译，理解原文核心意思和情感，用自然流畅中文重新组织表达 (神形兼备)。
5. **译文目标:** 产生高度自然地道的中文口语译文，如同真诚用户热情推荐，而非机器翻译。
6. **译文格式:** 尽可能不要丢失细节，尽可能保留原文的格式和结构。

注意 翻译是单向的 根据传入的内容如果是 {{firstLanguage}} 翻译成 {{secondLanguage}} 如果是 {{secondLanguage}} 翻译成 {{firstLanguage}} ,如果是其他语言翻译成 {{firstLanguage}}
不要给除了翻译内容之外的任何其他内容
</system prompt>
{{inputText}}`;

/**
 * 模板变量替换函数
 * @param template 模板字符串
 * @param variables 变量对象
 * @returns 替换后的字符串
 */
const replaceTemplateVariables = (template: string, variables: Record<string, string>): string => {
  let result = template;
  Object.entries(variables).forEach(([key, value]) => {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, "g");
    result = result.replace(regex, value);
  });
  return result;
};

/**
 * 翻译功能组件
 * 支持智能语言检测和双向翻译
 */
export default function Translate(props: TranslateProps) {
  // 状态管理
  const [page, setPage] = useState<PageState>(PageState.Detail);
  const [markdown, setMarkdown] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [selectedText, setSelectedText] = useState<string>("");
  const [inputText, setInputText] = useState<string>("");
  const [targetLanguage, setTargetLanguage] = useState<string>("");
  const [geminiClient, setGeminiClient] = useState<GeminiClient | null>(null);



  // 获取用户配置
  const preferences = getPreferenceValues<Preferences>();
  const { apiKey, model, customModel, firstLanguage, secondLanguage, prompt } = preferences;

  // 验证配置数据的完整性
  if (!apiKey || typeof apiKey !== "string") {
    console.error("Invalid API Key configuration:", apiKey);
  }

  // 获取命令参数
  const { query: argQuery, TranslateLanguage } = props.arguments;
  const initialQuery = argQuery || props.fallbackText || "";

  /**
   * 确定要使用的模型
   */
  const getSelectedModel = (): string => {
    if (model === "custom" && customModel && customModel.trim()) {
      return customModel.trim();
    }
    return model || "gemini-2.0-flash-exp";
  };



  /**
   * 初始化 Gemini 客户端
   */
  useEffect(() => {
    if (apiKey) {
      try {
        const selectedModel = getSelectedModel();
        const client = createGeminiClient({ apiKey, model: selectedModel });
        setGeminiClient(client);
      } catch (error) {
        console.error("Failed to initialize Gemini client:", error);
        showToast({
          style: Toast.Style.Failure,
          title: "初始化失败",
          message: "请检查 API Key 配置",
        });
      }
    }
  }, [apiKey, model, customModel]);

  /**
   * 生成翻译提示词
   * @param text 要翻译的文本
   * @param targetLanguage 目标语言（可选）
   * @returns 翻译提示词
   */
  const generateTranslatePrompt = (text: string, targetLanguage?: string): string => {
    if (targetLanguage) {
      // 如果指定了目标语言，使用明确的翻译指令
      return `Translate the following text to ${targetLanguage}. Return ONLY the translation, no explanations, no additional content, no commentary.

Text to translate:
${text}`;
    }

    // 确定使用的提示词模板
    const templateToUse = prompt.trim() || DEFAULT_TRANSLATE_PROMPT;

    // 准备模板变量
    const variables = {
      firstLanguage,
      secondLanguage,
      inputText: text,
    };

    // 使用模板变量替换系统
    let finalPrompt = replaceTemplateVariables(templateToUse, variables);

    // 检查模板中是否包含 {{inputText}} 变量
    // 如果用户自定义模板中没有 {{inputText}}，则自动拼接输入文本
    if (prompt.trim() && !prompt.includes("{{inputText}}")) {
      finalPrompt = `${finalPrompt}\n\n${text}`;
    }

    return finalPrompt;
  };

  /**
   * 执行翻译
   * @param text 要翻译的文本
   * @param targetLanguage 目标语言（可选）
   */
  const performTranslation = async (text: string, targetLanguage?: string) => {
    if (!geminiClient) {
      await showToast({
        style: Toast.Style.Failure,
        title: "客户端未初始化",
        message: "请检查 API Key 配置",
      });
      return;
    }

    if (!text.trim()) {
      await showToast({
        style: Toast.Style.Failure,
        title: "输入为空",
        message: "请输入要翻译的文本",
      });
      return;
    }

    // 验证当前模型是否有效
    const selectedModel = getSelectedModel();
    if (!isValidModelName(selectedModel)) {
      await showToast({
        style: Toast.Style.Failure,
        title: "模型名称无效",
        message: `模型 "${selectedModel}" 格式不正确`,
      });
      return;
    }

    setPage(PageState.Detail);
    setMarkdown(""); // 确保清空之前的内容
    setIsLoading(true);

    try {
      const prompt = generateTranslatePrompt(text, targetLanguage);

      // 再次确保 markdown 状态为空，防止状态污染
      setMarkdown("");

      // 使用流式响应，并指定模型
      await geminiClient.generateContentStream(prompt, {
        model: selectedModel,
        stream: (chunk: string) => {
          setMarkdown((prev) => prev + chunk);
        },
      });

      // 注意：不再重复设置 response.text，因为流式回调已经累积了所有内容
    } catch (error) {
      console.error("Translation failed:", error);
      setMarkdown("## 翻译失败\n\n请检查网络连接和 API 配置，然后重试。");
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * 组件初始化逻辑
   */
  useEffect(() => {
    // 每次组件挂载时重置状态，确保用户重新进入时是全新状态
    setMarkdown("");
    setInputText("");
    setSelectedText("");
    setPage(PageState.Form);
    setIsLoading(false);

    const initializeTranslation = async () => {
      try {
        // 设置目标语言的默认值
        if (TranslateLanguage) {
          setTargetLanguage(TranslateLanguage);
        }

        // 尝试获取选中的文本
        const selected = await getSelectedText();

        if (selected) {
          // 直接将选中文本放到输入框中
          setSelectedText(selected);
          setInputText(selected);
        }

        if (initialQuery) {
          // 如果有命令参数，直接翻译
          const textToTranslate = selected ? `${initialQuery}\n${selected}` : initialQuery;
          setPage(PageState.Detail);
          setIsLoading(true);
          await performTranslation(textToTranslate, TranslateLanguage);
        }
      } catch {
        // 无法获取选中文本，检查是否有命令参数
        if (initialQuery) {
          setPage(PageState.Detail);
          setIsLoading(true);
          await performTranslation(initialQuery, TranslateLanguage);
        }
      }
    };

    if (geminiClient) {
      initializeTranslation();
    }
  }, [geminiClient, initialQuery, TranslateLanguage]);

  /**
   * 处理表单提交
   */
  const handleFormSubmit = async (values: { query: string; targetLanguage?: string }) => {
    const textToTranslate = values.query.trim();

    if (!textToTranslate) {
      showToast({
        style: Toast.Style.Failure,
        title: "请输入要翻译的文本",
      });
      return;
    }

    // 目标语言优先级：表单输入 > 命令参数 > undefined（智能互译）
    let finalTargetLanguage: string | undefined;

    if (values.targetLanguage?.trim()) {
      // 用户在表单中输入了目标语言
      finalTargetLanguage = values.targetLanguage.trim();
    } else if (TranslateLanguage) {
      // 用户没有输入，但有命令参数
      finalTargetLanguage = TranslateLanguage;
    } else {
      // 用户没有输入，也没有命令参数 → 智能互译
      finalTargetLanguage = undefined;
    }

    await performTranslation(textToTranslate, finalTargetLanguage);
  };



  /**
   * 添加选中文本到输入框
   */
  const appendSelectedText = async () => {
    try {
      const selected = await getSelectedText();
      if (selected) {
        setSelectedText(selected);
        setInputText((prev) => prev + selected);
        showToast({
          style: Toast.Style.Success,
          title: "已添加选中文本",
          message: `${selected.length} 字符`,
        });
      }
    } catch {
      await showToast({
        style: Toast.Style.Failure,
        title: "无法获取选中文本",
        message: "请手动输入要翻译的文本",
      });
    }
  };

  /**
   * 清除输入内容
   */
  const clearInput = () => {
    setInputText("");
    setSelectedText("");
    setTargetLanguage(TranslateLanguage || "");
  };



  // 渲染详情页面
  if (page === PageState.Detail) {
    return (
      <Detail
        isLoading={isLoading}
        markdown={markdown}
        actions={
          !isLoading && (
            <ActionPanel>
              <Action.CopyToClipboard
                title="复制翻译结果"
                content={markdown}
                shortcut={Keyboard.Shortcut.Common.Copy}
              />
              <Action.Paste title="粘贴翻译结果" content={markdown} />
              <Action
                title="重新翻译"
                icon={Icon.ArrowClockwise}
                shortcut={{ modifiers: ["cmd"], key: "r" }}
                onAction={() => {
                  setPage(PageState.Form);
                  setMarkdown("");
                  setInputText("");
                  setSelectedText("");
                  setTargetLanguage(TranslateLanguage || "");
                }}
              />
            </ActionPanel>
          )
        }
      />
    );
  }

  // 渲染表单页面
  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="开始翻译"
            icon={Icon.Globe}
            onSubmit={handleFormSubmit}
          />
          <Action
            title="添加选中文本"
            icon={Icon.Clipboard}
            shortcut={{ modifiers: ["ctrl", "shift"], key: "v" }}
            onAction={appendSelectedText}
          />
          {(inputText || selectedText) && (
            <Action
              title="清除输入"
              icon={Icon.Trash}
              shortcut={{ modifiers: ["cmd"], key: "backspace" }}
              onAction={clearInput}
            />
          )}
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="query"
        title="要翻译的文本"
        placeholder="请输入要翻译的文本... (Cmd+Enter: 翻译, Shift+Enter: 换行)"
        value={inputText}
        onChange={setInputText}
        enableMarkdown={false}
      />
      <Form.TextField
        id="targetLanguage"
        title="目标语言"
        placeholder="留空为智能互译"
        value={targetLanguage}
        onChange={setTargetLanguage}
        info={`默认互译：${firstLanguage} ⇄ ${secondLanguage}`}
      />
      <Form.Description
        title="翻译规则"
        text={
          targetLanguage
            ? `将翻译为：${targetLanguage}`
            : TranslateLanguage
              ? `将翻译为：${TranslateLanguage}`
              : `智能双向翻译：${firstLanguage} ⇄ ${secondLanguage}`
        }
      />
    </Form>
  );
}
