import { GoogleGenAI } from "@google/genai";
import { showToast, Toast } from "@raycast/api";

// 类型定义
export interface GeminiConfig {
  apiKey: string;
  model?: string;
}

export interface GeminiResponse {
  text: string;
  model: string;
  timestamp: Date;
}

export interface StreamCallback {
  (chunk: string): void;
}

export interface GeminiRequestOptions {
  model?: string;
  stream?: StreamCallback;
  maxRetries?: number;
}

// 模型信息接口
export interface ModelInfo {
  name: string;
  displayName: string;
  description?: string;
  supportedGenerationMethods?: string[];
  version?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
}

// 模型列表响应接口
export interface ModelsResponse {
  models: ModelInfo[];
}

// 模型缓存接口
interface ModelCache {
  models: ModelInfo[];
  timestamp: number;
  ttl: number; // Time to live in milliseconds
}

// 默认配置
const DEFAULT_MODEL = "gemini-2.0-flash-exp";
const DEFAULT_MAX_RETRIES = 3;
const MODEL_CACHE_TTL = 24 * 60 * 60 * 1000; // 24小时缓存
const MODELS_API_ENDPOINT = "https://generativelanguage.googleapis.com/v1/models";

// 静态模型列表（作为回退方案，基于实际可用模型）
const STATIC_MODELS: ModelInfo[] = [
  {
    name: "gemini-2.0-flash-exp",
    displayName: "gemini-2.0-flash-exp",
    description: "最新的 2.0 Flash 实验版本",
    supportedGenerationMethods: ["generateContent", "streamGenerateContent"],
    version: "2.0",
  },
  {
    name: "gemini-2.0-flash-thinking-exp-1219",
    displayName: "gemini-2.0-flash-thinking-exp-1219",
    description: "2.0 思维模型实验版本",
    supportedGenerationMethods: ["generateContent", "streamGenerateContent"],
    version: "2.0",
  },
  {
    name: "gemini-exp-1206",
    displayName: "gemini-exp-1206",
    description: "12月6日实验性模型",
    supportedGenerationMethods: ["generateContent", "streamGenerateContent"],
    version: "experimental",
  },
  {
    name: "gemini-exp-1121",
    displayName: "gemini-exp-1121",
    description: "11月21日实验性模型",
    supportedGenerationMethods: ["generateContent", "streamGenerateContent"],
    version: "experimental",
  },
  {
    name: "gemini-2.5-flash-preview-05-20",
    displayName: "gemini-2.5-flash-preview-05-20",
    description: "2.5 Flash 预览版本",
    supportedGenerationMethods: ["generateContent", "streamGenerateContent"],
    version: "2.5",
  },
  {
    name: "gemini-1.5-pro-002",
    displayName: "gemini-1.5-pro-002",
    description: "1.5 Pro 第二版",
    supportedGenerationMethods: ["generateContent", "streamGenerateContent"],
    version: "1.5",
  },
  {
    name: "gemini-1.5-pro-001",
    displayName: "gemini-1.5-pro-001",
    description: "1.5 Pro 第一版",
    supportedGenerationMethods: ["generateContent", "streamGenerateContent"],
    version: "1.5",
  },
  {
    name: "gemini-1.5-flash-002",
    displayName: "gemini-1.5-flash-002",
    description: "1.5 Flash 第二版",
    supportedGenerationMethods: ["generateContent", "streamGenerateContent"],
    version: "1.5",
  },
  {
    name: "gemini-1.5-flash-001",
    displayName: "gemini-1.5-flash-001",
    description: "1.5 Flash 第一版",
    supportedGenerationMethods: ["generateContent", "streamGenerateContent"],
    version: "1.5",
  },
  {
    name: "gemini-1.5-flash-8b",
    displayName: "gemini-1.5-flash-8b",
    description: "1.5 Flash 8B 参数版本",
    supportedGenerationMethods: ["generateContent", "streamGenerateContent"],
    version: "1.5",
  },
  {
    name: "gemini-1.5-flash-8b-001",
    displayName: "gemini-1.5-flash-8b-001",
    description: "1.5 Flash 8B 第一版",
    supportedGenerationMethods: ["generateContent", "streamGenerateContent"],
    version: "1.5",
  },
  {
    name: "learnlm-1.5-pro-experimental",
    displayName: "learnlm-1.5-pro-experimental",
    description: "学习优化的实验性模型",
    supportedGenerationMethods: ["generateContent", "streamGenerateContent"],
    version: "1.5",
  },
  {
    name: "gemini-1.0-pro",
    displayName: "gemini-1.0-pro",
    description: "1.0 Pro 版本",
    supportedGenerationMethods: ["generateContent", "streamGenerateContent"],
    version: "1.0",
  },
  {
    name: "gemini-1.0-pro-001",
    displayName: "gemini-1.0-pro-001",
    description: "1.0 Pro 第一版",
    supportedGenerationMethods: ["generateContent", "streamGenerateContent"],
    version: "1.0",
  },
  {
    name: "gemini-1.0-pro-vision-latest",
    displayName: "gemini-1.0-pro-vision-latest",
    description: "1.0 Pro 视觉模型最新版",
    supportedGenerationMethods: ["generateContent", "streamGenerateContent"],
    version: "1.0",
  },
];

