/**
 * MsEdge TTS API - 基于 msedge-tts 的文本转语音服务
 *
 * 调用方法:
 *
 * 1. 基础使用:
 *    ```typescript
 *    import { MsEdgeTTS } from './api/msedge-tts';
 *
 *    // 快速播放文本
 *    await MsEdgeTTS.speak("你好世界");
 *
 *    // 使用指定语音
 *    await MsEdgeTTS.speak("Hello World", { voice: "en-US-JennyNeural" });
 *    ```
 *
 * 2. 实例化使用:
 *    ```typescript
 *    const tts = new MsEdgeTTS();
 *
 *    // 设置语音
 *    tts.setVoice("zh-CN-XiaoxiaoNeural");
 *
 *    // 播放文本
 *    await tts.speak("这是测试文本");
 *
 *    // 从文件播放
 *    await tts.speakFromFile("./text.txt");
 *    ```
 *
 * 3. 高级功能:
 *    ```typescript
 *    // 获取可用语音列表
 *    const voices = await MsEdgeTTS.getVoices();
 *
 *    // 获取中文语音
 *    const chineseVoices = await MsEdgeTTS.getChineseVoices();
 *
 *    // 搜索语音
 *    const searchResults = await MsEdgeTTS.searchVoices("xiaoxiao");
 *
 *    // 批量播放文件
 *    await tts.speakFromFiles(["file1.txt", "file2.txt"]);
 *    ```
 *
 * 4. 不同播放模式:
 *    ```typescript
 *    // 原生流式播放 (推荐)
 *    await tts.nativeStreamSpeak("文本内容");
 *
 *    // 实时流式播放 (实验性)
 *    await tts.realtimeStreamSpeak("文本内容");
 *
 *    // 带边界信息的播放
 *    await tts.boundaryStreamSpeak("文本内容");
 *    ```
 */

import { MsEdgeTTS as EdgeTTS, OUTPUT_FORMAT, Voice } from "msedge-tts";
import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * TTS 播放选项
 */
export interface TTSOptions {
  /** 语音名称，如 'zh-CN-XiaoxiaoNeural' */
  voice?: string;
  /** 输出格式 */
  outputFormat?: OUTPUT_FORMAT;
  /** 是否启用边界信息 */
  enableBoundary?: boolean;
}

/**
 * TTS 播放结果
 */
export interface TTSResult {
  /** 是否成功 */
  success: boolean;
  /** 是否被取消 */
  cancelled?: boolean;
  /** 结果消息 */
  message?: string;
  /** 播放时长(毫秒) */
  duration?: number;
}

/**
 * 播放模式
 */
export type PlayMode = "native" | "realtime" | "boundary";

/**
 * MsEdge TTS 服务类
 * 提供基于 msedge-tts 的文本转语音功能
 */
export class MsEdgeTTS {
  // 静态变量：防止重复播放和管理播放状态
  private static isPlaying: boolean = false;
  private static currentPlayingText: string = "";
  private static currentPlayer: any = null; // 当前播放进程
  private static currentTempFile: string = ""; // 当前临时文件
  // ADD: Track the ID of the request that is currently allowed to control state
  private static activeRequestId: string | null = null;

  // 增强的流级别状态管理
  private static activeStreamId: string | null = null; // 当前活动流ID
  private static activeEdgeTTS: EdgeTTS | null = null; // 当前活动的EdgeTTS实例
  private static streamLock: boolean = false; // 流创建锁
  private static streamAbortController: AbortController | null = null; // 流中断控制器
  private static streamCreationPromise: Promise<void> | null = null; // 流创建Promise

  private currentVoice: string = "zh-CN-XiaoxiaoNeural";
  private outputFormat = OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3;

  constructor(voice?: string, outputFormat?: OUTPUT_FORMAT) {
    if (voice) this.currentVoice = voice;
    if (outputFormat) this.outputFormat = outputFormat;
  }

