/**
 * TTS (Text-to-Speech) 功能实现
 * 支持两种模式：
 * 1. 命令参数模式：通过 text 参数传入要朗读的文本
 * 2. 选中文本模式：自动获取当前选中的文本进行朗读
 */

import {
  Detail,
  Form,
  getPreferenceValues,
  getSelectedText,
  showToast,
  Toast,
  ActionPanel,
  Action,
  Icon,
} from "@raycast/api";
import { useEffect, useState, useRef } from "react";
import { MsEdgeTTS } from "./api/msedge-tts";

// 类型定义
interface Preferences {
  ttsVoice: string;
}

interface Arguments {
  text?: string;
}

// 页面状态枚举
enum PageState {
  Form = "form",
  Loading = "loading",
  Playing = "playing",
  Success = "success",
  Error = "error",
}

export default function TTSCommand(props: { arguments: Arguments }) {
  const { text: argumentText } = props.arguments;
  const { ttsVoice } = getPreferenceValues<Preferences>();

  // 状态管理
  const [pageState, setPageState] = useState<PageState>(PageState.Form);
  const [textToSpeak, setTextToSpeak] = useState<string>("");
  const [inputText, setInputText] = useState<string>("");
  const [selectedText, setSelectedText] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  // 使用 useRef 来确保初始化只执行一次
  const hasInitialized = useRef<boolean>(false);

  // 防抖控制
  const [lastCallTime, setLastCallTime] = useState<number>(0);
  const DEBOUNCE_DELAY = 500; // 500ms 防抖延迟

  /**
   * 执行TTS播放（带防抖机制）
   */
  const performTTS = async (text: string) => {
    if (!text.trim()) {
      setErrorMessage("文本内容为空，无法进行语音播放");
      setPageState(PageState.Error);
      setIsPlaying(false); // Ensure state is clean
      return;
    }

    const currentTime = Date.now();
    // 防抖检查：如果距离上次调用时间太短，跳过
    // NOTE: This prevents an interrupt within 500ms of the *start* of the last request
    if (currentTime - lastCallTime < DEBOUNCE_DELAY) {
      console.log(`🚫 防抖跳过：距离上次调用仅 ${currentTime - lastCallTime}ms`);
      // Don't set isPlaying false here, the previous call is still active
      return;
    }

    /*  ---- REMOVED BLOCKING CHECK ----
    // 增强的防重复播放机制
    if (isPlaying) {
      console.log("🚫 TTS正在播放中，跳过重复请求");
      return; // <<< REMOVED: We WANT to call MsEdgeTTS.speak again to trigger cancellation
    }
    ---------------------------- */

    // 更新最后调用时间
    setLastCallTime(currentTime);

    let wasCancelled = false; // track cancellation state

    try {
      // 立即设置播放状态，防止竞态条件
      setIsPlaying(true); // We are attempting to play/are playing
      setPageState(PageState.Playing);

      await showToast({
        style: Toast.Style.Animated,
        title: "🔊 正在播放...",
        message: `使用 ${getVoiceName(ttsVoice)} 语音 (正在中断...)`, // Indicate interruption might happen
      });

      const startTime = Date.now();

      // 调用 MsEdgeTTS API 进行播放 - This call will now handle interruption internally
      const result = await MsEdgeTTS.speak(text, {
        voice: ttsVoice,
      });

      const duration = Date.now() - startTime;

      // Check cancelled FIRST
      if (result.cancelled) {
        wasCancelled = true;
        console.log("🔄 TTS: 播放被新请求取消，或在启动前被取消。");
        // Don't change PageState, don't show toast, the new request handles it
      } else if (result.success) {
        setPageState(PageState.Success);
        await showToast({
          style: Toast.Style.Success,
          title: "✅ 播放完成",
          message: `耗时 ${Math.round(duration / 1000)}s`,
        });
      } else {
        // Handle non-cancelled failure
        throw new Error(result.message || "播放失败");
      }
    } catch (error) {
      console.error("TTS播放错误:", error);
      // Show error ONLY if it wasn't a cancellation event
      if (!wasCancelled) {
        const errorMsg = error instanceof Error ? error.message : "未知错误";
        setErrorMessage(`播放失败: ${errorMsg}`);
        setPageState(PageState.Error);
        await showToast({
          style: Toast.Style.Failure,
          title: "❌ 播放失败",
          message: errorMsg,
        });
      } else {
        console.log("TTS: Error occurred, but was part of cancellation, suppressing error toast.");
      }
    } finally {
      // FIX 3: ALWAYS set loading state OFF when this function's promise chain completes/fails/is cancelled.
      // The next request will set its own isPlaying=true.
      setIsPlaying(false);
      console.log(`✅ Finally: isPlaying reset to false for request.`);
    }
  };

  /**
   * 获取语音显示名称
   */
  const getVoiceName = (voice: string): string => {
    const voiceMap: Record<string, string> = {
      "zh-CN-XiaoxiaoNeural": "晓晓",
      "zh-CN-YunxiNeural": "云希",
      "zh-CN-YunyangNeural": "云扬",
      "en-US-JennyNeural": "Jenny",
      "en-US-GuyNeural": "Guy",
    };
    return voiceMap[voice] || voice;
  };

  /**
   * 重新播放（带防抖保护）
   */
  const handleReplay = async () => {
    if (textToSpeak && !isPlaying) {
      await performTTS(textToSpeak);
    } else if (isPlaying) {
      console.log("🚫 正在播放中，无法重新播放");
    }
  };

  /**
   * 取消播放
   */
  const handleCancel = () => {
    try {
      MsEdgeTTS.cancelCurrentPlayback();
      setIsPlaying(false);
      setPageState(PageState.Success);
      showToast({
        style: Toast.Style.Success,
        title: "🛑 播放已取消",
        message: "TTS播放已停止",
      });
    } catch (error) {
      console.error("取消播放失败:", error);
      showToast({
        style: Toast.Style.Failure,
        title: "❌ 取消失败",
        message: "无法停止播放",
      });
    }
  };

  /**
   * 处理表单提交
   */
  const handleFormSubmit = async (values: { text: string }) => {
    const textToPlay = values.text.trim();

    if (!textToPlay) {
      showToast({
        style: Toast.Style.Failure,
        title: "请输入要播放的文本",
      });
      return;
    }

    setTextToSpeak(textToPlay);
    await performTTS(textToPlay);
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
        message: "请手动输入要播放的文本",
      });
    }
  };

  /**
   * 清除输入内容
   */
  const clearInput = () => {
    setInputText("");
    setSelectedText("");
  };

  /**
   * 初始化逻辑
   */
  useEffect(() => {
    const initializeTTS = async () => {
      try {
        // 如果已经有播放过的内容，且没有新的命令参数，保持当前状态
        if (textToSpeak && !argumentText?.trim() && pageState !== PageState.Form) {
          console.log("保持当前播放状态，不重新初始化");
          return;
        }

        // 优先使用命令参数
        if (argumentText?.trim()) {
          const finalText = argumentText.trim();
          setTextToSpeak(finalText);
          setInputText(finalText);
          setPageState(PageState.Loading);
          await performTTS(finalText);
          return;
        }

        // 尝试获取选中文本
        try {
          const selected = await getSelectedText();
          if (selected?.trim()) {
            // 直接将选中文本放到输入框中
            setSelectedText(selected);
            setInputText(selected);
            setTextToSpeak(selected);
            setPageState(PageState.Loading);
            await performTTS(selected);
            return;
          }
        } catch (selectionError) {
          console.log("无法获取选中文本:", selectionError);
        }

        // 没有文本时显示Form页面让用户输入
        if (!textToSpeak) {
          setPageState(PageState.Form);
        }
      } catch (error) {
        console.error("TTS初始化错误:", error);
        setErrorMessage("初始化失败，请重试");
        setPageState(PageState.Error);
      }
    };

    // FIX: 使用 useRef 确保只执行一次，避免重复调用
    if (!hasInitialized.current) {
      hasInitialized.current = true;
      initializeTTS();
    }
  }, [argumentText]); // 保持 argumentText 依赖，但用 useRef 防止重复执行

  /**
   * 渲染页面内容
   */
  const renderContent = () => {
    const textPreview = textToSpeak.length > 200 ? `${textToSpeak.substring(0, 200)}...` : textToSpeak;

    switch (pageState) {
      case PageState.Loading:
        return `# 🔄 正在初始化 TTS...

正在准备文本转语音功能...`;

      case PageState.Playing:
        return `# 🔊 正在播放

\`\`\`
${textPreview}
\`\`\`

⏳ 播放中...`;

      case PageState.Success:
        return `# ✅ 播放完成

\`\`\`
${textPreview}
\`\`\`

🎉 播放完成！`;

      case PageState.Error:
        return `# ❌ 播放失败

**错误信息**: ${errorMessage}

**使用说明**:
1. 选中要朗读的文本，然后运行 TTS 命令
2. 或者使用命令参数: \`tts "要朗读的文本"\`

**支持的语音**:
- 晓晓 (中文女声)
- 云希 (中文男声)
- 云扬 (中文男声)
- Jenny (英文女声)
- Guy (英文男声)

可在扩展设置中更改默认语音。`;

      default:
        return "# TTS 文本转语音";
    }
  };

  // 如果是Form页面，渲染Form组件
  if (pageState === PageState.Form) {
    return (
      <Form
        actions={
          <ActionPanel>
            <Action.SubmitForm title="开始播放" icon={Icon.Play} onSubmit={handleFormSubmit} />
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
          id="text"
          title="要播放的文本"
          placeholder="请输入要进行语音播放的文本... (Cmd+Enter: 播放, Shift+Enter: 换行)"
          value={inputText}
          onChange={setInputText}
          enableMarkdown={false}
        />
        <Form.Description
          title="支持的语音"
          text={`当前语音：${getVoiceName(ttsVoice)} | 可在扩展设置中更改默认语音`}
        />
      </Form>
    );
  }

  // 其他页面渲染Detail组件
  return (
    <Detail
      markdown={renderContent()}
      isLoading={pageState === PageState.Loading || isPlaying}
      actions={
        <ActionPanel>
          {pageState === PageState.Playing && (
            <Action
              title="取消播放"
              icon={Icon.Stop}
              onAction={handleCancel}
              shortcut={{ modifiers: [], key: "space" }}
            />
          )}
          {pageState === PageState.Success && (
            <Action
              title="重新播放"
              icon={Icon.Play}
              onAction={handleReplay}
              shortcut={{ modifiers: ["cmd"], key: "r" }}
            />
          )}
          {pageState === PageState.Error && (
            <Action
              title="重试"
              icon={Icon.Repeat}
              onAction={() => {
                setPageState(PageState.Loading);
                hasInitialized.current = false; // 重置初始化状态
                // 重新初始化
                setTimeout(() => {
                  // 重新触发初始化
                  if (!hasInitialized.current) {
                    hasInitialized.current = true;
                    // 这里可以直接调用初始化逻辑，而不是重新加载页面
                    setPageState(PageState.Loading);
                  }
                }, 100);
              }}
              shortcut={{ modifiers: ["cmd"], key: "r" }}
            />
          )}
          {textToSpeak && (
            <Action.CopyToClipboard
              title="复制文本"
              content={textToSpeak}
              shortcut={{ modifiers: ["cmd"], key: "c" }}
            />
          )}
          {(pageState === PageState.Success || pageState === PageState.Error) && (
            <Action
              title="返回输入页面"
              icon={Icon.ArrowLeft}
              onAction={() => {
                setPageState(PageState.Form);
                setInputText(textToSpeak); // 将当前文本放回输入框
              }}
              shortcut={{ modifiers: ["cmd"], key: "b" }}
            />
          )}
        </ActionPanel>
      }
    />
  );
}
