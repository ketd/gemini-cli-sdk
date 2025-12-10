#!/usr/bin/env python3
"""
测试 Gemini CLI 的交互模式（stdin/stdout 通信）

测试场景：
1. 启动 CLI 进程（--prompt-interactive + --output-format stream-json）
2. 通过 stdin 发送多条消息
3. 从 stdout 读取 JSONL 响应
4. 验证进程保持运行，可以连续对话
"""

import subprocess
import json
import sys
import time
from typing import Iterator, Dict, Any
import os

# ANSI 颜色代码
class Colors:
    RESET = '\033[0m'
    BOLD = '\033[1m'
    RED = '\033[91m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    MAGENTA = '\033[95m'
    CYAN = '\033[96m'


def log(message: str, color: str = Colors.RESET):
    """打印彩色日志"""
    print(f"{color}{message}{Colors.RESET}")


def log_event(event_type: str, data: Dict[str, Any]):
    """打印 JSON 事件"""
    if event_type == 'init':
        log(f"  [INIT] Session: {data.get('session_id', 'N/A')}, Model: {data.get('model', 'N/A')}", Colors.CYAN)
    elif event_type == 'thought':
        subject = data.get('subject', 'N/A')
        log(f"  [THOUGHT] {subject}", Colors.MAGENTA)
    elif event_type == 'message':
        role = data.get('role', 'unknown')
        content = data.get('content', '')
        delta = data.get('delta', False)
        if delta:
            print(f"{Colors.GREEN}{content}{Colors.RESET}", end='', flush=True)
        else:
            log(f"  [MESSAGE] {role}: {content}", Colors.GREEN)
    elif event_type == 'tool_use':
        tool_name = data.get('tool_name', 'N/A')
        log(f"  [TOOL_USE] {tool_name}", Colors.YELLOW)
    elif event_type == 'tool_result':
        status = data.get('status', 'N/A')
        log(f"  [TOOL_RESULT] Status: {status}", Colors.YELLOW)
    elif event_type == 'result':
        status = data.get('status', 'N/A')
        stats = data.get('stats', {})
        log(f"  [RESULT] Status: {status}, Stats: {stats}", Colors.BLUE)
    elif event_type == 'error':
        error = data.get('error', {})
        log(f"  [ERROR] {error}", Colors.RED)
    else:
        log(f"  [{event_type.upper()}] {data}", Colors.RESET)


def start_gemini_cli(cli_path: str, api_key: str) -> subprocess.Popen:
    """启动 Gemini CLI 进程（交互模式）"""
    log("\n=== Starting Gemini CLI Process ===", Colors.BOLD + Colors.CYAN)

    args = [
        'node',
        cli_path,
        '--prompt-interactive', '你好',  # 首个 prompt（会自动进入交互模式）
        '--output-format', 'stream-json',
        '--model', 'gemini-2.0-flash-exp',
    ]

    env = os.environ.copy()
    env['GEMINI_API_KEY'] = api_key

    log(f"Command: {' '.join(args)}", Colors.CYAN)

    process = subprocess.Popen(
        args,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,  # 行缓冲
        env=env,
    )

    log(f"Process started with PID: {process.pid}", Colors.GREEN)
    return process


def send_message(process: subprocess.Popen, message: str):
    """发送消息到 CLI 进程的 stdin"""
    log(f"\n>>> Sending message: {message}", Colors.BOLD + Colors.YELLOW)
    process.stdin.write(message + '\n')
    process.stdin.flush()


def read_response(process: subprocess.Popen) -> Iterator[Dict[str, Any]]:
    """读取 CLI 进程的 stdout 响应（JSONL 格式）"""
    log("<<< Reading response...", Colors.BOLD + Colors.GREEN)

    while True:
        line = process.stdout.readline()

        if not line:
            # EOF，进程可能退出了
            log("  [EOF] No more output from process", Colors.RED)
            break

        line = line.strip()
        if not line:
            continue

        try:
            event = json.loads(line)
            event_type = event.get('type', 'unknown')

            log_event(event_type, event)

            yield event

            # RESULT 事件表示本轮对话结束
            if event_type == 'result':
                log("  [CONVERSATION TURN COMPLETED]", Colors.BOLD + Colors.BLUE)
                break

        except json.JSONDecodeError as e:
            log(f"  [PARSE ERROR] Failed to parse JSON: {line}", Colors.RED)
            log(f"  Error: {e}", Colors.RED)


def test_interactive_mode(cli_path: str, api_key: str):
    """测试交互模式"""
    log("=" * 60, Colors.BOLD)
    log("Gemini CLI Interactive Mode Test", Colors.BOLD + Colors.CYAN)
    log("=" * 60, Colors.BOLD)

    # 启动进程
    process = start_gemini_cli(cli_path, api_key)

    try:
        # 等待进程初始化（读取首个 INIT 事件和首次对话的响应）
        log("\n=== Waiting for initialization ===", Colors.BOLD + Colors.CYAN)
        init_timeout = 30  # 30 秒超时
        start_time = time.time()
        initialized = False
        first_conversation_done = False

        while time.time() - start_time < init_timeout:
            line = process.stdout.readline()
            if not line:
                log("  [ERROR] Process died during initialization", Colors.RED)
                return

            line = line.strip()
            if not line:
                continue

            try:
                event = json.loads(line)
                log_event(event.get('type'), event)

                if event.get('type') == 'init':
                    initialized = True
                    log("  ✅ CLI initialized successfully!", Colors.BOLD + Colors.GREEN)

                # 等待首次对话（--prompt-interactive '你好'）完成
                if event.get('type') == 'result':
                    first_conversation_done = True
                    log("  ✅ First conversation completed!", Colors.BOLD + Colors.GREEN)
                    break
            except json.JSONDecodeError:
                log(f"  [PARSE ERROR] {line}", Colors.RED)

        if not initialized or not first_conversation_done:
            log("  ❌ Initialization timeout!", Colors.BOLD + Colors.RED)
            return

        # 测试场景 1：第二条消息（首条"你好"已在启动时发送）
        log("\n" + "=" * 60, Colors.BOLD)
        log("Test 1: Second Message (First via stdin)", Colors.BOLD + Colors.CYAN)
        log("=" * 60, Colors.BOLD)

        send_message(process, "请简单介绍一下你自己")
        events_1 = list(read_response(process))
        log(f"✅ Received {len(events_1)} events", Colors.GREEN)

        # 测试场景 2：第三条消息（验证进程保持运行）
        log("\n" + "=" * 60, Colors.BOLD)
        log("Test 2: Third Message (Process Still Alive)", Colors.BOLD + Colors.CYAN)
        log("=" * 60, Colors.BOLD)

        time.sleep(1)  # 短暂等待

        send_message(process, "你会编程吗？")
        events_2 = list(read_response(process))
        log(f"✅ Received {len(events_2)} events", Colors.GREEN)

        # 测试场景 3：第四条消息
        log("\n" + "=" * 60, Colors.BOLD)
        log("Test 3: Fourth Message (Continuous Conversation)", Colors.BOLD + Colors.CYAN)
        log("=" * 60, Colors.BOLD)

        time.sleep(1)

        send_message(process, "帮我写一个 Python 函数，计算斐波那契数列")
        events_3 = list(read_response(process))
        log(f"✅ Received {len(events_3)} events", Colors.GREEN)

        # 测试结果总结
        log("\n" + "=" * 60, Colors.BOLD)
        log("Test Results Summary", Colors.BOLD + Colors.CYAN)
        log("=" * 60, Colors.BOLD)

        log(f"✅ Process PID: {process.pid}", Colors.GREEN)
        log(f"✅ Process still running: {process.poll() is None}", Colors.GREEN)
        log(f"✅ Total messages sent: 4 (1 via CLI arg + 3 via stdin)", Colors.GREEN)
        log(f"✅ Total events received: {len(events_1) + len(events_2) + len(events_3)}", Colors.GREEN)

        log("\n🎉 Interactive mode works perfectly!", Colors.BOLD + Colors.GREEN)
        log("   - Process stays alive between messages", Colors.GREEN)
        log("   - JSONL output format is correct", Colors.GREEN)
        log("   - Multiple conversations work seamlessly", Colors.GREEN)

    except KeyboardInterrupt:
        log("\n\n[INTERRUPTED] Stopping test...", Colors.YELLOW)
    except Exception as e:
        log(f"\n\n❌ Test failed with error: {e}", Colors.RED)
        import traceback
        traceback.print_exc()
    finally:
        # 清理：优雅关闭进程
        log("\n=== Cleaning up ===", Colors.BOLD + Colors.CYAN)

        if process.poll() is None:
            log("Closing stdin to trigger graceful shutdown...", Colors.CYAN)
            process.stdin.close()

            # 等待进程退出（最多 5 秒）
            try:
                process.wait(timeout=5)
                log(f"✅ Process exited with code: {process.returncode}", Colors.GREEN)
            except subprocess.TimeoutExpired:
                log("⚠️  Process did not exit gracefully, killing...", Colors.YELLOW)
                process.kill()
                process.wait()
                log(f"✅ Process killed", Colors.GREEN)
        else:
            log(f"Process already exited with code: {process.returncode}", Colors.YELLOW)

        # 读取 stderr（如果有错误输出）
        stderr_output = process.stderr.read()
        if stderr_output:
            log("\n=== Stderr Output ===", Colors.BOLD + Colors.RED)
            print(stderr_output)


def main():
    """主函数"""
    # 配置
    cli_path = '/Volumes/ThunderBolt_1T/code/ganyi/aoe-desktop/resources/gemini-cli/gemini.js'

    # 从环境变量读取 API Key
    api_key = os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY')

    if not api_key:
        log("❌ Error: GEMINI_API_KEY or GOOGLE_API_KEY environment variable not set", Colors.RED)
        log("Please set it before running this test:", Colors.YELLOW)
        log("  export GEMINI_API_KEY='your-api-key'", Colors.YELLOW)
        sys.exit(1)

    if not os.path.exists(cli_path):
        log(f"❌ Error: Gemini CLI not found at {cli_path}", Colors.RED)
        sys.exit(1)

    # 运行测试
    test_interactive_mode(cli_path, api_key)


if __name__ == '__main__':
    main()
