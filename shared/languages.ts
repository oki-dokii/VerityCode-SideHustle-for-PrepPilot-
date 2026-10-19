export type Language = "python" | "cpp" | "java";
export const languages = {
  python: {
    label: "Python 3",
    editor: "python",
    filename: "solution.py",
    starter:
      'import sys\n\ndef solve():\n    n = int(sys.stdin.readline())\n    points = list(map(int, sys.stdin.readline().split()))\n\n    # Find the best non-empty consecutive stretch.\n\nif __name__ == "__main__":\n    solve()\n',
  },
  cpp: {
    label: "C++",
    editor: "cpp",
    filename: "solution.cpp",
    starter:
      "#include <iostream>\n#include <vector>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n\n    int n;\n    cin >> n;\n    vector<long long> points(n);\n    for (auto &point : points) cin >> point;\n\n    // Find the best non-empty consecutive stretch.\n\n    return 0;\n}\n",
  },
  java: {
    label: "Java",
    editor: "java",
    filename: "Main.java",
    starter:
      'import java.io.*;\nimport java.util.*;\n\npublic class Main {\n    public static void main(String[] args) throws Exception {\n        BufferedReader reader = new BufferedReader(new InputStreamReader(System.in));\n        int n = Integer.parseInt(reader.readLine().trim());\n        long[] points = new long[n];\n        StringTokenizer tokens = new StringTokenizer("");\n        for (int i = 0; i < n; i++) {\n            while (!tokens.hasMoreTokens()) tokens = new StringTokenizer(reader.readLine());\n            points[i] = Long.parseLong(tokens.nextToken());\n        }\n\n        // Find the best non-empty consecutive stretch.\n    }\n}\n',
  },
} as const;