// 模型缓存存储
let modelCache: ModelCache | null = null;

/**
 * Gemini API 客户端类
 * 提供统一的 API 调用接口，封装官方 SDK 的具体实现
 */
export class GeminiClient {
  private client: GoogleGenAI;
  private defaultModel: string;
  private apiKey: string;

  constructor(config: GeminiConfig) {
    if (!config.apiKey) {
      throw new Error("API Key is required");
    }

    this.apiKey = config.apiKey;
    this.client = new GoogleGenAI({ apiKey: config.apiKey });
    this.defaultModel = config.model || DEFAULT_MODEL;
  }

  /**
   * 发送请求到 Gemini API
   * @param prompt 用户输入的提示词
   * @param options 请求选项
   * @returns Promise<GeminiResponse>
   */
  async generateContent(prompt: string, options: GeminiRequestOptions = {}): Promise<GeminiResponse> {
    const model = options.model || this.defaultModel;
    const maxRetries = options.maxRetries || DEFAULT_MAX_RETRIES;

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const startTime = Date.now();

        // 显示加载提示，包含模型信息
        await showToast({
          style: Toast.Style.Animated,
          title: "正在请求 Gemini...",
          message: `使用模型: ${model} | 尝试 ${attempt}/${maxRetries}`,
        });

        const response = await this.client.models.generateContent({
          model,
          contents: prompt,
        });

        const responseText = response.text || "";
        const duration = Date.now() - startTime;

        // 显示成功提示，包含模型和耗时信息
        await showToast({
          style: Toast.Style.Success,
          title: "翻译完成",
          message: `${model} | ${(duration / 1000).toFixed(1)}s`,
        });

        return {
          text: responseText,
          model,
          timestamp: new Date(),
        };
      } catch (error) {
        lastError = error as Error;
        console.error(`Gemini API 请求失败 (尝试 ${attempt}/${maxRetries}):`, error);

        // 如果不是最后一次尝试，等待后重试
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
          continue;
        }
      }
    }

    // 所有重试都失败了，处理错误
    await this.handleError(lastError!);
    throw lastError;
  }

  /**
   * 处理 API 错误
   * @param error 错误对象
   */
  private async handleError(error: Error): Promise<void> {
    let title = "请求失败";
    let message = error.message;

    // 根据错误类型提供更友好的提示
    if (error.message.includes("429")) {
      title = "请求过于频繁";
      message = "请稍后再试";
    } else if (error.message.includes("401")) {
      title = "API Key 无效";
      message = "请检查 API Key 配置";
    } else if (error.message.includes("quota")) {
      title = "配额已用完";
      message = "请检查 API 配额";
    } else if (error.message.includes("overloaded")) {
      title = "服务器繁忙";
      message = "请稍后重试";
    }

    await showToast({
      style: Toast.Style.Failure,
      title,
      message,
    });
  }

  /**
   * 从 API 获取可用模型列表
   * @returns Promise<ModelInfo[]>
   */
  async listModels(): Promise<ModelInfo[]> {
    try {
      const response = await fetch(`${MODELS_API_ENDPOINT}?key=${this.apiKey}`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as any;

      // 检查响应格式
      if (!data.models || !Array.isArray(data.models)) {
        console.warn("Unexpected API response format:", data);
        return STATIC_MODELS;
      }

      // 转换 API 响应格式为我们的 ModelInfo 格式
      const models: ModelInfo[] = data.models
        .filter((model: any) => {
          // 过滤掉不支持 generateContent 的模型
          return model.supportedGenerationMethods && model.supportedGenerationMethods.includes("generateContent");
        })
        .map((model: any) => {
          const modelName = model.name.replace("models/", ""); // 移除 "models/" 前缀
          return {
            name: modelName,
            displayName: modelName, // 直接使用模型名称，不使用友好名称
            description: model.description || "",
            supportedGenerationMethods: model.supportedGenerationMethods || ["generateContent"],
            version: this.extractVersionFromName(modelName),
            inputTokenLimit: model.inputTokenLimit,
            outputTokenLimit: model.outputTokenLimit,
          };
        });

      console.log(`Successfully fetched ${models.length} models from API`);

      // 更新缓存
      modelCache = {
        models,
        timestamp: Date.now(),
        ttl: MODEL_CACHE_TTL,
      };

      return models;
    } catch (error) {
      console.error("Failed to fetch models from API:", error);

      // API 调用失败时，返回静态模型列表
      await showToast({
        style: Toast.Style.Failure,
        title: "获取模型列表失败",
        message: "使用默认模型列表",
      });

      return STATIC_MODELS;
    }
  }

  /**
   * 从模型名称中提取版本信息
   * @param modelName 模型名称
   * @returns 版本字符串
   */
  private extractVersionFromName(modelName: string): string {
    // 匹配版本号模式
    const versionPatterns = [
      /gemini-(\d+\.\d+)/, // 匹配 gemini-2.5, gemini-2.0, gemini-1.5 等
      /gemini-(\d+\.\d+)-/, // 匹配带后缀的版本
    ];

    for (const pattern of versionPatterns) {
      const match = modelName.match(pattern);
      if (match) {
        return match[1];
      }
    }

    // 特殊情况处理
    if (modelName.includes("exp") || modelName.includes("experimental")) {
      return "experimental";
    }
    if (modelName.includes("preview")) {
      return "preview";
    }
    if (modelName.includes("1.0")) {
      return "1.0";
    }

    return "unknown";
  }

  /**
   * 获取可用模型列表（带缓存）
   * @param forceRefresh 是否强制刷新缓存
   * @returns Promise<ModelInfo[]>
   */
  async getAvailableModels(forceRefresh = false): Promise<ModelInfo[]> {
    // 检查缓存是否有效
    if (!forceRefresh && modelCache && Date.now() - modelCache.timestamp < modelCache.ttl) {
      return modelCache.models;
    }

    // 缓存无效或强制刷新，从 API 获取
    return await this.listModels();
  }

  /**
   * 获取模型信息
   * @param modelName 模型名称
   * @returns ModelInfo | null
   */
  async getModelInfo(modelName: string): Promise<ModelInfo | null> {
    const models = await this.getAvailableModels();
    return models.find((model) => model.name === modelName) || null;
  }

  /**
   * 验证模型是否可用
   * @param modelName 模型名称
   * @returns Promise<boolean>
   */
  async isModelAvailable(modelName: string): Promise<boolean> {
    const models = await this.getAvailableModels();
    return models.some((model) => model.name === modelName);
  }

  /**
   * 流式生成内容
   * @param prompt 用户输入的提示词
   * @param options 请求选项
   * @returns Promise<GeminiResponse>
   */
  async generateContentStream(prompt: string, options: GeminiRequestOptions = {}): Promise<GeminiResponse> {
    const model = options.model || this.defaultModel;
    const streamCallback = options.stream;

    try {
      const startTime = Date.now();

      // 显示加载提示，包含模型信息
      await showToast({
        style: Toast.Style.Animated,
        title: "正在请求 Gemini...",
        message: `使用模型: ${model}`,
      });

      let fullResponse = "";

      // 使用官方 SDK 的流式 API
      const response = await this.client.models.generateContentStream({
        model,
        contents: prompt,
      });

      // 处理流式响应
      for await (const chunk of response) {
        const chunkText = chunk.text;
        if (chunkText) {
          fullResponse += chunkText;
          // 调用回调函数更新 UI
          if (streamCallback) {
            streamCallback(chunkText);
          }
        }
      }

      const duration = Date.now() - startTime;

      // 显示成功提示，包含模型和耗时信息
      await showToast({
        style: Toast.Style.Success,
        title: "翻译完成",
        message: `${model} | ${(duration / 1000).toFixed(1)}s`,
      });

      return {
        text: fullResponse,
        model,
        timestamp: new Date(),
      };
    } catch (error) {
      console.error("Gemini 流式 API 请求失败:", error);
      await this.handleError(error as Error);
      throw error;
    }
  }
}

