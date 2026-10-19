import type { Language } from "../shared/languages.js";
export type TestCase = { input: string; output: string };
export type CaseResult = {
  index: number;
  status: string;
  passed: boolean;
  stdout?: string;
  expected?: string;
  stderr?: string;
  time?: string;
  memory?: number;
};
export type Runner = (
  code: string,
  tests: TestCase[],
  reveal: boolean,
  language?: Language,
) => Promise<CaseResult[]>;
export const runnerConfigured = () => Boolean(process.env.JUDGE0_URL);
export const normalise = (s: string) => s.replace(/\r\n/g, "\n").trimEnd();
export function mapResult(
  result: any,
  test: TestCase,
  index: number,
  reveal: boolean,
): CaseResult {
  const id = result?.status?.id;
  if (![3, 4, 5, 6, 7, 8, 9, 10, 11, 12].includes(id))
    throw new Error(
      "Execution provider returned an unavailable or invalid result.",
    );
  const decode = (value: unknown) =>
    typeof value === "string"
      ? Buffer.from(value, "base64").toString("utf8").slice(0, 8000)
      : "";
  const stdout = decode(result.stdout);
  const passed = id === 3 && normalise(stdout) === normalise(test.output);
  const status = passed
    ? "Accepted"
    : id === 3 || id === 4
      ? "Wrong answer"
      : id === 5
        ? "Time limit exceeded"
        : id === 6
          ? "Compilation error"
          : "Runtime error";
  return {
    index,
    status,
    passed,
    ...(reveal
      ? {
          stdout,
          expected: test.output,
          stderr: decode(result.compile_output || result.stderr),
        }
      : {}),
    time: result.time,
    memory: result.memory,
  };
}
export const judge0: Runner = async (
  code,
  tests,
  reveal,
  language = "python",
) => {
  const base = process.env.JUDGE0_URL?.replace(/\/$/, "");
  if (!base)
    throw new Error("Execution service is not configured. Your code is saved.");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (process.env.JUDGE0_API_KEY)
    headers[process.env.JUDGE0_API_HOST ? "X-RapidAPI-Key" : "X-Auth-Token"] =
      process.env.JUDGE0_API_KEY;
  if (process.env.JUDGE0_API_HOST)
    headers["X-RapidAPI-Host"] = process.env.JUDGE0_API_HOST;
  const request = async (path: string, options: RequestInit = {}) => {
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers,
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok)
      throw new Error(
        "Execution service rejected the request. Try again later.",
      );
    return response.json();
  };
  const encode = (s: string) => Buffer.from(s).toString("base64");
  const languageIds = {
    python: Number(process.env.JUDGE0_PYTHON_ID || 71),
    cpp: Number(process.env.JUDGE0_CPP_ID || 54),
    java: Number(process.env.JUDGE0_JAVA_ID || 62),
  };
  if (!Number.isInteger(languageIds[language]) || languageIds[language] <= 0)
    throw new Error("Invalid execution language configuration.");
  const submissions = tests.map((test) => ({
    source_code: encode(code),
    language_id: languageIds[language],
    stdin: encode(test.input),
    expected_output: encode(test.output),
    cpu_time_limit: 2,
    wall_time_limit: 5,
    memory_limit: language === "java" ? 512000 : 128000,
    max_file_size: 128,
    max_processes_and_or_threads: language === "java" ? 64 : 32,
    enable_network: false,
  }));
  const created = await request("/submissions/batch?base64_encoded=true", {
    method: "POST",
    body: JSON.stringify({ submissions }),
  });
  if (
    !Array.isArray(created) ||
    created.length !== tests.length ||
    created.some((item) => typeof item.token !== "string")
  )
    throw new Error("Execution service did not accept all test cases.");
  const tokens = created
    .map((item) => encodeURIComponent(item.token))
    .join(",");
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    const data = await request(
      `/submissions/batch?tokens=${tokens}&base64_encoded=true&fields=token,status,stdout,stderr,compile_output,time,memory`,
    );
    if (
      !Array.isArray(data.submissions) ||
      data.submissions.length !== tests.length
    )
      throw new Error("Execution service returned incomplete results.");
    const ordered = created.map((item) =>
      data.submissions.find((result: any) => result.token === item.token),
    );
    if (ordered.some((item) => !item || !Number.isInteger(item.status?.id)))
      throw new Error("Execution service returned invalid results.");
    if (ordered.every((item) => item.status.id > 2))
      return ordered.map((item, index) =>
        mapResult(item, tests[index], index, reveal),
      );
  }
  throw new Error(
    "Execution service timed out. Your code is saved; retry grading later.",
  );
};