  /**
   * 生成唯一的流ID
   */
  private static generateStreamId(): string {
    return `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 等待流锁释放（优化版）
   */
  private static async waitForStreamLock(maxWaitMs: number = 1000): Promise<boolean> {
    const startTime = Date.now();
    let waitCount = 0;

    while (MsEdgeTTS.streamLock && (Date.now() - startTime) < maxWaitMs) {
      waitCount++;
      if (waitCount === 1) {
        console.log("⏳ 等待流锁释放...");
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    if (MsEdgeTTS.streamLock) {
      console.log("⚠️ 等待流锁超时，强制继续");
      return false;
    }

    if (waitCount > 0) {
      console.log("✅ 流锁已释放");
    }

    return true;
  }

  /**
   * 取消活动的音频流（增强版）
   */
  static async cancelActiveStream(): Promise<void> {
    const streamId = MsEdgeTTS.activeStreamId;
    if (!streamId && !MsEdgeTTS.isPlaying) {
      console.log("🔍 没有活动的音频流或播放需要取消");
      return;
    }

    console.log(`🛑 [${streamId || "player"}] 开始取消活动...`);

    try {
      // 1. 中断流创建过程
      if (MsEdgeTTS.streamAbortController) {
        console.log(`🚫 [${streamId}] 中断流创建过程...`);
        MsEdgeTTS.streamAbortController.abort("New request");
        MsEdgeTTS.streamAbortController = null;
      }

      // 2. 销毁EdgeTTS实例
      if (MsEdgeTTS.activeEdgeTTS) {
        console.log(`🗑️ [${streamId}] 销毁EdgeTTS实例...`);
        try {
          if (typeof MsEdgeTTS.activeEdgeTTS.close === "function") {
            MsEdgeTTS.activeEdgeTTS.close();
          }
        } catch (error) {
          // 在连接建立早期调用close()可能会抛出错误，这是预期的
          console.warn(`⚠️ [${streamId}] 销毁EdgeTTS实例时出现预期内的错误:`, (error as Error).message);
        }
        MsEdgeTTS.activeEdgeTTS = null;
      }

      // 3. 强制停止当前播放器
      if (MsEdgeTTS.isPlaying || MsEdgeTTS.currentPlayer) {
        console.log("🛑 [player] 强制停止当前播放器...");
        MsEdgeTTS.cancelCurrentPlayback();
      }

      // 4. 等待流创建Promise完成（如果存在）
      if (MsEdgeTTS.streamCreationPromise) {
        console.log(`⏳ [${streamId}] 等待流创建Promise完成...`);
        try {
          await Promise.race([
            MsEdgeTTS.streamCreationPromise,
            new Promise((resolve) => setTimeout(resolve, 250)), // 250ms超时
          ]);
        } catch (error) {
          if (error instanceof Error && error.message.includes("aborted")) {
            console.log(`✅ [${streamId}] 流创建Promise已成功中断`);
          } else {
            console.log(`⚠️ [${streamId}] 流创建Promise等待期间发生错误:`, error);
          }
        }
        MsEdgeTTS.streamCreationPromise = null;
      }

      // 5. 重置流状态
      MsEdgeTTS.activeStreamId = null;
      console.log(`✅ [${streamId || "player"}] 活动已成功取消`);
    } catch (error) {
      console.error(`❌ [${streamId}] 取消活动时出错:`, error);
    } finally {
      // 确保锁被释放
      MsEdgeTTS.streamLock = false;
    }
  }

  /**
   * 清理文本，移除特殊字符和格式
   */
  private cleanText(text: string): string {
    return text
      .replace(/\r/g, "") // 移除回车符
      .replace(/https?:\/\/[^\s]+/g, "网址") // 替换URL
      .replace(/\n+/g, "。") // 换行转句号
      .replace(/\s+/g, " ") // 合并空格
      .replace(/，+/g, "，") // 合并逗号
      .replace(/。+/g, "。") // 合并句号
      .trim();
  }

  /**
   * 创建临时文件路径
   */
  private createTempFile(prefix: string = "tts"): string {
    return path.join(os.tmpdir(), `${prefix}_${Date.now()}.mp3`);
  }

  /**
   * 清理临时文件
   */
  private cleanupTempFile(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log("🗑️ 临时文件已清理");
      }
    } catch (error) {
      console.warn("⚠️ 清理临时文件失败:", error);
    }
  }

  /**
   * 取消当前播放（静态方法）
   */
  static cancelCurrentPlayback(): void {
    // If we cancel, no request owns the state
    MsEdgeTTS.activeRequestId = null;
    if (MsEdgeTTS.currentPlayer) {
      console.log("🛑 强制取消当前播放...");
      try {
        // 使用SIGKILL强制终止
        MsEdgeTTS.currentPlayer.kill('SIGKILL');
        MsEdgeTTS.currentPlayer = null;
        console.log("✅ 播放进程已强制终止");
      } catch (error) {
        console.warn("⚠️ 取消播放时出错:", error);
      }
    }

    // 清理临时文件
    if (MsEdgeTTS.currentTempFile) {
      try {
        if (fs.existsSync(MsEdgeTTS.currentTempFile)) {
          fs.unlinkSync(MsEdgeTTS.currentTempFile);
          console.log("🗑️ 临时文件已清理");
        }
      } catch (error) {
        console.warn("⚠️ 清理临时文件失败:", error);
      }
      MsEdgeTTS.currentTempFile = "";
    }

    // 重置播放状态
    MsEdgeTTS.isPlaying = false;
    MsEdgeTTS.currentPlayingText = "";
    console.log("🔄 播放状态已重置 by cancelCurrentPlayback");
  }

  /**
   * 播放音频文件（增强版，支持强制取消现有播放）
   */
  private async playAudioFile(filePath: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      /* ---- REMOVE THIS BLOCK ----
      // 在开始新播放前，强制取消现有播放 - Cancellation is now handled BEFORE calling this
      if (MsEdgeTTS.currentPlayer) {
        console.log("🛑 检测到现有播放进程，强制终止...");
        try {
          MsEdgeTTS.currentPlayer.kill('SIGKILL');
          console.log("✅ 现有播放进程已强制终止");
        } catch (error) {
          console.warn("⚠️ 终止现有播放进程时出错:", error);
        }
        MsEdgeTTS.currentPlayer = null;
        MsEdgeTTS.currentTempFile = "";
      }
     ---------------------------- */
      // Check again just in case of race, but don't kill
      if (MsEdgeTTS.currentPlayer) {
        console.warn("⚠️ Race condition detected: currentPlayer exists in playAudioFile, continuing anyway.");
      }

      console.log("🎵 开始播放...");
      // SET STATE HERE
      MsEdgeTTS.isPlaying = true;

      const player = spawn("afplay", [filePath], {
        stdio: ["ignore", "ignore", "ignore"],
      });

      // 保存当前播放器和临时文件引用
      MsEdgeTTS.currentPlayer = player;
      MsEdgeTTS.currentTempFile = filePath;

      player.on("close", (code) => {
        console.log(`✅ 播放完成 (退出码: ${code})`);
        // 清理引用 - CHECK OWNERSHIP!
        if (MsEdgeTTS.currentPlayer === player) {
          MsEdgeTTS.isPlaying = false; // <<< MANAGE STATE
          MsEdgeTTS.currentPlayer = null;
          MsEdgeTTS.currentTempFile = "";
          console.log("🔄 播放状态已重置 by player.on(close)");
        }
        resolve();
      });

      player.on("error", (error) => {
        console.error("❌ 播放错误:", error);
        // 清理引用 - CHECK OWNERSHIP!
        if (MsEdgeTTS.currentPlayer === player) {
          MsEdgeTTS.isPlaying = false; // <<< MANAGE STATE
          MsEdgeTTS.currentPlayer = null;
          MsEdgeTTS.currentTempFile = "";
          console.log("🔄 播放状态已重置 by player.on(error)");
        }
        reject(error);
      });
    });
  }

  /**
   * 原生流式播放 - 增强版，支持流级别并发控制
   * 使用 msedge-tts 的原生流式功能，稳定可靠
   */
  async nativeStreamSpeak(text: string, voice?: string): Promise<void> {
    const voiceToUse = voice || this.currentVoice;
    let streamId: string | null = null;
    let tempFile: string | null = null;

    try {
      // 1. 生成流ID并检查是否需要等待
      streamId = MsEdgeTTS.generateStreamId();

      console.log(`🌊 [${streamId}] MsEdge 原生流式播放启动...`);
      console.log(`🎤 [${streamId}] 语音: ${voiceToUse}`);

      // 2. 如果有流锁，尝试等待，但不强制等待
      if (MsEdgeTTS.streamLock) {
        const waitSuccess = await MsEdgeTTS.waitForStreamLock(500); // 最多等待500ms
        if (!waitSuccess) {
          console.log(`⚠️ [${streamId}] 流锁等待超时，取消现有流并继续`);
          await MsEdgeTTS.cancelActiveStream();
        }
      }

      // 3. 获取流锁
      MsEdgeTTS.streamLock = true;

      // 4. 取消现有活动流
      if (MsEdgeTTS.activeStreamId && MsEdgeTTS.activeStreamId !== streamId) {
        console.log(`🔄 [${streamId}] 检测到现有活动流，正在取消...`);
        await MsEdgeTTS.cancelActiveStream();
      }

      // 5. 设置当前流为活动流
      MsEdgeTTS.activeStreamId = streamId;

      // 清理文本
      const cleanedText = this.cleanText(text);
      if (!cleanedText || cleanedText.length < 1) {
        throw new Error("文本为空");
      }

      console.log(`📝 [${streamId}] 文本: "${cleanedText.substring(0, 50)}${cleanedText.length > 50 ? "..." : ""}"`);

      // 5. 创建EdgeTTS实例和中断控制器
      const tts = new EdgeTTS();
      MsEdgeTTS.activeEdgeTTS = tts;
      MsEdgeTTS.streamAbortController = new AbortController();

      console.log(`🔧 [${streamId}] 设置TTS元数据...`);
      await tts.setMetadata(voiceToUse, this.outputFormat);

      // 6. 检查是否被取消
      if (MsEdgeTTS.activeStreamId !== streamId) {
        console.log(`🚫 [${streamId}] 流已被取消，停止执行`);
        return;
      }

      console.log(`🔊 [${streamId}] 开始流式播放...`);

      // 7. 创建流生成Promise
      MsEdgeTTS.streamCreationPromise = (async () => {
        try {
          // 获取音频流
          const { audioStream } = tts.toStream(cleanedText);

          // 再次检查是否被取消
          if (MsEdgeTTS.activeStreamId !== streamId) {
            console.log(`🚫 [${streamId}] 流在生成过程中被取消`);
            return;
          }

          // 创建临时文件
          tempFile = this.createTempFile("native");
          const writeStream = fs.createWriteStream(tempFile);

          console.log(`💾 [${streamId}] 开始写入音频流到临时文件...`);

          // 写入音频流
          audioStream.pipe(writeStream);

          // 等待写入完成
          await new Promise<void>((resolve, reject) => {
            writeStream.on("finish", () => {
              console.log(`✅ [${streamId}] 音频流写入完成`);
              resolve();
            });

            writeStream.on("error", (error) => {
              console.error(`❌ [${streamId}] 写入流错误:`, error);
              reject(error);
            });

            audioStream.on("error", (error) => {
              console.error(`❌ [${streamId}] 音频流错误:`, error);
              reject(error);
            });

            // 监听中断信号
            MsEdgeTTS.streamAbortController?.signal.addEventListener('abort', () => {
              console.log(`🛑 [${streamId}] 收到中断信号，停止写入`);
              writeStream.destroy();
              reject(new Error('Stream aborted'));
            });
          });

          // 最后检查是否被取消
          if (MsEdgeTTS.activeStreamId !== streamId) {
            console.log(`🚫 [${streamId}] 流在写入完成后被取消`);
            return;
          }

          console.log(`🎵 [${streamId}] 开始播放音频文件...`);

          // 播放音频
          await this.playAudioFile(tempFile);

          console.log(`🎉 [${streamId}] 播放完成`);

        } catch (error) {
          if (error instanceof Error && error.message === 'Stream aborted') {
            console.log(`✅ [${streamId}] 流已被正确中断`);
            throw error; // <<< FIX 1a: RE-THROW from promise
          } else {
            console.error(`❌ [${streamId}] 流处理错误:`, error);
            throw error; // <<< FIX 1b: RE-THROW from promise
          }
        }
      })();

      // 8. 等待流处理完成
      // FIX 1c: Remove the .catch here, let the error bubble up to the outer catch
      await MsEdgeTTS.streamCreationPromise;

    } catch (error) {
      const err = error as Error;
      // 检查是否是预期的中止错误
      if (err && err.message && (err.message.includes("aborted") || err.message.includes("Connect Error") || err.message === 'Stream aborted')) { // Add 'Stream aborted'
        console.log(`✅ [${streamId}] 流被成功中断: ${err.message}`);
        throw err; // <<< FIX 1d: RE-THROW CANCELLATION ERROR to caller (static speak)
      } else {
        console.error(`❌ [${streamId}] 原生流式播放失败:`, err);
        throw err; // <<< FIX 1e: RE-THROW all other errors too
      }
    } finally {
      // 9. 清理资源
      if (tempFile) {
        this.cleanupTempFile(tempFile);
      }

      // 只有当前流才能清理自己的状态
      if (MsEdgeTTS.activeStreamId === streamId) {
        console.log(`🧹 [${streamId}] 清理流状态...`);
        MsEdgeTTS.activeStreamId = null;
        MsEdgeTTS.activeEdgeTTS = null;
        MsEdgeTTS.streamAbortController = null;
        MsEdgeTTS.streamCreationPromise = null;
      }

      // 释放流锁
      if (MsEdgeTTS.streamLock) {
        MsEdgeTTS.streamLock = false;
        console.log(`🔓 [${streamId}] 流锁已释放`);
      }
    }
  }

  /**
   * 实时流式播放 - 实验性功能
   * 尝试边接收边播放，可能在某些系统上不稳定
   */
  async realtimeStreamSpeak(text: string, voice?: string): Promise<void> {
    const voiceToUse = voice || this.currentVoice;

    try {
      console.log(`⚡ MsEdge 实时流式播放启动...`);

      const cleanedText = this.cleanText(text);
      if (!cleanedText) throw new Error("文本为空");

      console.log(`📝 文本: "${cleanedText.substring(0, 50)}${cleanedText.length > 50 ? "..." : ""}"`);

      // 创建TTS实例
      const tts = new EdgeTTS();
      await tts.setMetadata(voiceToUse, this.outputFormat);

      console.log("🔊 开始实时流式播放...");

      // 获取音频流
      const { audioStream } = await tts.toStream(cleanedText);

      // 直接流式播放
      const player = spawn("afplay", ["-"], {
        stdio: ["pipe", "ignore", "ignore"],
      });

      // 管道音频流到播放器
      audioStream.pipe(player.stdin);

      // 监听数据流
      let totalBytes = 0;
      audioStream.on("data", (chunk) => {
        totalBytes += chunk.length;
        console.log(`📊 接收音频数据: ${chunk.length} 字节 (总计: ${totalBytes} 字节)`);
      });

      audioStream.on("end", () => {
        console.log(`✅ 音频流结束，总计: ${totalBytes} 字节`);
      });

      // 等待播放完成
      await new Promise<void>((resolve, reject) => {
        player.on("close", (code) => {
          console.log(`✅ 实时播放完成，退出码: ${code}`);
          resolve();
        });

        player.on("error", reject);
        audioStream.on("error", (error) => {
          player.kill();
          reject(error);
        });
      });
    } catch (error) {
      console.error("❌ 实时流式播放失败:", error);
      throw error;
    }
  }

  /**
   * 带边界信息的流式播放
   * 提供单词和句子边界信息，适用于需要精确控制的场景
   */
  async boundaryStreamSpeak(text: string, voice?: string): Promise<void> {
    const voiceToUse = voice || this.currentVoice;

    try {
      console.log(`🎯 MsEdge 边界流式播放启动...`);

      const cleanedText = this.cleanText(text);
      if (!cleanedText) throw new Error("文本为空");

      console.log(`📝 文本: "${cleanedText.substring(0, 50)}${cleanedText.length > 50 ? "..." : ""}"`);

      // 创建TTS实例，启用边界信息
      const tts = new EdgeTTS();
      await tts.setMetadata(voiceToUse, this.outputFormat, {
        wordBoundaryEnabled: true,
        sentenceBoundaryEnabled: true,
      });

      console.log("🔊 开始边界流式播放...");

      // 获取音频流和元数据流
      const { audioStream, metadataStream } = await tts.toStream(cleanedText);

      // 监听元数据
      if (metadataStream) {
        metadataStream.on("data", (data) => {
          try {
            const metadata = JSON.parse(data.toString());
            console.log("📊 边界信息:", metadata);
          } catch (e) {
            console.log("📊 元数据:", data.toString());
          }
        });
      }

      // 创建临时文件播放
      const tempFile = this.createTempFile("boundary");
      const writeStream = fs.createWriteStream(tempFile);

      audioStream.pipe(writeStream);

      await new Promise<void>((resolve, reject) => {
        writeStream.on("finish", async () => {
          console.log("✅ 音频流写入完成");

          try {
            await this.playAudioFile(tempFile);
            this.cleanupTempFile(tempFile);
            resolve();
          } catch (error) {
            this.cleanupTempFile(tempFile);
            reject(error);
          }
        });

        writeStream.on("error", reject);
        audioStream.on("error", reject);
      });
    } catch (error) {
      console.error("❌ 边界流式播放失败:", error);
      throw error;
    }
  }

  /**
   * 通用播放方法
   * 根据指定模式播放文本
   */
  async speak(text: string, mode: PlayMode = "native", voice?: string): Promise<void> {
    switch (mode) {
      case "realtime":
        return this.realtimeStreamSpeak(text, voice);
      case "boundary":
        return this.boundaryStreamSpeak(text, voice);
      case "native":
      default:
        return this.nativeStreamSpeak(text, voice);
    }
  }

  /**
   * 从文件读取文本并播放
   */
  async speakFromFile(filePath: string, mode: PlayMode = "native", voice?: string): Promise<void> {
    try {
      console.log(`📁 从文件读取: ${filePath}`);

      // 检查文件是否存在
      if (!fs.existsSync(filePath)) {
        throw new Error(`文件不存在: ${filePath}`);
      }

      // 读取文件内容
      const text = fs.readFileSync(filePath, "utf-8");
      console.log(`📝 文件内容长度: ${text.length} 字符`);

      if (!text.trim()) {
        throw new Error("文件内容为空");
      }

      // 播放文本
      await this.speak(text, mode, voice);
    } catch (error) {
      console.error("❌ 文件播放失败:", error);
      throw error;
    }
  }

  /**
   * 批量播放多个文件
   */
  async speakFromFiles(filePaths: string[], mode: PlayMode = "native", voice?: string): Promise<void> {
    try {
      console.log(`📁 批量播放 ${filePaths.length} 个文件...`);

      for (let i = 0; i < filePaths.length; i++) {
        const filePath = filePaths[i];
        console.log(`\n🎵 [${i + 1}/${filePaths.length}] 播放文件: ${path.basename(filePath)}`);

        try {
          await this.speakFromFile(filePath, mode, voice);
        } catch (error) {
          console.error(`❌ 文件 ${filePath} 播放失败:`, error);
          // 继续播放下一个文件
        }
      }
    } catch (error) {
      console.error("❌ 批量播放失败:", error);
      throw error;
    }
  }

  /**
   * 设置语音
   */
  setVoice(voice: string): void {
    this.currentVoice = voice;
  }

  /**
   * 获取当前语音
   */
  getVoice(): string {
    return this.currentVoice;
  }

  /**
   * 设置输出格式
   */
  setOutputFormat(format: OUTPUT_FORMAT): void {
    this.outputFormat = format;
  }

  /**
   * 获取当前输出格式
   */
  getOutputFormat(): OUTPUT_FORMAT {
    return this.outputFormat;
  }

  /**
   * 获取可用的语音列表
   */
  async getVoices(): Promise<Voice[]> {
    try {
      console.log("🔍 获取可用语音列表...");

      const tts = new EdgeTTS();
      const voices = await tts.getVoices();

      console.log(`✅ 获取到 ${voices.length} 个语音`);
      return voices;
    } catch (error) {
      console.error("❌ 获取语音列表失败:", error);
      throw error;
    }
  }

  /**
   * 获取中文语音列表
   */
  async getChineseVoices(): Promise<Voice[]> {
    try {
      const allVoices = await this.getVoices();
      const chineseVoices = allVoices.filter(
        (voice) => voice.Locale.startsWith("zh-") || voice.Locale.includes("Chinese"),
      );

      console.log(`🇨🇳 找到 ${chineseVoices.length} 个中文语音`);
      return chineseVoices;
    } catch (error) {
      console.error("❌ 获取中文语音列表失败:", error);
      throw error;
    }
  }

  /**
   * 搜索语音
   */
  async searchVoices(keyword: string): Promise<Voice[]> {
    try {
      const allVoices = await this.getVoices();
      const matchedVoices = allVoices.filter(
        (voice) =>
          voice.FriendlyName.toLowerCase().includes(keyword.toLowerCase()) ||
          voice.ShortName.toLowerCase().includes(keyword.toLowerCase()) ||
          voice.Locale.toLowerCase().includes(keyword.toLowerCase()),
      );

      console.log(`🔍 搜索 "${keyword}" 找到 ${matchedVoices.length} 个语音`);
      return matchedVoices;
    } catch (error) {
      console.error("❌ 搜索语音失败:", error);
      throw error;
    }
  }

  // ==================== 静态便捷方法 ====================

  /**
   * 快速播放文本（静态方法）
   * 最简单的使用方式，适合一次性播放
   */
  static async speak(text: string, options: TTSOptions = {}): Promise<TTSResult> {
    const startTime = Date.now();
    const requestId = MsEdgeTTS.generateStreamId();
    console.log(`🚀 [${requestId}] 新的TTS播放请求: "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"`);

    // FIX 2: Centralised, robust cancellation check BEFORE try/catch
    const needsCancelPlayer = !!MsEdgeTTS.currentPlayer; // Check if a player process actually exists
    const needsCancelStream = !!MsEdgeTTS.activeStreamId && MsEdgeTTS.activeStreamId !== requestId;
    const isOwnedByOther = !!MsEdgeTTS.activeRequestId && MsEdgeTTS.activeRequestId !== requestId;

    if (needsCancelPlayer || needsCancelStream || isOwnedByOther) {
      console.log(`🔄 [${requestId}] 检测到现有活动 (Player:${needsCancelPlayer}, Stream:${needsCancelStream}, Owner:${MsEdgeTTS.activeRequestId}), 正在强制取消...`);
      // ALWAYS kill player if it exists
      if (needsCancelPlayer) {
        MsEdgeTTS.cancelCurrentPlayback();
      }
      // ALWAYS cancel stream if it exists and isn't ours
      if (needsCancelStream || isOwnedByOther) {
        await MsEdgeTTS.cancelActiveStream();
      }
      // Delay only if we actually did something
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    // END FIX 2 check

    try {
      // Claim ownership
      MsEdgeTTS.activeRequestId = requestId;
      MsEdgeTTS.currentPlayingText = text.trim();

      console.log(`▶️ [${requestId}] 开始播放...`);

      const tts = new MsEdgeTTS(options.voice);
      if (options.outputFormat) {
        tts.setOutputFormat(options.outputFormat);
      }
      const mode = options.enableBoundary ? "boundary" : "native";
      // This will now correctly throw if cancelled, thanks to FIX 1
      await tts.speak(text, mode, options.voice);

      const duration = Date.now() - startTime;
      // If we got here, it was successful
      console.log(`✅ [${requestId}] 播放成功完成，耗时: ${duration}ms`);
      return {
        success: true,
        message: "播放完成",
        duration,
      };
    } catch (error) { // FIX 1 ensures we land here on cancellation
      const duration = Date.now() - startTime;
      const errorMessage = (error as Error)?.message || "Unknown error";
      const errorString = error?.toString() || "";
      console.log(`🔍 [${requestId}] 错误/取消详情: message="${errorMessage}", toString="${errorString}"`);

      // Check if this request was cancelled by a NEWER request OR if the error is a cancellation error
      const wasCancelledByNewerRequest = MsEdgeTTS.activeRequestId !== requestId;
      const isCancellationError = errorMessage.includes("Connect Error") ||
        errorMessage.includes("Stream aborted") ||
        errorMessage.includes("aborted") || // Added generic aborted
        errorString.includes("Connect Error") ||
        errorString.includes("Stream aborted") ||
        errorString.includes("aborted") ||
        errorMessage === "Unknown error";

      if (wasCancelledByNewerRequest || isCancellationError) {
        console.log(`🔄 [${requestId}] 播放被取消 (Owner: ${MsEdgeTTS.activeRequestId}, Error:${isCancellationError}), 耗时: ${duration}ms`);
        return {
          success: false,
          cancelled: true, // CORRECTLY RETURN CANCELLED
          message: "播放被新请求取消",
          duration,
        };
      }
      // If not a cancellation, it's a real error
      console.error(`❌ [${requestId}] 播放失败，耗时: ${duration}ms，错误:`, error);
      return {
        success: false,
        cancelled: false,
        message: `播放失败: ${errorMessage}`,
        duration,
      };
    } finally {
      // IMPORTANT FIX: Only clean up if THIS request is still the active one!
      // If another request has started, this will be false, preventing the race condition.
      if (MsEdgeTTS.activeRequestId === requestId) {
        console.log(`🧹 [${requestId}] 清理播放状态 (Owner Match)...`);
        // isPlaying, currentPlayer, currentTempFile are now managed ONLY by playAudioFile & cancelCurrentPlayback
        // We just release ownership
        MsEdgeTTS.activeRequestId = null;
        MsEdgeTTS.currentPlayingText = "";
        // MsEdgeTTS.isPlaying = false; // REMOVED
        // MsEdgeTTS.currentPlayer = null; // REMOVED
        // MsEdgeTTS.currentTempFile = ""; // REMOVED
      } else {
        console.log(`🧹 [${requestId}] Skipping cleanup: State owned by ${MsEdgeTTS.activeRequestId}`);
      }
    }
  }

  /**
   * 快速播放文件（静态方法）
   */
  static async speakFile(filePath: string, options: TTSOptions = {}): Promise<TTSResult> {
    const startTime = Date.now();

    try {
      const tts = new MsEdgeTTS(options.voice);

      if (options.outputFormat) {
        tts.setOutputFormat(options.outputFormat);
      }

      const mode = options.enableBoundary ? "boundary" : "native";
      await tts.speakFromFile(filePath, mode, options.voice);

      const duration = Date.now() - startTime;
      return {
        success: true,
        message: "文件播放完成",
        duration,
      };
    } catch (error) {
      return {
        success: false,
        message: `文件播放失败: ${(error as Error)?.message || "Unknown error"}`,
      };
    }
  }

  /**
   * 获取语音列表（静态方法）
   */
  static async getVoices(): Promise<Voice[]> {
    const tts = new MsEdgeTTS();
    return await tts.getVoices();
  }

  /**
   * 获取中文语音列表（静态方法）
   */
  static async getChineseVoices(): Promise<Voice[]> {
    const tts = new MsEdgeTTS();
    return await tts.getChineseVoices();
  }

  /**
   * 搜索语音（静态方法）
   */
  static async searchVoices(keyword: string): Promise<Voice[]> {
    const tts = new MsEdgeTTS();
    return await tts.searchVoices(keyword);
  }

  /**
   * 检查系统是否支持音频播放
   */
  static async checkAudioSupport(): Promise<boolean> {
    try {
      // 在 macOS 上检查 afplay 是否可用
      const { spawn } = require("child_process");

      return new Promise<boolean>((resolve) => {
        const test = spawn("which", ["afplay"], { stdio: "ignore" });

        test.on("close", (code: number | null) => {
          resolve(code === 0);
        });

        test.on("error", () => {
          resolve(false);
        });
      });
    } catch {
      return false;
    }
  }
}

// 导出常用的语音常量
export const COMMON_VOICES = {
  // 中文语音
  ZH_CN_XIAOXIAO: "zh-CN-XiaoxiaoNeural",
  ZH_CN_YUNXI: "zh-CN-YunxiNeural",
  ZH_CN_YUNJIAN: "zh-CN-YunjianNeural",
  ZH_CN_YUNYANG: "zh-CN-YunyangNeural",

  // 英文语音
  EN_US_JENNY: "en-US-JennyNeural",
  EN_US_GUY: "en-US-GuyNeural",
  EN_US_ARIA: "en-US-AriaNeural",
  EN_US_DAVIS: "en-US-DavisNeural",

  // 日文语音
  JA_JP_NANAMI: "ja-JP-NanamiNeural",
  JA_JP_KEITA: "ja-JP-KeitaNeural",
} as const;

// 导出输出格式常量
export { OUTPUT_FORMAT } from "msedge-tts";

// 默认导出
export default MsEdgeTTS;