/**
 * 创建 Gemini 客户端实例
 * @param config 配置对象
 * @returns GeminiClient 实例
 */
export function createGeminiClient(config: GeminiConfig): GeminiClient {
  return new GeminiClient(config);
}

/**
 * 默认的 Gemini 客户端实例（单例模式）
 * 需要在使用前调用 initializeGeminiClient 进行初始化
 */
let defaultClient: GeminiClient | null = null;

/**
 * 初始化默认的 Gemini 客户端
 * @param config 配置对象
 */
export function initializeGeminiClient(config: GeminiConfig): void {
  defaultClient = createGeminiClient(config);
}

/**
 * 获取默认的 Gemini 客户端
 * @returns GeminiClient 实例
 * @throws Error 如果客户端未初始化
 */
export function getGeminiClient(): GeminiClient {
  if (!defaultClient) {
    throw new Error("Gemini client not initialized. Call initializeGeminiClient first.");
  }
  return defaultClient;
}

/**
 * 获取静态模型列表
 * @returns ModelInfo[]
 */
export function getStaticModels(): ModelInfo[] {
  return [...STATIC_MODELS];
}

/**
 * 验证模型名称格式
 * @param modelName 模型名称
 * @returns boolean
 */
export function isValidModelName(modelName: string): boolean {
  // 基本的模型名称格式验证
  const modelNameRegex = /^[a-zA-Z0-9\-_.]+$/;
  return modelNameRegex.test(modelName) && modelName.length > 0 && modelName.length <= 100;
}
