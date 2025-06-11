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

// 默认配置
const DEFAULT_MODEL = "gemini-2.0-flash";
const DEFAULT_MAX_RETRIES = 3;

/**
 * Gemini API 客户端类
 * 提供统一的 API 调用接口，封装官方 SDK 的具体实现
 */
export class GeminiClient {
  private client: GoogleGenAI;
  private defaultModel: string;

  constructor(config: GeminiConfig) {
    if (!config.apiKey) {
      throw new Error("API Key is required");
    }

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

        // 显示加载提示
        await showToast({
          style: Toast.Style.Animated,
          title: "正在请求 Gemini...",
          message: `尝试 ${attempt}/${maxRetries}`,
        });

        const response = await this.client.models.generateContent({
          model,
          contents: prompt,
        });

        const responseText = response.text || "";
        const duration = Date.now() - startTime;

        // 显示成功提示
        await showToast({
          style: Toast.Style.Success,
          title: "请求完成",
          message: `耗时 ${(duration / 1000).toFixed(1)} 秒`,
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

      // 显示加载提示
      await showToast({
        style: Toast.Style.Animated,
        title: "正在请求 Gemini...",
        message: "流式响应模式",
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

      // 显示成功提示
      await showToast({
        style: Toast.Style.Success,
        title: "流式响应完成",
        message: `耗时 ${(duration / 1000).toFixed(1)} 秒`,
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
