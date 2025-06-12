/**
 * 音频播放测试脚本
 * 用于诊断音频播放问题
 */

import { EdgeTTS } from '@andresaya/edge-tts';
import { exec } from 'child_process';
import { writeFileSync, existsSync } from 'fs';

async function testBasicTTS() {
  console.log('🧪 测试基础 TTS 功能...');
  
  const tts = new EdgeTTS();
  
  try {
    // 生成简单的音频
    await tts.synthesize("Hello, this is a test.", 'en-US-AriaNeural', {
      rate: '+0%',
      volume: '+0%',
      pitch: '+0Hz'
    });
    
    // 保存到文件
    await tts.toFile('test-audio');
    
    if (existsSync('test-audio.mp3')) {
      console.log('✅ 音频文件生成成功: test-audio.mp3');
      
      // 获取文件大小
      const fs = require('fs');
      const stats = fs.statSync('test-audio.mp3');
      console.log(`📁 文件大小: ${stats.size} bytes`);
      
      return true;
    } else {
      console.log('❌ 音频文件生成失败');
      return false;
    }
    
  } catch (error) {
    console.error('❌ TTS 生成错误:', error);
    return false;
  }
}

async function testAudioPlayer() {
  console.log('\n🧪 测试音频播放器...');
  
  const players = ['afplay', 'aplay', 'mpg123', 'ffplay'];
  
  for (const player of players) {
    try {
      await new Promise<boolean>((resolve) => {
        exec(`which ${player}`, (error) => {
          if (!error) {
            console.log(`✅ 找到播放器: ${player}`);
            resolve(true);
          } else {
            console.log(`❌ 未找到播放器: ${player}`);
            resolve(false);
          }
        });
      });
    } catch (error) {
      console.log(`❌ 检查播放器 ${player} 时出错:`, error);
    }
  }
}

async function testPlayAudio() {
  console.log('\n🧪 测试音频播放...');
  
  if (!existsSync('test-audio.mp3')) {
    console.log('❌ 测试音频文件不存在');
    return false;
  }
  
  return new Promise<boolean>((resolve) => {
    // 尝试播放音频
    exec('afplay test-audio.mp3', (error, stdout, stderr) => {
      if (error) {
        console.log('❌ afplay 播放失败:', error.message);
        
        // 尝试其他播放器
        exec('mpg123 test-audio.mp3', (error2) => {
          if (error2) {
            console.log('❌ mpg123 播放失败:', error2.message);
            resolve(false);
          } else {
            console.log('✅ mpg123 播放成功');
            resolve(true);
          }
        });
      } else {
        console.log('✅ afplay 播放成功');
        resolve(true);
      }
    });
  });
}

async function testSystemAudio() {
  console.log('\n🧪 测试系统音频设置...');
  
  return new Promise<void>((resolve) => {
    // 检查音频输出设备
    exec('system_profiler SPAudioDataType', (error, stdout) => {
      if (error) {
        console.log('❌ 无法获取音频设备信息');
      } else {
        console.log('🔊 音频设备信息:');
        const lines = stdout.split('\n').slice(0, 10); // 只显示前10行
        lines.forEach(line => {
          if (line.trim()) {
            console.log(`   ${line.trim()}`);
          }
        });
      }
      resolve();
    });
  });
}

async function testManualPlay() {
  console.log('\n🧪 手动播放测试...');
  console.log('请手动运行以下命令来测试音频播放:');
  console.log('   afplay test-audio.mp3');
  console.log('   或者');
  console.log('   open test-audio.mp3');
  
  // 尝试用系统默认应用打开
  return new Promise<void>((resolve) => {
    exec('open test-audio.mp3', (error) => {
      if (error) {
        console.log('❌ 无法用系统默认应用打开音频文件');
      } else {
        console.log('✅ 已用系统默认应用打开音频文件');
      }
      resolve();
    });
  });
}

async function main() {
  console.log('🚀 音频播放诊断工具');
  console.log('===================');
  
  try {
    // 1. 测试基础 TTS 功能
    const ttsSuccess = await testBasicTTS();
    
    // 2. 测试音频播放器
    await testAudioPlayer();
    
    // 3. 测试系统音频
    await testSystemAudio();
    
    // 4. 测试音频播放
    if (ttsSuccess) {
      const playSuccess = await testPlayAudio();
      
      if (!playSuccess) {
        await testManualPlay();
      }
    }
    
    console.log('\n📋 诊断完成！');
    console.log('如果仍然没有声音，请检查:');
    console.log('1. 系统音量是否开启');
    console.log('2. 音频输出设备是否正确');
    console.log('3. 是否有其他应用占用音频设备');
    
  } catch (error) {
    console.error('诊断过程中出错:', error);
  }
}

if (require.main === module) {
  main().catch(console.error);
}
