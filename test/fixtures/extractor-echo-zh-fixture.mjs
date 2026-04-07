import { readFileSync } from "node:fs";

const stdin = readFileSync(0, "utf8");

if (stdin.includes("中")) {
  process.stdout.write(
    JSON.stringify({
      memories: [
        {
          type: "gotcha",
          title: "保留审批重试的中文上下文",
          summary: "Windows 管道输入需要正确解码，避免捕捉内容变成乱码。",
          detail: "## GOTCHA\n\nWindows 上通过 hook 读取 stdin 时要正确处理编码，否则中文会变成乱码并污染记忆。",
          tags: ["windows", "encoding", "capture"],
          importance: "medium",
          source: "session",
        },
      ],
    }),
  );
  process.exit(0);
}

process.stdout.write(JSON.stringify({ memories: [] }));
