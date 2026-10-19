import "dotenv/config";
import { judge0, runnerConfigured } from "../server/runner.js";
if (!runnerConfigured()) {
  console.error(
    "Set JUDGE0_URL (and provider credentials, if required) in .env first.",
  );
  process.exit(1);
}
const cases: {
  name: string;
  code: string;
  expected: string | string[];
  language?: "python" | "cpp" | "java";
}[] = [
  { name: "correct", code: "print(6)", expected: "Accepted" },
  { name: "wrong answer", code: "print(7)", expected: "Wrong answer" },
  {
    name: "syntax error",
    code: "def :",
    expected: ["Compilation error", "Runtime error"],
  },
  {
    name: "timeout",
    code: "while True: pass",
    expected: "Time limit exceeded",
  },
  {
    name: "memory limit",
    code: "a = bytearray(256 * 1024 * 1024)",
    expected: "Runtime error",
  },
  {
    name: "oversized output",
    code: 'print("x" * 1000000)',
    expected: "Runtime error",
  },
];
cases.push(
  {
    name: "C++ compilation and execution",
    language: "cpp",
    code: "#include <iostream>\nint main() { std::cout << 6 << std::endl; }",
    expected: "Accepted",
  },
  {
    name: "Java compilation and execution",
    language: "java",
    code: "public class Main { public static void main(String[] args) { System.out.println(6); } }",
    expected: "Accepted",
  },
);
let failed = false;
for (const check of cases) {
  try {
    const [result] = await judge0(
      check.code,
      [{ input: "", output: "6\n" }],
      true,
      check.language || "python",
    );
    const passed = Array.isArray(check.expected)
      ? check.expected.includes(result.status)
      : result.status === check.expected;
    console.log(`${passed ? "PASS" : "FAIL"} ${check.name}: ${result.status}`);
    if (!passed) failed = true;
  } catch {
    console.log(`FAIL ${check.name}: provider unavailable`);
    failed = true;
  }
}
if (failed) process.exitCode = 1;
